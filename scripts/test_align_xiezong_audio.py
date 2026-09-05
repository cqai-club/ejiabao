import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from align_xiezong_audio import align_script, build_timeline


class AudioTimelineTests(unittest.TestCase):
    def test_uses_spoken_times_instead_of_uniform_duration(self):
        words = [{"word": "准备装修", "start": 2.0, "end": 3.0}, {"word": "货源直供", "start": 10.0, "end": 12.0}]
        data = build_timeline("准备装修，货源直供。", words, 13)
        self.assertEqual(data["captions"][1]["start"], 10)
        self.assertEqual(data["cues"][1]["start"], 10)
        self.assertLess(data["cues"][0]["end"], data["cues"][1]["start"])

    def test_rejects_unrelated_recording(self):
        with self.assertRaisesRegex(ValueError, "match too low"):
            align_script("准备装修，货源直供", [{"word": "这是一段完全不同的内容", "start": 0, "end": 5}])

    def test_small_recognition_error_interpolates_between_audio_anchors(self):
        _, times, coverage = align_script("准备装修货源直供", [{"word": "准备装休货源直供", "start": 2, "end": 10}])
        self.assertGreater(coverage, 0.8)
        self.assertEqual(times[3], (5, 6))

    def test_category_items_do_not_appear_before_their_words(self):
        words = [{"word": "瓷砖", "start": 1, "end": 2}, {"word": "门窗", "start": 3, "end": 4}, {"word": "卫浴", "start": 5, "end": 6}, {"word": "板材", "start": 7, "end": 8}]
        data = build_timeline("瓷砖、门窗、卫浴、板材", words, 9)
        self.assertEqual([item["start"] for item in data["cues"][0]["items"]], [1, 3, 5, 7])


if __name__ == "__main__":
    unittest.main()
