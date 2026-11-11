# 公开 Wiki 与知识图谱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理员可以逐篇发布 Wiki 页面；未登录访客只能浏览当前发布的 Wiki 快照和由其生成的只读图谱。

**Architecture:** SQLite 保存公开版本、页面和图片；管理员预览生成有界、会话绑定的不可变候选，事务提交后原子切换活动 revision。匿名 API 只读取活动快照，守卫只精确放行公开 GET/HEAD；Web 提供独立访客 shell 和受保护的发布面板。

**Tech Stack:** Hono、Node.js、SQLite/better-sqlite3、React/Vite、`@molio/contracts`、node:test、Playwright。

**Spec:** [第三期公开 Wiki 与图谱设计](2026-11-11-public-wiki-graph-design.md)。

## Global Constraints

- 公开范围为管理员逐篇选择；访客读取不可变快照，源文件变化仅在再次预览并发布后生效。
- 首期一个公开站点绑定一个 vault；候选页面来自该 vault 的 `wiki/` 下 Markdown；默认关闭站点。
- 匿名访问只读快照，不得读取 source vault、管理 API、聊天、配置、云账户或其他管理能力。
- 公开图谱只包含已发布页面节点及两端均公开的边；响应不得包含 vault ID、源路径、死链或私有页面元数据。
- 图片只允许预览确认的本地 PNG/JPEG/GIF/WebP；SVG、HTML、脚本、远程图片及其他附件不发布。原图元数据保留，预览需提示管理员自行检查。
- 发布/撤回/启停必须通过现有管理员会话、可信 Origin 与 CSRF；发布失败不得改变活动版本。
- 容量上限：每个活动 revision 最多 1,000 篇页面、20,000 条图谱边；单篇 Markdown UTF-8 不超过 512 KiB、单页最多 50 个不同图片资源；单张图片不超过 8 MiB；整批 Markdown 与图片原始字节合计不超过 48 MiB；同一时间一个预览候选，10 分钟过期、重启清空。超限明确失败，不截断。
- 代码改动用 node:test/Playwright 覆盖真实行为；完整 Web E2E 按根 `AGENTS.md` 对受影响核心文件的要求执行。
- 不合并 PR、不推送、不部署公网；推送前需按根 `AGENTS.md` 运行 OCR delegate 自检。

## Review Focus

1. 私有页面标题/路径通过错误、链接、图谱或资源 URL 泄漏：匿名 API 路由测试必须断言这些字段与原始私有标记均不存在。
2. 发布/撤回/关闭和匿名读取交错：持久化集成测试必须证明每次读取只能得到完整旧 revision 或完整新 revision，关闭状态不能被并发发布覆盖。
3. 不可信 Markdown、伪装图片、符号链接和编码路径：快照与匿名路由测试必须验证不执行脚本、不越过 vault、不进入管理员路由。
4. 预览后源文件变化、会话变化或候选过期：必须验证无法以不同会话提交，也不会提交预览后修改的新源内容。
5. 公开访客 shell 与管理员 App 的加载边界：真实浏览器测试必须验证匿名深链刷新正常，且没有管理 API/私有业务请求或管理 DOM。

---

## Files and Interfaces

- `packages/contracts/src/publication.ts`：公开 API、管理员预览/发布输入输出与快照 DTO；不含本地路径字段。
- `apps/daemon/src/core/publication/`：迁移、快照构建、媒体白名单、预览候选生命周期、活动 revision 存储。只有管理员侧内部函数可读源路径。
- `apps/daemon/src/routes/publication.ts`：管理员候选、预览、提交、撤回和站点启停 API。
- `apps/daemon/src/routes/public.ts`：匿名站点摘要、页面、图谱和图片读取 API；只依赖活动 revision 存储接口。
- `apps/daemon/src/core/access/guard.ts`：精确放行匿名 GET/HEAD 路由；其余 API 仍受管理员保护。
- `apps/web/src/components/public/`：不挂载 `App`/`AccessBoundary` 的只读公开 shell、Wiki 页面和图谱视图。
- `apps/web/src/components/publication/` 与 `apps/web/src/api/publication.ts`：管理员发布选择、预览确认和状态操作。
- `apps/web/e2e/publication-*.spec.ts`：local UI 回归和真实 HTTPS server 验收。

稳定接口（以 contracts 定义为准）：

```ts
GET  /api/public/site
GET  /api/public/pages/:pageId?revision=<activeRevision>
GET  /api/public/graph?revision=<activeRevision>
GET  /api/public/assets/:assetId?revision=<activeRevision>
GET  /api/publication/status?vaultId=<admin-selected-vault>
POST /api/publication/preview
POST /api/publication/commit
POST /api/publication/withdraw
POST /api/publication/site
```

公开 `site` 响应含 `enabled`、`revision` 和公开页面摘要；管理员 `status` 响应含已发布页面与当前 vault 候选映射。管理员预览请求只接收 `vaultId` 和相对 `wiki/` 路径，管理员预览响应可显示源路径以供核对。公开 `PublicPage`、`PublicGraph` 和 `PublicAsset` DTO 不含源 vault、源路径、私有链接目标或本地 frontmatter。

---

### Task 0: Baseline, Capacity Limits, and Isolated Branch

**Files:**
- Read: `HANDOFF.md`, `HANDOFF2.md`, `AGENTS.md`, phase 2 design/acceptance docs, phase 3 design.
- Modify: `docs/2026-11-11-public-wiki-graph-design.md`, this plan.
- Create branch/worktree from `feat/admin-web-access` at `124c205e81415da12468b914b62512e7c883f1fd`.

**Interfaces:**
- Produces: numeric limits for page bytes, asset bytes, total revision bytes, page count, preview candidate count/TTL; feature branch based on verified phase 2 source.

- [x] Confirm live PR #1/#2 state and source SHA; record no-merge/no-push status and the selected implementation base.
- [x] Create an isolated worktree branch `feat/public-wiki-graph` from the clean phase 2 base; do not modify the original workspace or phase 2 worktree.
- [x] Use only synthetic Markdown and generated/scrubbed image fixtures to measure SQLite insertion size/time and resident memory at proposed limits. Never read/output user vault content.
- [x] Select and record limits in the design: 1,000 pages/revision, 20,000 graph edges, 512 KiB Markdown/page, 50 distinct image refs/page, 8 MiB/image, 48 MiB aggregate raw content, one candidate with 10-minute expiry; document the synthetic benchmark and headroom.
- [x] Verify the phase 2 worktree baseline with `pnpm --filter @molio/contracts build`, `pnpm --filter @molio/daemon typecheck`, and `pnpm --filter @molio/daemon exec tsx --test test/access/guard.test.ts test/routes/access.test.ts`; record exact command/result before source edits.
- [ ] Commit the approved design, measured capacity limits, and implementation plan as `docs(kb): plan public wiki and graph`.

### Task 1: Contracts and Atomic Publication Store

**Files:**
- Create: `packages/contracts/src/publication.ts`
- Create: `apps/daemon/src/core/publication/migration.ts`
- Create: `apps/daemon/src/core/publication/store.ts`
- Create: `apps/daemon/src/core/publication/project.ts`
- Create: `apps/daemon/test/core/publication.test.ts`
- Modify: `packages/contracts/src/index.ts`, `apps/daemon/src/core/db.ts`

**Interfaces:**
- Consumes: Task 0 numeric limits.
- Produces: `PublicSite`, `PublicPage`, `PublicGraph`, `PublicationStatus`, `PublicationPreview`, `PublicationPreviewRequest`, `PublicationCommitRequest`, `PublicationWithdrawRequest`, `PublicationSiteRequest`; `buildPublicationDraft(input: PublicationBuildInput): Promise<PublicationDraft>`; `createPublicationPreview(sessionKey: string, draft: PublicationDraft): PublicationPreview`; `commitPublicationPreview(sessionKey: string, previewId: string, expectedRevision: number): PublicationRevision`; `withdrawPublishedPages(expectedRevision: number, pageIds: string[]): PublicationRevision`; `setPublicationSiteEnabled(expectedRevision: number, enabled: boolean): PublicationRevision`.
- `PublicGraph` contains only `{nodes: {id,title}[], edges: {source,target}[]}`.
- `PublicPage` contains `id`, `title`, rendered-safe Markdown, and approved asset references, never a source path.

- [ ] Export `PublicSite`, `PublicPage`, `PublicGraph`, `PublicAsset`, `PublicationStatus`, `PublicationPreviewRequest`, `PublicationPreview`, `PublicationCommitRequest`, `PublicationWithdrawRequest`, and `PublicationSiteRequest` from `packages/contracts/src/index.ts`; assert public runtime DTOs have no `path`, `vaultId`, `deadLinks`, or frontmatter passthrough fields.
- [ ] Add migration/store tests for an empty closed site, schema migration from phase 2, revision activation, and process reopen restoring the active version.
- [ ] Add publication projection tests with public pages A/B and private C, where A links to B and C; serialized output includes A/B and A→B only and contains no C title/path or dead-link data.
- [ ] Add incremental publication tests: publish A/B, revise and republish A, prove B is preserved and A changes only after commit; source rename/deletion does not mutate the active snapshot.
- [ ] Assert each source document receives a random public ID that remains stable across updates to that source; public responses cannot derive source paths from IDs.
- [ ] Assert replacing a revision removes unreferenced prior snapshot data while assets referenced by another page remain; transaction rollback preserves the prior active revision.
- [ ] Add asset and Markdown tests for traversal, symlink escape, invalid signature/extension mismatch, unsupported format, over-limit bytes, missing files, raw HTML, dangerous URL schemes, duplicate titles, and unpublished wikilinks.
- [ ] Add candidate tests proving immutable preview contents, session binding, expiry, one-candidate bound, preview invalidation after restart, and expected-revision conflict behavior.
- [ ] Add transaction/concurrency tests with injected write failure and competing publish/withdraw/site-disable operations; active state is always a complete revision, and site disable cannot be undone by a racing commit.
- [ ] Run `pnpm --filter @molio/daemon exec tsx --test test/core/publication.test.ts` before implementation; verify failures are missing publication behavior rather than test harness errors.
- [ ] Implement schema and store operations in `apps/daemon/src/core/publication/`; use SQLite transactions to persist the complete new revision and switch its active pointer atomically. Keep source selection metadata in admin-only tables separate from public snapshots.
- [ ] Run `pnpm --filter @molio/contracts build`, `pnpm --filter @molio/daemon exec tsx --test test/core/publication.test.ts`, and `pnpm --filter @molio/daemon typecheck`; all pass.
- [ ] Commit as `feat(kb): add public publication snapshot store`.

### Task 2: Anonymous Read API and Protected Admin API

**Files:**
- Create: `apps/daemon/src/routes/public.ts`
- Create: `apps/daemon/src/routes/publication.ts`
- Create: `apps/daemon/test/access/publication-routes.test.ts`
- Modify: `apps/daemon/src/core/access/guard.ts`, `apps/daemon/src/server.ts`

**Interfaces:**
- Consumes: Task 1 contracts and store API.
- Produces: exact anonymous GET/HEAD routes and session/CSRF-protected publication operations; no endpoint accepts a client-supplied filesystem path for anonymous reads.

- [ ] Write the guard method/path matrix first: only exact site/page/graph/asset GET and HEAD routes bypass admin auth; write methods, unknown paths, invalid IDs, encoded separators, repeated slashes, backslashes, and lookalike paths remain unauthorized.
- [ ] Write admin route tests proving missing/expired session, wrong Origin, missing/incorrect CSRF, logout, and replaced session cannot preview, commit, withdraw, or change site state; a valid admin session can.
- [ ] Write anonymous response tests for closed site, nonexistent/unpublished/withdrawn IDs, and invalid IDs returning the same unavailable status/body; prove correct content type, `nosniff`, `no-store`, and no source metadata.
- [ ] Write revision tests: after site returns R1 and R2 commits, requests for page/graph/asset with R1 cannot read old content; all R2 responses agree on R2.
- [ ] Run `pnpm --filter @molio/daemon exec tsx --test test/access/publication-routes.test.ts` before implementation; verify the failures identify missing route/guard behavior.
- [ ] Implement routes using one database read transaction to validate active revision and read response data; attachments use stored approved blobs only.
- [ ] Register routes and exact guard allowlist; preserve the existing management API behavior and default server-mode denial.
- [ ] Run `pnpm --filter @molio/daemon exec tsx --test test/access/publication-routes.test.ts`, then `pnpm --filter @molio/daemon test` and daemon typecheck; inspect counts and exit codes.
- [ ] Commit as `feat(daemon): add public wiki publication api`.

### Task 3: Administrator Publication UI and Public Visitor Shell

**Files:**
- Create: `apps/web/src/api/publication.ts`
- Create: `apps/web/src/components/public/PublicSite.tsx`
- Create: `apps/web/src/components/public/PublicWikiPage.tsx`
- Create: `apps/web/src/components/public/PublicGraphPage.tsx`
- Create: `apps/web/src/components/publication/PublicationPanel.tsx`
- Create: corresponding CSS modules, localized strings, and `apps/web/e2e/publication-ui.spec.ts`
- Create: `apps/web/e2e/publication-server.spec.ts`
- Modify: `apps/web/src/main.tsx`, `apps/web/src/components/kb/KnowledgeBasePage.tsx`, `apps/web/playwright.admin.config.ts`, `apps/web/e2e/area-map.json`; modify `MdRenderer.tsx` only if a test demonstrates a missing sanitization boundary.

**Interfaces:**
- Consumes: Task 1 public/admin contracts and Task 2 API routes.
- Produces: independent public route shell outside the admin boundary; admin panel uses existing authenticated `daemonFetch`; public UI calls only `/api/public/*`.

- [ ] Add Playwright tests for the source selection list and per-page selection in the chosen vault's `wiki/` tree; pages outside `wiki/` cannot enter the candidate.
- [ ] Add tests for previewing body, links and image inventory, source edits after preview, commit of exact preview bytes, preserved already-published pages, page withdrawal, and clear failure/expiry/conflict feedback.
- [ ] Add anonymous navigation tests for `/public/wiki` → page → `/public/graph` node → page, direct deep link, refresh, narrow viewport, keyboard navigation, and revision change during concurrent page/graph reads.
- [ ] Add real HTTPS server-browser tests for anonymous reads, administrator writes, login/session expiry, withdrawal/site close, deep-link refresh and response-header/no-leak assertions using an isolated DB/vault fixture.
- [ ] Assert public route network traffic contains only site/page/graph/approved asset reads; private `App`, admin API, `/api/knowledge/*`, and `/api/graph/*` are never loaded in anonymous mode.
- [ ] Run the targeted publication Playwright specs before UI implementation; record expected failures for the missing route/shell and ensure no fixture or port errors mask the result.
- [ ] Implement publication panel with explicit preview confirmation, enabled/disabled state, selected/published status and withdrawal; enforce the site/vault switch confirmation described by the design.
- [ ] Implement isolated public shell and revision-aware client; on revision conflict reload site state and discard mixed-version data. Render Markdown as untrusted content, block disallowed images/URLs, and map wikilinks only to published page IDs.
- [ ] Add required `data-testid`s, register both specs in `playwright.admin.config.ts` `testMatch`, and update `area-map.json`; run `pnpm --filter @molio/web exec playwright test -c playwright.admin.config.ts e2e/publication-ui.spec.ts e2e/publication-server.spec.ts`, then Web typecheck and tests.
- [ ] Commit as `feat(web): add public wiki and graph experience`.

### Task 4: Isolated HTTPS Acceptance and Full Regression

**Files:**
- Create: `docs/phase3-public-wiki-graph-acceptance.md`
- Modify: test fixtures/config only where needed; never weaken existing admin fixture assertions.

**Interfaces:**
- Consumes: completed daemon API and Web UI.
- Produces: repeatable HTTPS Chromium coverage and a factual acceptance record with logs, skips, and platform/deployment limits.

- [ ] Run the server-browser suite from Task 3 with a fresh daemon DB, two temporary vaults, generated TLS proxy, synthetic wiki content and deterministic test credentials; do not use real user data or terminate existing services.
- [ ] Confirm the Task 1/2 integration suite covers shared/private link projection, image allowlist, traversal and hostile Markdown, publication failure/concurrency, withdrawal/site disable, restart persistence; report missing coverage rather than infer it.
- [ ] Inspect browser requests and responses for private marker strings, source paths, vault IDs, admin cookies/CSRF leakage, caching headers, and mixed revisions.
- [ ] Run `pnpm typecheck`, `pnpm --filter @molio/daemon test`, `pnpm --filter @molio/web test`, targeted HTTPS E2E, and the complete Web E2E suite required by root `AGENTS.md`; record command, exit code, pass/fail/skip counts, reason for each skip, and artifact paths.
- [ ] If the test run reports failures, follow systematic debugging and add regression tests for each confirmed bug before fixing; rerun affected and required full suites.
- [ ] Complete the acceptance document from actual results. Do not claim production reverse-proxy, real certificate, Windows/macOS, merge, or public deployment validation unless performed in that environment.
- [ ] Review `git diff`, run `git diff --check`, inspect OCR delegate preview/rules for the proposed branch diff, and self-review the changes. Do not push or merge without a later explicit request.
- [ ] Commit as `docs(kb): record public wiki acceptance`.

## Dependencies and completion order

Task 0 establishes the clean phase 2 base and capacity limits. Task 1 defines storage and DTOs. Task 2 consumes those interfaces for the server boundary. Task 3 uses the API and provides visitor/admin UI. Task 4 exercises the full assembled system. Anonymous access is not complete until both server and Web tests pass.

Implementation method: native inline execution in the feature worktree, following `superpowers:executing-plans` and test-first for each code change. The user's instruction authorizes implementation through completion; no merge, push, or production deploy is included.
