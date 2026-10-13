# Entreluma editor migration

Copied the current `rsnyder/storykit-editor` working tree on 2026-09-11, including uncommitted preview fidelity changes and their tests. The source repository is unchanged. No Git history, local recovery data, credentials, installed dependencies, generated builds, or Worker state is part of this migration.

Updated product labels, source repository references, storage/package namespaces, configuration keys, capability discovery (`assets/entreluma-preview.json`), `entreluma:` viewer messages, and `window.Entreluma`/`initEntreluma` to match the publishing template. Internal `sk` CSS hooks and the `skrender.js` filename remain. This is a clean Entreluma application, not an automatic compatibility upgrade for old browser databases or StoryKit packages.

The bundled runtime comes from the local `rsnyder/entreluma` working tree. Historical author guides and media remain exclusively as test data, so the existing viewer/rendering regression coverage is preserved. Old design/progress documents, the GitHub Pages transition/recovery deployment, and its daily scheduled workflow were omitted.

Production deployment is configured for `editor.entreluma.org`. The existing Cloudflare Worker was renamed to `entreluma-editor`, retaining its D1 database (still named `storykit-editor`) and encrypted secrets. The existing GitHub OAuth application was renamed Entreluma Editor and its homepage and callback moved to the custom domain. Production configuration records the existing public client and database identifiers. The source service directory remains `prototypes/github-auth/` to avoid unrelated path restructuring.

Map previews fetch visible OSM tiles through a constrained browser message bridge. The editor sends its own origin-only referrer, omits credentials, and uses normal browser caching. The sandbox receives image blobs only; it cannot fetch arbitrary URLs or access editor storage. Published maps use OSM directly. The preview uses the bundled map consumer for this bridge.


## Hero-image fix — 2026-09-11

Deployed version `fb70aa87-634c-4f22-87ed-cd788a4cdbc6` to
`editor.entreluma.org`. When deployment supplies the site URL at build time,
repository-relative hero and Markdown images resolve from the pinned repository
revision instead of the editor host. External URLs and managed local files retain
their existing resolution. The 497 browser unit tests passed. Live verification
opened the public entreluma-site Monument Valley essay: the 4032×3024 hero decoded
successfully and no unrendered Liquid tags or expressions appeared in preview.
Current Entreluma branding and the map-tile bridge were retained.

### 2026-09-11 — Monument Valley YouTube preview

Deployed editor version `ae9903ba-f8c1-41a3-9487-370ec6ee4d05` to
https://editor.entreluma.org/editor/.

Repositories without a configured public URL now use standard Entreluma viewer
and host assets instead of requesting blocked components from the editor origin.
Configured publication URLs continue to select their own viewer assets.

YouTube's player currently throws a Cache Storage SecurityError when nested in
the opaque publication preview. The preview keeps its sandbox. A bounded bridge
handles YouTube expansion in an editor-owned modal containing only a constructed
`youtube-nocookie.com/embed/<validated-video-id>` URL. It checks the sending frame,
render generation, and registered video ID, restricts playback bounds to numeric
values, and removes the player on close, rerender, or pane destruction. No
publication HTML, arbitrary URL, credentials, or editor API crosses the bridge.
The player has a separate cross-origin sandbox and an origin-only referrer.

Validation: 502/502 browser unit tests passed. Live Chrome opened both video
thumbnails in the public Monument Valley essay. `yg0As_HOvJk` autoplayed (readyState
4, time advancing beyond 7 seconds); `GGyiZ7SE3V4` played after pressing Play
(readyState 4, time advancing beyond 14 seconds). Both dialogs closed normally.
No essay content was edited or synced during validation.

### 2026-09-11 — Contain YouTube expansion in the preview panel

Deployed `29530ec3-3514-41ae-bbf0-e51c9bf0ead9`. The YouTube dialog now
uses a positioned, nonmodal overlay in the preview frame wrapper instead of a
page-wide top-layer modal. Its shading and player stay inside the preview as it
resizes; the Markdown editor remains interactive. Only the preview iframe is
inert while playback is open, and closing restores its prior state. The player
continues to run outside the opaque publication iframe with the same URL and
message validation and separate cross-origin sandbox.

Validation: 503/503 browser unit tests passed, including narrow-panel bounds,
nonmodal behavior, editor focus, and cleanup. Live Chrome visually confirmed
playback within the right-hand preview panel; the close button stopped it.
