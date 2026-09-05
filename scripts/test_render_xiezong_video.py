import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from render_xiezong_video import (  # noqa: E402
    HEIGHT,
    WIDTH,
    run,
    subtitle_chunks,
    validate_probe_data,
)


class RenderXiezongVideoTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
