# Entreluma editor service

Serves the editor and its GitHub authentication/workspace API from one Cloudflare Worker. The directory name is retained from the original implementation.

## Local development

From this directory, run `npm ci`, then `npm run demo` for the fake-GitHub demo at `http://127.0.0.1:8787`. The demo uses in-memory SQLite and cannot make real GitHub commits. `npm test` runs service tests.

For Wrangler development, use `wrangler.jsonc`, apply local migrations with `npm run db:local`, and copy `.dev.vars.example` to `.dev.vars` for local secrets. Build full editor assets from the repository root with `node prototypes/github-auth/tools/build-editor.mjs`.

## Production setup

Run these commands from `prototypes/github-auth/`. `wrangler.production.jsonc` targets the renamed `entreluma-editor` Worker at `https://editor.entreluma.org` and redirects `/` to `/editor/`. It records public account, database, and OAuth client identifiers; secrets remain in Cloudflare.

The existing D1 database is still named `storykit-editor`. Keep this binding and the existing `TOKEN_ENCRYPTION_KEY` to preserve encrypted server data. The GitHub OAuth application is now **Entreluma Editor**, with homepage `https://editor.entreluma.org/editor/` and callback `https://editor.entreluma.org/api/auth/callback`.

1. Authenticate Wrangler to the configured Cloudflare account.
2. Check migrations: `npx wrangler d1 migrations list DB --remote --config wrangler.production.jsonc`. Apply pending migrations only when required by an update.
3. Review a dry run: `npx wrangler deploy --dry-run --config wrangler.production.jsonc`.
4. Deploy: `npx wrangler deploy --config wrangler.production.jsonc`.

For an independent deployment, provision a separate D1 database and OAuth application, replace the public identifiers and domain, and install `GITHUB_CLIENT_SECRET` plus a base64-encoded 32-byte `TOKEN_ENCRYPTION_KEY` through Wrangler secret commands. Keep secrets out of source control.

The interactive `npm run configure:github` helper prompts for the OAuth client ID and secret, installs the secret, updates the production config, and deploys. Use it only after the database and encryption key are ready.

The requested GitHub `repo` scope supports private and collaborator repositories. It does not bypass organization restrictions. The browser never receives the OAuth token; the Worker encrypts tokens in D1.

A new origin has separate browser storage. Export local drafts and packages from the old editor and import them into Entreluma. The renamed Worker retains server data, but the new origin requires a fresh browser sign-in.
