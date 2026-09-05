import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from prepare_xiezong_avatar import clean_green_screen, compose_avatar


class AvatarPreparationTests(unittest.TestCase):
    def test_green_background_is_transparent_and_skin_is_preserved(self):
        image = np.full((100, 80, 3), (30, 180, 30), dtype=np.uint8)
        image[20:90, 20:60] = (90, 130, 180)
        result = clean_green_screen(image)
        self.assertEqual(int(result[5, 5, 3]), 0)
        self.assertEqual(int(result[50, 40, 3]), 255)
        np.testing.assert_array_equal(result[50, 40, :3], image[50, 40])

    def test_original_transparency_is_not_restored_as_green(self):
        image = np.full((100, 80, 4), (50, 50, 50, 255), dtype=np.uint8)
        image[:, :10, 3] = 0
        result = clean_green_screen(image)
        self.assertFalse(result[:, :10, 3].any())

    def test_remaining_foreground_has_no_green_spill(self):
        image = np.full((100, 80, 3), (100, 110, 105), dtype=np.uint8)
        result = clean_green_screen(image)
        b, g, r = result[50, 40, :3].astype(float)
        self.assertLessEqual(g, 0.65 * r + 0.35 * b + 1)

    def test_person_extends_to_bottom_without_floating_cutoff(self):
        background = np.full((128, 72, 3), 230, dtype=np.uint8)
        person = np.full((100, 40, 4), (10, 10, 10, 255), dtype=np.uint8)
        result = compose_avatar(background, person)
        self.assertEqual(result.shape, (1280, 720, 3))
        self.assertLess(result[-1, 360].mean(), 20)
        self.assertGreater(result[100, 360].mean(), 220)


if __name__ == "__main__":
    unittest.main()
