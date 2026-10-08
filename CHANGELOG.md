# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-10-08

First release.

### Added

- **FSR1 upscaling** of HTML5 videos on WebGL2: AMD FidelityFX Super Resolution 1 (EASU + RCAS)
  ported to GLSL ES 3.0, drawn on a canvas laid over each `<video>` that follows `object-fit`,
  `object-position` and the page layout, including transformed ancestors and centering
  transforms
- **Two qualities**: FSR1 (EASU + RCAS) and a lighter Bilinear + RCAS, with sharpness as a
  linear percentage (87% = AMD's default; 0% skips the RCAS pass)
- **Frame-accurate rendering**: one render per video frame, also at 60 fps, using
  `getVideoPlaybackQuality().totalVideoFrames` because `requestVideoFrameCallback` fires at
  ~25 Hz in Firefox
- **Video discovery** on any page: incremental DOM scanning, iframes and shadow DOM (including
  closed roots), videos moved or replaced by the page
- **Automatic fallbacks** to the original video: when upscaling is not needed (configurable
  threshold), for DRM-protected and cross-origin videos, for CSS-scaled or rotated videos, when
  only the `<video>` element is fullscreen, and when the GPU cannot keep up (after first trying
  the lighter quality)
- **Resource management**: no work for paused, hidden or off-screen videos; WebGL contexts
  released when off screen, at most 12 per frame
- **Popup**: master and per-site switches, quality, sharpness, A/B comparison, info label, live
  state of the tab's videos with readable reasons
- **Options page**: "everywhere except excluded sites" or "allowed sites only" (subdomains
  included), activation threshold, shortcuts, reset
- **Keyboard shortcuts**: `Alt+Shift+U` on/off, `Alt+Shift+G` quality, `Alt+Shift+I` info label,
  `Alt+Shift+O` A/B comparison
- **Settings** synced with the Firefox account (`storage.sync`), with a versioned schema
- **Per-tab badge** (ON / OFF) and a welcome page to grant site access
- **Localization**: English (reference) and Italian
- **Privacy**: no network requests and no data collection; no console output in the published
  package
- **Playground** to compare modes side by side and measure the cost per frame
- **Tests**: unit (node --test), rendering regression against reference images, end-to-end on a
  fixture with 13 layouts, popup and options in English and Italian; CI on GitHub Actions

[Unreleased]: https://github.com/skateddu/sharpview-fsr-video-upscaler/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/skateddu/sharpview-fsr-video-upscaler/releases/tag/v1.0.0
