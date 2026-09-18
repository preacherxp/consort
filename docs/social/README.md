# Consort launch media

- `consort-demo.gif`: looping, silent GIF; encoder targets less than 5 MB.
- `consort-demo.mp4`: sharper 1280×960, 24 fps H.264 alternative, with fast-start metadata and no audio.
- `consort-demo-poster.png`: full-resolution still for a video thumbnail.
- `x-post.md`: launch copy, accessible media description, and publication checklist.

The recording shows the actual local production UI inside a presentation frame, using the saved **race-condition** observation in `benchmarks/results/benchmark-informed-v5.1-check.json`. The task, priority, choices, probabilities, effort, and reported 498 ms routing duration are preserved. The original model criteria and candidate order are reconstructed and SHA-256 checked against that observation. Other question instructions are reconstructed from the current v5.1 request builder; this is a UI replay, not a fresh request or an archival HTTP capture. The saved report did not retain a response ID, so none is invented.

The 59% shown for Opus is Jev's returned choice probability, not an accuracy score. The user passes to the scored runner-up and then returns to the original recommendation before matching. No target model is executed. The recording makes **zero paid API calls**; its only routing request is intercepted locally. The visible replay label and edited pacing distinguish it from a latency benchmark.

## Reproduce

Requires Bun, installed project dependencies, Playwright Chromium, and `ffmpeg` on PATH. Start the production preview in a separate terminal:

```sh
bun run build
bun run start
```

Then:

```sh
bun run demo:social
```

The script captures only `http://127.0.0.1:3007`, blocks third-party requests, and intercepts `/api/route`. It permits same-origin framing **only in the capture browser's intercepted document response**; the real app's anti-framing headers remain unchanged. Raw video and intermediate captures use a temporary directory and are removed afterward. Rerunning replaces these generated media files. The current catalog must still contain the recorded candidates, and a policy change requires deliberate review before replaying the old observation.

The public domain returned an SSL error during creation. Resolve that before using the launch link. Nothing was uploaded to X or deployed by this media workflow.
