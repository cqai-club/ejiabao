# Portrait Video Export

`render_xiezong_video.py` requires Python with OpenCV and NumPy, FFmpeg/FFprobe
on PATH, and the configured Windows subtitle font. It edits a local video;
it does not submit InferFlow jobs or generate lip motion itself.

## Driven Export

Generate a lip-synced video from the composited portrait and the intended audio
first. For unchanged recordings, InferFlow's `image_singing_lipsync_v1` accepts
an image and direct audio. Read its current public schema before submission.
Use WAV when an M4A upload is rejected. A workflow that synthesizes speech from
text may change the recording and duration, so it cannot be substituted here.

Provide the downloaded, subtitle-free video and the same recording:

```powershell
python scripts/render_xiezong_video.py --driven-video "driven.mp4" --audio "voice.wav" --script "script.txt" --output "final.mp4"
```

The video must be 9:16 at 25 FPS. Its duration must match the recording within
0.2 seconds; a shorter tail is held for at most five frames. The renderer reads
every driven frame, adds camera movement, uses the supplied audio, and burns
captions from the UTF-8 script. Caption timing is proportional to text length,
not speech alignment; the script must match the recording for meaningful captions.
The output is validated as 720x1280 H.264 with audio at 25 FPS.

## Static Preview

Old calls without an explicit mode now fail. To preview the original green-screen
screenshot cutout and background composition without lip motion, opt in explicitly:

```powershell
python scripts/render_xiezong_video.py --static-preview --person "portrait-screenshot.jpg" --background "background.jpg" --audio "voice.wav" --script "script.txt" --output "static-preview.mp4"
```

The screenshot crop is specific to the original supplied portrait, not a general
background-removal tool. Static previews are not finished digital-human videos.
Intermediate files use the output stem to keep separate exports apart.

## Checks

```powershell
python -m unittest scripts/test_render_xiezong_video.py -v
npm test
```

Renderer regression tests cover preservation of changing source frames,
bounded tail padding, duration mismatch, decode failure, explicit mode selection,
input overwrite protection, media metadata, and Windows process encoding.
Inspect face closeups in the actual export as well: container metadata and camera
movement alone cannot verify lip motion or audio synchronization.
