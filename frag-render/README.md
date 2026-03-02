# frag-render (Rust)

Headless native renderer for Animation Render JSON manifests exported by Fragmentarium Web.

## Build

```bash
cd frag-render
cargo build --release
```

## CLI

`frag-render` is now a single command. The manifest filename is the first positional argument.

```bash
./target/release/frag-render /path/to/render_manifest.json [options]
```

or:

```bash
cargo run --release -- /path/to/render_manifest.json [options]
```

### Options

- `--output-dir <DIR>`
  - Output directory for rendered PNGs.
  - If omitted, defaults to `<manifest-stem>-frames` next to the manifest file.
- `--frames <SPEC>`
  - Frame selection expression.
  - Supported:
    - `all` (default)
    - single index: `45`
    - closed range: `10-30`
    - ranged step: `10-90:3`
    - comma lists: `0,5,10-20,30-90:3`
- `--subframes <N>`
  - Override `maxSubframes` for all selected frames.
- `--width <PX>` / `--height <PX>`
  - Override output resolution for all selected frames.
  - If only one is provided, the other is derived from the manifest aspect ratio.
- `--gpu-profile <auto|integrated|discrete>`
  - GPU selection hint.
- `--force`
  - Always render and overwrite existing output files.
  - By default, existing non-empty output images are skipped to support resume.

### Example

```bash
./target/release/frag-render tests/render.json \
  --output-dir ./reports/frames \
  --frames 0,45,60-75:5 \
  --subframes 10 \
  --width 1920 \
  --height 1080 \
  --gpu-profile discrete
```

## Manifest support

Accepted formats:
- `fragmentarium-web-animation-render-manifest-v1`
- `fragmentarium-web-animation-render-manifest-v2` (compact: shared base payload + per-frame deltas)

The native backend reads precomposed shader/uniform payloads from:
- `task.snapshot.nativeBackend`

No Rust-side Node shader composition step is used.

## Runtime logging

The renderer logs:
- per-frame start line with source frame index and output path
- progress with percentage, elapsed time, and ETA
- skip lines for frames already present on disk (unless `--force` is used)
- final summary (`total`, `mean/frame`, `min/frame`, `max/frame`)

For robustness, each frame is rendered in an isolated subprocess. If a native driver crash happens, the error message includes:
- failing frame index
- internal task JSON path
- output image path

Internal task JSON files are written to:
- `<output-dir>/.frag-render-tasks/`
