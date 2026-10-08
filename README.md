# Sharpview – FSR Video Upscaler

[![CI](https://github.com/skateddu/sharpview-fsr-video-upscaler/actions/workflows/ci.yml/badge.svg)](https://github.com/skateddu/sharpview-fsr-video-upscaler/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/skateddu/sharpview-fsr-video-upscaler)](LICENSE.md)
[![Firefox >= 140](https://img.shields.io/badge/firefox-%3E%3D140-FF7139?logo=firefoxbrowser&logoColor=white)](https://www.mozilla.org/firefox/)
[![TypeScript](https://img.shields.io/badge/TypeScript-WebGL2-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![GitHub last commit](https://img.shields.io/github/last-commit/skateddu/sharpview-fsr-video-upscaler)](https://github.com/skateddu/sharpview-fsr-video-upscaler/commits/main)

**Sharpview** is a Firefox extension that upscales HTML5 videos in real time with **AMD
FidelityFX Super Resolution 1** (EASU + RCAS) on WebGL2. Lightweight and spatial: no CUDA, no
neural networks, no data sent anywhere. It runs on any graphics card, from integrated GPUs to
recent NVIDIA, AMD and Intel ones.

## Features

- **FSR1 upscaling** on every video shown larger than its resolution: YouTube, Twitch,
  Dailymotion, embedded players, videos in iframes and shadow DOM
- **Two qualities**: FSR1 (EASU + RCAS) and a lighter Bilinear + RCAS for weak GPUs, with
  adjustable sharpness (0% turns sharpening off)
- **Automatic fallbacks**: the original video stays visible when upscaling is not needed, for
  DRM-protected or cross-origin videos, and when the GPU cannot keep up (after first trying the
  lighter quality)
- **Frame-accurate**: renders every video frame, also at 60 fps, and pauses for videos that are
  off screen or paused
- **Per-site control**: run everywhere except excluded sites, or only on allowed sites
- **A/B comparison**: plain bilinear on the left, upscaler on the right, to judge the result
- **Info label**: input and output resolution, scale and fps on the video, or why it stays native
- **Private**: no network requests, no data collection; settings sync with your Firefox account
- **Localized**: English and Italian

## Installation

The extension is not on [addons.mozilla.org](https://addons.mozilla.org/) yet. To try it from
source (requires Node.js 22.18+ and Firefox 140+):

```bash
git clone https://github.com/skateddu/sharpview-fsr-video-upscaler.git
cd sharpview-fsr-video-upscaler
npm install
npm run build
npm start          # opens Firefox with the extension loaded
```

Alternatively, `npm run package` builds a zip in `web-ext-artifacts/` that can be loaded from
`about:debugging` → This Firefox → Load Temporary Add-on.

On first install a page asks for access to sites: the extension needs it to find the videos on
web pages.

## Usage

Upscaling starts automatically on every video shown larger than its resolution, e.g. a 480p or
720p video in theater mode or fullscreen. Clicking the toolbar icon opens the popup: master and
per-site switches, quality, sharpness, A/B comparison and the state of the tab's videos. The
badge shows **ON** when active and **OFF** on excluded sites. The options page sets excluded or
allowed sites and the activation threshold.

| Shortcut | Action |
| --- | --- |
| `Alt+Shift+U` | Turn upscaling on/off |
| `Alt+Shift+G` | Switch FSR1 (EASU + RCAS) / Bilinear + RCAS |
| `Alt+Shift+I` | Show resolution and fps on the video |
| `Alt+Shift+O` | A/B comparison: bilinear on the left, upscaler on the right |

Shortcuts can be changed in `about:addons` → gear icon → Manage Extension Shortcuts.

**Limitations**: DRM-protected videos (Netflix, Prime Video, Disney+…) cannot be read by the
GPU and are never processed. Firefox's Picture-in-Picture window shows the original video. If a
site places the player controls before the `<video>` in the DOM without a `z-index`, the
overlay could cover them (not seen on YouTube, Twitch or Dailymotion).

## How It Works

```text
content script (one per frame)
  Controller        finds <video> elements (incremental DOM scan, iframes, shadow DOM)
  VideoSession      one per video: decides native vs upscaled and coordinates
    layout          eligibility and geometry (pure)
    overlay         canvas and info label laid over the video
    perf            frame rate, slow-GPU detection, WebGL context budget (pure)
    core/Upscaler   WebGL2: upload → EASU or bilinear → RCAS → canvas
    core/FrameLoop  one callback per new video frame
background          per-tab badge, keyboard shortcuts
popup / options     switches, quality, sharpness, per-site rules
```

- **Rendering.** EASU (Edge Adaptive Spatial Upsampling) enlarges the frame following edge
  direction; RCAS (Robust Contrast Adaptive Sharpening) restores sharpness without halos. Both
  are ported from the fp32 path of AMD's `ffx_fsr1.h` to GLSL ES 3.0. Intermediates stay 8-bit
  sRGB, as FSR1 is designed for, and the canvas is drawn at the display's physical resolution.
- **Frame timing.** `requestVideoFrameCallback` fires at only ~25 Hz in Firefox, even for 60 fps
  videos, so the extension checks `getVideoPlaybackQuality().totalVideoFrames` on every
  animation frame instead: one render per video frame.
- **Positioning.** The canvas is inserted right after the `<video>`, in the same containing
  block. Its rectangle follows `object-fit` and `object-position` (clipped for `cover`), and
  its position is corrected by measuring the real offset on screen, which covers transformed
  ancestors and `translate(-50%, -50%)` centering.
- **When the video stays native.** Below the activation threshold (×1.05 by default), for
  hidden, tiny or off-screen videos, CSS-scaled or rotated videos, fullscreen of the `<video>`
  element alone, DRM, cross-origin frames without CORS and missing WebGL. The popup and the info
  label show the reason.
- **Performance.** Per-frame work happens only while upscaling; native videos are re-evaluated
  on events and once per second. After the first scan only added DOM nodes are examined, which
  matters on pages with live chat. If rendering falls behind the video **and** the measured GPU
  cost per frame is high for 3 seconds, quality drops to Bilinear + RCAS, then to the native
  video. Off-screen videos release their WebGL context; at most 12 contexts per frame are used.
- **Settings** live in `storage.sync` with a versioned schema and queued writes, so rapid
  shortcuts never lose a change. **Logs** appear only in development builds.

**Alternatives considered**: WebGPU is not enabled by default in Firefox on every platform yet,
so WebGL2 runs everywhere. NVIDIA Image Scaling and Snapdragon Game Super Resolution are spatial
upscalers of the same family as FSR1, made for games, and would not give a visibly different
result on video. Firefox's native RTX Video Super Resolution only works on NVIDIA RTX GPUs.

## Project Structure

```text
sharpview-fsr-video-upscaler/
├── .github/                  # CI workflow, issue and pull request templates
├── extension/                # Manifest, icon, static HTML, CSS
│   └── _locales/             # en (reference) and it message catalogs
├── playground/               # Standalone page to compare modes and measure cost
├── scripts/
│   ├── build.mjs             # esbuild: extension, playground, test harness
│   ├── render-test.mjs       # Rendering regression against test/golden
│   ├── e2e.mjs               # Content script on a fixture with 13 layouts
│   ├── ui-test.mjs           # Popup and options, in English and Italian
│   └── lib.mjs               # Shared test helpers: static server, checks, page errors
├── src/
│   ├── core/                 # WebGL2 renderer: FSR1 shaders, pipeline, geometry, frame loop
│   ├── content/              # Content script: controller, session, layout, overlay, perf
│   ├── background/           # Shortcuts, per-tab badge, permission onboarding
│   ├── popup/                # Toolbar popup
│   ├── options/              # Options page
│   ├── onboarding/           # Welcome page to grant site access
│   └── shared/               # Settings, status codes, i18n, permissions, messages, logging
└── test/
    ├── unit/                 # node --test
    ├── golden/               # Reference images for the rendering test
    └── e2e/                  # Fixture pages
```

## Development

```bash
npm install
npx playwright install firefox   # Firefox build used by the rendering, e2e and UI tests

npm start          # Firefox with the extension loaded (after npm run build; reloads on rebuild)
npm run dev        # Playground at http://localhost:8080 (watch)
npm run build      # Build into dist/
npm test           # Type check, build, unit, rendering, e2e and UI tests, extension and Markdown lint
npm run package    # Release build (no logs or sourcemaps), lint and zip into web-ext-artifacts/
```

`npm run test:render -- --update-golden` regenerates the reference images in `test/golden`
(they depend a little on the GPU and fonts: on a new machine regenerate them and check them by
eye).

The playground opens a local video (button or drag and drop) or a test pattern. Keys: space
play/pause, `1`–`4` mode, `C` bilinear/upscaler split (drag on the video to move it), `N`
compare with the browser's native scaling. "Benchmark" measures the cost per frame of every
mode.

### Tests

- **Unit** (`node --test`): geometry, layout, settings schema and migration, settings queue,
  status messages, performance logic, translation catalogs.
- **Rendering**: every mode compared pixel by pixel with `test/golden`, also after a WebGL
  context loss.
- **End-to-end**: the content script on a fixture page with 13 layouts (iframe, shadow DOM,
  transforms, object-fit/position, off screen, DRM via ClearKey, cross-origin), plus frame
  cadence, source changes, moved and removed videos and the slow-GPU fallback.
- **UI**: popup and options with a simulated `browser`, in English and Italian.

Playwright cannot load extensions in Firefox, so the toolbar, permissions and real sites are
checked by hand with `npm start`.

## Roadmap

- Measurements on integrated and entry-level GPUs at 1080p→4K (they decide whether Bilinear +
  RCAS stays a user choice or only the automatic fallback)
- More real-site checks: video embeds in articles, Reddit, feeds with many videos, page zoom
- Publication on addons.mozilla.org
- Later: a WebGPU backend with zero-copy video import, a Chrome port

## Contributing

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE.md). The FSR1 shaders are a port of AMD FidelityFX Super Resolution 1, also MIT:
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). To report a vulnerability, see
[SECURITY.md](SECURITY.md).

AMD, FidelityFX and FSR are trademarks of Advanced Micro Devices, Inc. This project is not
affiliated with or endorsed by AMD.
