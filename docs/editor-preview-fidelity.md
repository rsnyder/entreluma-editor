# Publication preview fidelity

The fast editor preview uses the current story buffer and the publication’s own
configuration, layout and include overrides. It is a browser rendering, not an
actual Jekyll build or an editorial approval artifact.

## Resolution and performance

- Resolve the bound branch to a commit before reading configuration or templates.
  Display that revision in preview diagnostics. Authenticated reads use the editor
  service; signed-out public reads use GitHub’s API.
- Check the publication first for every requested path, including `default`,
  `head`, `sidebar`, locale and asset-origin data previously treated as gem-only.
- Missing theme files inherit from `remote_theme` at a resolved commit, or from
  the Chirpy version in `Gemfile.lock`. An absent Chirpy lock uses bundled-version
  compatibility fallback with a warning. Unsupported themes are reported.
- Cache branch resolutions for five minutes independently of file contents.
  Successful and missing file lookups at immutable revisions remain reusable.
  Theme cache entries also identify the resolved theme source; changing a remote
  theme revision invalidates those entries. Concurrent identical resolutions are
  coalesced; locale and asset-origin data load concurrently.
- **Refresh publication preview** bypasses branch and runtime-capability freshness
  checks and re-renders the current buffer. Files at the same commit stay cached.
  An offline refresh retains a known commit with a warning. A cold unresolved
  publication fails visibly rather than combining files from a moving branch.
- Unbound drafts use the versioned public framework snapshot shipped with the
  editor for templates and the standard Entreluma site for ordinary runtime assets.
  Local embeds use the bundled image/map runtime. Preparation creates `editor/framework/` for both development and builds.
  Its cache namespace must change when adopting a new snapshot.

The first preview pays for repository/template loading. Warm typing does not
re-fetch those files or resolve the branch until the freshness window expires.
No fixed latency claim is made for network, map initialization, or large media.

## Deployed assets and local files

Ordinary stylesheets, scripts, viewers and media retain publication URLs derived
from its `url` and `baseurl`. These are deployed assets: they may lag repository
source. Diagnostics state this boundary. Unpublished CSS, Sass, JavaScript or
viewer changes require a site build to preview accurately. Missing site URLs use
an explicitly reported standard theme fallback.

A publication can retain its own viewers for local image and GeoJSON bytes by
serving `assets/entreluma-preview.json` alongside a compatible runtime:

```json
{"schemaVersion":1,"host":1,"localImage":1,"localMap":1}
```

`host: 1` declares support for forwarding local assignment IDs when expanding a
viewer. `localImage: 1` declares the image viewer’s generation-scoped
`sk-local-image-ready` / `sk-local-image` byte-transfer protocol.
`localMap: 1` declares the same protocol for multiple JSON/GeoJSON resources,
including `sk_resources`. Values apply to `assets/components/image.html` and
`map.html` (and their extensionless aliases), plus `assets/js/entreluma.js`, under
the deployed site base. Customizations can keep these paths and this contract.

Publish this declaration only with matching runtime code. The starter includes
it as a core runtime asset; it is also tracked in the editor’s starter fixture.
Sites predating this addition must adopt and deploy it with compatible viewers.
The manifest and ES modules must be readable across origins (for example,
`Access-Control-Allow-Origin: *` on these public assets).

The editor reads this small declaration without credentials, with a three-second
timeout and a five-minute positive/negative cache. It preserves declared-compatible
publication viewers and host code. Missing, blocked or unsupported declarations
cause local embeds to use the bundled viewer and, when necessary, host module;
the diagnostics explicitly identify each fallback. Ordinary remote embeds retain
their publication viewers. Mixed compatibility can require a bundled host while
retaining a compatible publication viewer; the host substitution is reported.

Bound previews use a separate preview document whose response policy permits
publication scripts from HTTPS origins. The editor page retains its script-source
allowlist. Both the iframe sandbox and response policy exclude same-origin access,
including when the preview URL is opened directly. A generation-specific handshake
sends rendered HTML only to the current preview frame. The story remains inside an opaque sandbox. Local bytes are delivered only to
registered frames at the selected runtime paths and for the current generation.
The capability file supplies no arbitrary runtime URLs or authentication access.

## Fidelity boundary

LiquidJS/markdown-it does not execute Ruby plugins, Sass builds, all Jekyll data
or collection behavior, or a whole-site build. Existing locale/origin data support
is retained; this change does not add arbitrary `_data` or collection loading.
Dynamic external assets can also change independently of repository commits.
Use an actual Jekyll site build for publication acceptance.

## Migration verification

The preview implementation and its tests were carried over into Entreluma with
updated namespaces and the current publishing runtime. Historical deployment
identifiers are not Entreluma deployments. See [migration notes](migration.md)
for scope and the root README for validation commands.

## Preview origin

On `editor.entreluma.org` the publication preview frame is loaded from the
dedicated origin `https://preview.entreluma.org` (`PREVIEW_ORIGIN` in
`wrangler.production.jsonc`) instead of an opaque sandboxed origin. Nested
third-party embeds that need storage or cookies (for example the Internet
Archive book reader) therefore behave as they do on the published site.

- The preview host serves only `/editor/preview-frame(.html)`; it has no API,
  session cookies (the editor's cookies are `__Host-` scoped), or editor app.
- Its CSP is `sandbox allow-same-origin allow-scripts …` with
  `frame-ancestors` limited to the editor origin, so top navigation stays
  blocked and only the editor can frame it.
- Other hosts (local demo, tests) keep the opaque-origin sandbox, and
  `allow-same-origin` is never applied to `srcdoc` or same-origin frames.
- Preview storage is shared across essays on that origin and is not private
  to one document.
- Deploying creates the DNS record and certificate for `preview.entreluma.org`
  in the Cloudflare zone; no registrar (Squarespace) change is needed.
