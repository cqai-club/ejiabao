# Natural Talking-Head Motion

This optional local Remotion project edits a completed, subtitle-free digital-human
video. It keeps that video's synthesized audio at full volume. It does not reuse
the voice-reference recording, create cloud jobs, or invent hand motion.

## Preparation

1. Run `scripts/prepare_xiezong_avatar.py` from the repository root to remove
   green spill and place the portrait against the bottom edge of the supplied
   showroom image. The input is the cropped green-screen portrait, not a screenshot.
2. Generate a new `digital_human_standard` video using that composite, the voice
   reference, and the complete UTF-8 script. The public API does not expose a
   separate hand-gesture control. Inspect the generated video for actual gestures.
3. Run `scripts/align_xiezong_audio.py --video <generated.mp4> --script <script.txt>
   --output <timeline.json>` in an environment with faster-whisper and its cached
   `small` model. Alignment rejects speech that matches less than 80% of the script.
   Check names and recognition differences manually before delivery.
4. Place the generated raw video at `public/video.mp4`, the JSON at
   `public/timeline.json`, and the licensed HarmonyOS bold font at
   `public/HarmonyOS_Sans_SC_Bold.ttf`. Local assets and exports are Git-ignored.

## Rendering

Run these commands from this directory:

```powershell
npm ci --no-audit --no-fund
npm test
npm run still -- out/check.png --frame=100 --props=public/timeline.json
npm run render -- out/final.mp4 --props=public/timeline.json
```

The CLI accepts `--browser-executable=<path>` to use an installed Chrome. Preview
with `npm run studio -- --props=public/timeline.json` when an editable view is needed.
The composition is 1080x1920 at 25 FPS; this provides crisp overlays, not recovered
camera detail beyond the source video's resolution.

## Checks

From the repository root, run:

```powershell
python -m unittest discover -s scripts -p "test_*.py" -v
npm test
```

Verify the actual final MP4, including beginning/middle/end: full script coverage,
correct names, mouth and hand motion, green-free edges, no floating lower-body
cutoff, and unclipped text. Top motion cues are mutually exclusive, individual
category labels wait for their spoken word, and captions use speech timestamps.
Do not treat passing metadata or whole-frame motion as proof of hand gestures.
