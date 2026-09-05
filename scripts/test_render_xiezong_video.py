import sys
import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock

import cv2
import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from render_xiezong_video import (  # noqa: E402
    HEIGHT,
    WIDTH,
    parse_args,
    render_driven_base,
    run,
    subtitle_chunks,
    validate_probe_data,
)


class RenderXiezongVideoTests(unittest.TestCase):
    def test_export_requires_explicit_driven_video_or_static_preview(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            parse_args(["--script", "script.txt", "--audio", "voice.wav", "--output", "out.mp4"])

    def test_static_preview_requires_composition_assets(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            parse_args(["--static-preview", "--script", "script.txt", "--audio", "voice.wav", "--output", "out.mp4"])

    def test_driven_mode_does_not_require_static_portrait(self):
        args = parse_args(["--driven-video", "driven.mp4", "--script", "script.txt", "--audio", "voice.wav", "--output", "out.mp4"])
        self.assertFalse(args.static_preview)
        self.assertIsNone(args.person)
        self.assertTrue(args.driven_video.is_absolute())

    def test_output_cannot_overwrite_driven_source(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            parse_args(["--driven-video", "driven.mp4", "--script", "script.txt", "--audio", "voice.wav", "--output", "./driven.mp4"])

    def test_run_replaces_invalid_process_output_bytes(self):
        result = run([
            sys.executable,
            "-c",
            "import sys; sys.stdout.buffer.write(bytes([0xff]))",
        ])

        self.assertEqual(result.stdout, "\ufffd")

    def test_subtitle_chunks_preserve_sentence_boundaries(self):
        chunks = subtitle_chunks("第一句。第二句！第三句？")

        self.assertEqual(chunks, ["第一句。", "第二句！", "第三句？"])

    def test_validate_probe_data_accepts_expected_vertical_h264_media(self):
        metadata = validate_probe_data(
            {
                "streams": [
                    {
                        "codec_type": "video",
                        "codec_name": "h264",
                        "width": WIDTH,
                        "height": HEIGHT,
                        "r_frame_rate": "25/1",
                    },
                    {"codec_type": "audio", "codec_name": "aac"},
                ],
                "format": {"duration": "28.672"},
            },
            expected_duration=28.672,
        )

        self.assertEqual(metadata["video_codec"], "h264")
        self.assertEqual(metadata["audio_codec"], "aac")
        self.assertEqual(metadata["frame_rate"], "25/1")

    def test_validate_probe_data_rejects_missing_audio(self):
        with self.assertRaisesRegex(RuntimeError, "缺少音频流"):
            validate_probe_data(
                {
                    "streams": [
                        {
                            "codec_type": "video",
                            "codec_name": "h264",
                            "width": WIDTH,
                            "height": HEIGHT,
                            "r_frame_rate": "25/1",
                        }
                    ],
                    "format": {"duration": "28.672"},
                }
            )


class DrivenVideoTests(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        self.source = Path(self.workspace.name) / "driven.mp4"
        self.output = Path(self.workspace.name) / "output.mp4"
        writer = cv2.VideoWriter(str(self.source), cv2.VideoWriter_fourcc(*"mp4v"), 25, (WIDTH, HEIGHT))
        self.assertTrue(writer.isOpened())
        try:
            for index in range(25):
                frame = np.full((HEIGHT, WIDTH, 3), 80, dtype=np.uint8)
                frame[350:500, 250:450] = 20 if index < 12 else 220
                writer.write(frame)
        finally:
            writer.release()

    def test_export_preserves_changing_source_frames(self):
        render_driven_base(self.source, 1.0, self.output)
        capture = cv2.VideoCapture(str(self.output))
        try:
            samples = []
            for index in (2, 20):
                capture.set(cv2.CAP_PROP_POS_FRAMES, index)
                ok, frame = capture.read()
                self.assertTrue(ok)
                samples.append(frame[380:440, 290:390].mean())
            self.assertGreater(samples[1] - samples[0], 150)
            self.assertEqual(capture.get(cv2.CAP_PROP_FRAME_COUNT), 25)
        finally:
            capture.release()

    def test_only_small_quantization_gap_is_padded(self):
        render_driven_base(self.source, 1.16, self.output)
        capture = cv2.VideoCapture(str(self.output))
        try:
            self.assertEqual(capture.get(cv2.CAP_PROP_FRAME_COUNT), 29)
            capture.set(cv2.CAP_PROP_POS_FRAMES, 28)
            self.assertTrue(capture.read()[0])
        finally:
            capture.release()

    def test_rejects_different_audio_duration_without_creating_output(self):
        with self.assertRaisesRegex(RuntimeError, "时长不一致"):
            render_driven_base(self.source, 1.24, self.output)
        self.assertFalse(self.output.exists())

    def test_intermediate_file_cannot_overwrite_driven_source(self):
        original = self.source.read_bytes()
        with self.assertRaisesRegex(ValueError, "覆盖"):
            render_driven_base(self.source, 1.0, self.source)
        self.assertEqual(self.source.read_bytes(), original)

    def test_decode_failure_is_not_replaced_with_a_frozen_frame(self):
        capture = Mock()
        capture.isOpened.return_value = True
        capture.get.side_effect = lambda prop: {
            cv2.CAP_PROP_FPS: 25,
            cv2.CAP_PROP_FRAME_COUNT: 25,
            cv2.CAP_PROP_FRAME_WIDTH: WIDTH,
            cv2.CAP_PROP_FRAME_HEIGHT: HEIGHT,
        }[prop]
        capture.read.return_value = (False, None)
        with patch("render_xiezong_video.cv2.VideoCapture", return_value=capture):
            with self.assertRaisesRegex(RuntimeError, "解码中断"):
                render_driven_base(self.source, 1.0, self.output)
        capture.release.assert_called_once()


if __name__ == "__main__":
    unittest.main()
