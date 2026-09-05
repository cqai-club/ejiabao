"""Remove green spill and compose a bottom-anchored portrait for generation."""

import argparse
from pathlib import Path

import cv2
import numpy as np

from render_xiezong_video import read_image, write_image


def clean_green_screen(image: np.ndarray) -> np.ndarray:
    color = image[:, :, :3].copy()
    b, g, r = [channel.astype(np.float32) for channel in cv2.split(color)]
    hue, saturation, _ = cv2.split(cv2.cvtColor(color, cv2.COLOR_BGR2HSV))
    green = (hue >= 30) & (hue <= 95) & (saturation > 35) & (g > np.maximum(r, b) + 7)
    mask = (~green).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if count < 2:
        raise ValueError("No foreground subject found")
    mask = (labels == (1 + np.argmax(stats[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
    distance = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    alpha = np.clip((distance - 0.45) / 1.1, 0, 1)
    alpha = cv2.GaussianBlur(alpha, (3, 3), 0.45)
    if image.shape[2] == 4:
        alpha = np.minimum(alpha, image[:, :, 3] / 255.0)

    # Green spill remains in RGB even when the original alpha is transparent.
    spill = np.maximum(0, g - (0.65 * r + 0.35 * b))
    g -= spill
    corrected = np.dstack([b, g, r])
    softened = cv2.GaussianBlur(corrected, (0, 0), 0.7)
    corrected = np.clip(corrected * 1.22 - softened * 0.22, 0, 255)
    corrected[alpha < 0.01] = 0
    return np.dstack([corrected, alpha * 255]).astype(np.uint8)


def compose_avatar(background: np.ndarray, portrait: np.ndarray, width=720, height=1280) -> np.ndarray:
    scale = max(width / background.shape[1], height / background.shape[0])
    bg = cv2.resize(background, (round(background.shape[1] * scale), round(background.shape[0] * scale)), interpolation=cv2.INTER_LANCZOS4)
    left, top = (bg.shape[1] - width) // 2, (bg.shape[0] - height) // 2
    bg = bg[top:top + height, left:left + width].copy()
    person_height = round(height * 0.822)
    person_width = round(portrait.shape[1] * person_height / portrait.shape[0])
    if person_width > width:
        raise ValueError("Portrait is too wide for this composition")
    person = cv2.resize(portrait, (person_width, person_height), interpolation=cv2.INTER_LANCZOS4)
    x = (width - person_width) // 2
    y = height - person_height + 4
    visible = height - y
    mask = person[:visible, :, 3:4].astype(np.float32) / 255
    target = bg[y:, x:x + person_width].astype(np.float32)
    bg[y:, x:x + person_width] = np.clip(target * (1 - mask) + person[:visible, :, :3] * mask, 0, 255).astype(np.uint8)
    return bg


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--portrait", required=True, type=Path)
    parser.add_argument("--background", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    args = parser.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    cleaned = clean_green_screen(read_image(args.portrait, cv2.IMREAD_UNCHANGED))
    background = read_image(args.background, cv2.IMREAD_COLOR)
    write_image(args.out_dir / "portrait-clean.png", cleaned)
    write_image(args.out_dir / "avatar-composite.png", compose_avatar(background, cleaned))
    white = np.full_like(cleaned[:, :, :3], 240)
    alpha = cleaned[:, :, 3:4] / 255.0
    write_image(args.out_dir / "edge-check.jpg", (white * (1 - alpha) + cleaned[:, :, :3] * alpha).astype(np.uint8))
    print(f"Prepared avatar: {args.out_dir / 'avatar-composite.png'}")


if __name__ == "__main__":
    main()
