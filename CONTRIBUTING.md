# Contributing

Thanks for your interest in contributing to **sharpview-fsr-video-upscaler**!

## How to Contribute

### Reporting Bugs

Open an [issue](https://github.com/skateddu/sharpview-fsr-video-upscaler/issues/new?template=bug_report.md) with:

- A clear description of the problem and the page where it happens
- Steps to reproduce
- Expected vs actual behavior
- Your Firefox version, OS and GPU, and the text of the info label (`Alt+Shift+I`)

### Suggesting Features

Open a [feature request](https://github.com/skateddu/sharpview-fsr-video-upscaler/issues/new?template=feature_request.md) describing the use case and expected behavior.

### Submitting Changes

1. Fork the repository
2. Create a branch from `main`: `git checkout -b feat/your-change`
3. Make your changes
4. Run the full test suite:

   ```bash
   npm test
   ```

   CI runs a subset of it (type check, unit tests, build, extension and Markdown lint, UI tests). The
   rendering and end-to-end tests need a GPU and run only locally, so please run `npm test`
   before opening a pull request.
5. Check the change in Firefox with `npm start` on at least one real site
6. Commit using [Conventional Commits](https://www.conventionalcommits.org/) format:

   ```text
   fix(overlay): keep the canvas aligned when the player uses translate(-50%, -50%)
   ```

7. Push and open a Pull Request against `main`

## Development Setup

Requires Node.js 22.18 or newer (see `.nvmrc`) and Firefox 140 or newer.

```bash
# Clone your fork
git clone https://github.com/<your-username>/sharpview-fsr-video-upscaler.git
cd sharpview-fsr-video-upscaler

# Install dependencies and the Firefox build used by the tests
npm install
npx playwright install firefox

# Build and verify everything
npm test

# Run Firefox with the extension loaded (reloads on rebuild)
npm start
```

The [playground](playground/) (`npm run dev`, then <http://localhost:8080>) is the quickest way to
work on the shaders: it shows each mode side by side with plain bilinear and measures the cost
per frame.

## Coding Standards

- **English everywhere**: code, comments, logs, docs and commit messages.
- **Localized UI**: every user-facing string is a key in `extension/_locales/en/messages.json`
  (the reference) **and** `extension/_locales/it/messages.json`. Use `t()` in code and
  `data-i18n` in HTML; a unit test fails if a key is missing from either catalog.
- **Pure logic stays testable**: modules under `src/core`, `src/shared` and the pure parts of
  `src/content` (`layout.ts`, `perf.ts`) must not touch extension APIs, so `node --test` can
  import them.
- **No console output in the published package**: use `log()` from `src/shared/log.ts`, which is
  compiled out of release builds.
- **Rendering changes**: if a shader change is intended, regenerate the references with
  `npm run test:render -- --update-golden` and check the images in `test/golden` by eye.
- One logical change per PR; update [CHANGELOG.md](CHANGELOG.md) under `[Unreleased]`.

See [How It Works](README.md#how-it-works) for the architecture and the design decisions.

## Code of Conduct

By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
