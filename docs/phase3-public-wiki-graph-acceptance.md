# Phase 3 — Public Wiki and Graph Acceptance

Date: 2026-11-12

## Delivered

- Administrators select Markdown pages from the active vault's `wiki/` directory, review an immutable preview, and explicitly commit it as a new snapshot revision.
- A revision includes only selected pages and retained pages already in the snapshot. Updating one page does not expose source edits until its preview is committed. Published pages can be withdrawn individually; the visitor site can be enabled or closed separately.
- Public page links and graph edges are resolved only between pages in the same published snapshot. Local image references are copied into snapshot storage only when the image is an approved PNG/JPEG/GIF/WebP; remote, unsupported, missing, and escaping references are removed from the projection and noted in admin preview warnings.
- Anonymous `/public/wiki/*` and `/public/graph` views are mounted outside the administrator boundary and use only `/api/public/*`. Rendered Markdown is sanitized in the browser; raw image sources are accepted only when they point at a revision-scoped public asset.
- SQLite stores the active snapshot. In-memory preview candidates are session-bound, single-use, expire after ten minutes, and disappear on process restart.

## Boundaries and limits

- One public site is bound to one vault at a time. Pages must be Markdown under `wiki/`.
- Per revision: 1,000 pages, 20,000 graph edges, 48 MiB aggregate raw Markdown and unique image bytes. Per page: 512 KiB Markdown and 50 distinct images. Per image: 8 MiB. Exceeding a limit fails the preview without truncation.
- Public endpoints disclose only the active revision. Closed sites, stale revisions, missing pages, and unavailable assets do not return source-vault metadata.
- No PR push, merge, public deployment, real reverse-proxy/certificate validation, or Windows/macOS package validation was performed.

## Verification

| Command | Result |
|---|---|
| `pnpm typecheck` | Passed across all workspace packages. |
| `pnpm --filter @molio/daemon test` | 2,053 passed, 0 failed, 12 skipped (2,065 total). |
| `pnpm --filter @molio/web test` | 632 passed, 0 failed, 0 skipped. |
| Targeted isolated HTTPS publication E2E | 2 passed: per-page publishing/visitor graph navigation and active-revision/withdrawal headers. |
| `pnpm --filter @molio/web exec playwright test` | Full Web E2E: 652 passed, 1 skipped, 0 failed (653 total, 33.8 minutes). |

The isolated HTTPS specs use generated Wiki fixtures, temporary SQLite storage, generated TLS certificates, and an ephemeral daemon. Public visitor request capture verified only `/api/public/*`; a Markdown script marker did not execute and an HTML image did not request a private API path. Response checks verified `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and a uniform unavailable response after withdrawal.

The first full E2E run exposed missing `ignoreHTTPSErrors` on the administrator browser context in the new publication UI spec. Both publication specs now explicitly accept their generated test certificates. The affected UI spec passed alone, and the subsequent full E2E run passed with the results above.

## Acceptance artifacts

- Full Web E2E HTML report and Playwright traces: `apps/web/playwright-report/` and `apps/web/test-results/` (generated locally; not committed).
- Source branch: `feat/public-wiki-graph` in the isolated worktree `/home/ss/.codex/worktrees/f1fa/molio`.

## Boundary repair follow-up

Date: 2026-11-13

The independent review findings were addressed in the local feature branch:

- Public site, page, graph, and asset responses now read state and content within one SQLite transaction. Requests started after close or revision change return the same unavailable response; an in-flight read can finish from its coherent prior snapshot.
- Server preview candidates are bound to the digest of the verified administrator session. Local mode uses the documented process-local identity.
- Public Markdown rewriting and revision retry are covered by focused web unit tests. Navigation clears the previous page while a stale response is retried.
- Publication preview now shows the base content revision and selected page count as separate values. The page test selector uses its published ID rather than a fixture filename.
- `enabled` is a separate visitor access gate and does not advance the content revision. `PublicSite.tsx` remains the route/navigation shell; Markdown projection and revision fetch/retry live in focused modules.

Repair verification on 2026-11-13:

| Command | Result |
|---|---|
| `pnpm typecheck` | Passed across all workspace packages. |
| `pnpm --filter @molio/daemon test` | Passed; includes atomic read and preview principal regression coverage. |
| `pnpm --filter @molio/web test` | 639 passed, 0 failed, 0 skipped. |
| `pnpm --filter @molio/web exec playwright test -c playwright.admin.config.ts e2e/publication-ui.spec.ts e2e/publication-server.spec.ts` | 2 passed. |
| `pnpm --filter @molio/web exec playwright test` | 652 passed, 1 skipped, 0 failed (653 total, 33.9 minutes). The skip is the existing `kb-large-file-too-large` case. |
| `git diff --check 124c205..HEAD` | Passed. |

No push, merge, deployment, reverse-proxy/certificate validation, or Windows/macOS package validation was performed. Changes remain in the isolated local feature worktree pending review.
