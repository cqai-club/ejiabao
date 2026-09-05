import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from urllib.error import URLError

sys.path.insert(0, str(Path(__file__).resolve().parent))
from resume_inferflow_run import resume, retry_read


class ResumeRunTests(unittest.TestCase):
    def test_recovers_disconnect_and_downloads_same_run_without_resubmitting(self):
        client = Mock()
        client.get_run.side_effect = [URLError("connection reset"), {"status": "processing"}, {"status": "completed"}]
        client.list_outputs.return_value = {"items": [{"name": "video", "download_url": "/existing/video"}]}
        with tempfile.TemporaryDirectory() as directory:
            result = resume(client, "existing", Path(directory), sleep=lambda _: None)
            self.assertEqual(result.name, "video.mp4")
            self.assertEqual(client.get_run.call_args.args, ("existing",))
            client.create_skill_run.assert_not_called()
            client.download_output.assert_called_once_with("/existing/video", result)

    def test_nontransient_failure_is_not_retried(self):
        operation = Mock(side_effect=ValueError("bad response"))
        with self.assertRaises(ValueError):
            retry_read(operation, sleep=lambda _: None)
        self.assertEqual(operation.call_count, 1)

    def test_retries_are_bounded(self):
        operation = Mock(side_effect=URLError("offline"))
        with self.assertRaises(URLError):
            retry_read(operation, sleep=lambda _: None)
        self.assertEqual(operation.call_count, 5)

    def test_failed_run_does_not_download_or_submit(self):
        client = Mock()
        client.get_run.return_value = {"status": "failed", "error_message": "generation failed"}
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(RuntimeError):
            resume(client, "existing", Path(directory), sleep=lambda _: None)
        client.download_output.assert_not_called()
        client.create_skill_run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
