# Entreluma Editor

An optional browser-based editor for creating and editing stories on Entreluma-powered sites. Includes live preview, local story packages, and GitHub sync.

Deployment target: [editor.entreluma.org](https://editor.entreluma.org). The Worker redirects `/` to `/editor/` and serves the application and authentication API on the same origin. The publishing template and project site live in [rsnyder/entreluma](https://github.com/rsnyder/entreluma) at [entreluma.org](https://entreluma.org).

## Development

Requires Node.js 22.13 or newer. From the repository root:

```sh
npm ci --prefix prototypes/github-auth
node prototypes/github-auth/tools/build-editor.mjs
npm test --prefix prototypes/github-auth
npm run demo --prefix prototypes/github-auth
```

The loopback demo uses a fake GitHub API; it does not publish to GitHub. The service remains under `prototypes/github-auth/` to preserve the tested build/import structure. See its [service guide](prototypes/github-auth/README.md) for development and production setup.

## Ownership

- `editor/`: editor application and isolated preview frame.
- `assets/js/skrender.js`: client-side renderer; the internal filename remains stable.
- `prototypes/github-auth/`: Worker, authentication, workspace APIs, database migrations, and asset build.
- `tests/fixtures/starter/`: versioned Entreluma publishing runtime plus historical content used only as regression fixtures.
- `tools/`: framework preparation, browser tests, rendering and dependency checks.

Preparation materializes the bundled framework into ignored root paths and `editor/framework/`. Builds do not need a sibling checkout. Update the snapshot and `SOURCE.json` together when adopting publishing changes. See [preview fidelity](docs/editor-preview-fidelity.md) and [migration notes](docs/migration.md).

## Verification

```sh
node tools/prepare-framework.mjs
bundle install
bundle exec jekyll build
python3 tools/check_viewer_catalog.py
python3 tools/check_editor_pins.py
python3 tools/run_browser_tests.py
python3 tools/render_regression.py --check --target editor
python3 -m pytest tests/e2e/
python3 -m pytest prototypes/github-auth/tests/test_browser.py
```

Use the Ruby version in the prepared `.ruby-version`. Browser tests require Python `pytest`, `playwright`, and Chromium, Firefox and WebKit (`playwright install`). The checks workflow runs independently of the publishing repo. The editor owns `tests/render/editor-golden/`; review changes before updating render baselines.

## Deployment

Production configuration targets the `entreluma-editor` Worker at `editor.entreluma.org`. It reuses the existing D1 database (still named `storykit-editor`) and the renamed Entreluma Editor OAuth application. Secrets remain in Cloudflare. See the [service guide](prototypes/github-auth/README.md) for deployment instructions. CI validates the application; it does not automatically deploy it.
