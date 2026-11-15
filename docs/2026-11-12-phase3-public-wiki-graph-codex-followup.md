# 第三阶段验收结论与后续任务（Codex执行清单）

- 日期：2026-11-12
- 验收对象：`/home/ss/.codex/worktrees/f1fa/molio`，分支 `feat/public-wiki-graph`，HEAD `7cd3391`
- 完整验收记录：`docs/2026-11-12-phase3-public-wiki-graph-acceptance.md`
- 本文用途：把验收结论和待办整理成可执行的清单。**所有门禁数字来自验收方独立复跑，不是引用自述。**

## 一、结论

**有保留通过。**设计与 §6的完成条件在功能与边界层面成立，五项门禁全部独立复跑通过；但第二节4项 P0建议在合并前改掉，因此不是无条件通过。

复跑结果（worktree、HEAD `7cd3391`、`CI=1`、端口空闲、未复用残留 server）：

|门禁 |结果 | EXIT |
|---|---|---|
| `pnpm typecheck` |7个 TS工程全部 Done |0 |
| `pnpm --filter @molio/daemon test` |2,065项 /2,053 pass /0 fail /12 skip（12个均为 win32-only或 PyMuPDF缺失，与本期无关） |0 |
| `pnpm --filter @molio/web test` |632项 /632 pass /0 fail /0 skip |0 |
|定向公开页 E2E（`playwright.admin.config.ts` +两份 publication spec） | `2 passed (30.3 s)` |0 |
|全量 Web E2E | `653 tests using 1 worker` → **652 passed /1 skipped /0 failed（33.5m）**；唯一跳过是既有用例 `kb-large-file-too-large.spec.ts:35:3` |0 |

边界成立的部分（已被代码复核 +隔离 daemon活体探测确认）：

- `/api/public/*`在 `guard.ts`有独立 allowlist，与管理员会话解耦；UUID精确匹配，其余一律统一 `404 {"error":"unavailable"}`。
- 所有 `/api`响应带 `Cache-Control: no-store`；公开响应另带 `X-Content-Type-Options: nosniff`；HEAD与 GET走同一门禁。
- 公开页挂在 `AccessBoundary`之外，裸 `fetch(..., {credentials:'omit'})`；E2E捕获匿名上下文的全部 `/api/`请求并断言前缀只能是 `/api/public/`。
- Markdown先 DOMPurify白名单净化，再把 `<img src>`收窄到 `^/api/public/assets/<uuid>?revision=N$`。
- `project.ts`用 `realpath`做越界校验、扩展名与文件头双检、字节上限、代码块区间跳过；投影文本只含不透明资产 ID。

分支状态：`feat/public-wiki-graph` **从未推送**（origin与 backup都没有该分支，无 upstream），一期/二期分支也只在 backup。Git工作树干净。

---

## 二、P0：合并前必须改（4项）

### P0-1公开读路径没有落实「同一读事务」

- **位置**：`apps/daemon/src/routes/public.ts:30-35`、`:41-44`、`:50-54`；`apps/daemon/src/core/publication/store.ts:143-160`、`:215-237`
- **现状**：路由先 `store.getPublicSite()`判断 `enabled`/`revision`，再单独调 `getPublicPage` / `getPublicGraph` / `getPublicAsset`；store内部也是先 `getState()`再读数据。两次读取之间若发生 commit，会出现「刚关闭站点仍返回本页」「刚切 revision却返回不可用」的瞬时不一致。
- **计划要求**：`docs/2026-11-11-public-wiki-graph-plan.md` Task2原文——「Implement routes using one database read transaction to validate active revision and read response data」。
- **要求**：要么把「校验 enabled + revision」与「取响应数据」放进同一个 `db.transaction(...)`（better-sqlite3同步事务，成本很低）；要么在设计与计划里明确写下不做的理由。二选一，不能保持现状。
- **验收**：新增用例——在 `publication.test.ts`里用 mock/拦截在两次读之间插入一次 commit，断言响应要么整体属于旧快照、要么整体404，不会出现「enabled已关但仍返回页面正文」。

### P0-2生产代码为测试 fixture特判 `data-testid`

- **位置**：`apps/web/src/components/publication/PublicationPanel.tsx:81`
- **现状**：

 ```tsx
 data-testid={`publication-page-id-${sourcePath.endsWith('public-a.md') ? 'public-a' : sourcePath}`}
 ```

用 fixture文件名决定 testid，属于为了测试污染生产代码。
- **要求**：删除该 testid，或改成与文件名无关的稳定值（如 `publication-withdraw-${page.id}`）。E2E已有更好的定位范式——`publication-server.spec.ts:28`用 `getByRole('button', { name: '撤回' })` + `data-page-id`，照抄即可。
- **连带改动**：`apps/web/e2e/publication-ui.spec.ts:58`用了 `getByTestId('publication-page-id-public-a')`，需同步改为按行定位：

 ```ts
 const row = page.getByTestId('publication-page-row').filter({ hasText: 'public-a.md' });
 const pageId = await row.getByRole('button', { name: '撤回' }).getAttribute('data-page-id');
 ```

- **验收**：`grep -r "public-a.md" apps/web/src`无结果；两份 publication E2E仍通过。

### P0-3预览标题把「页数」当「版本号」显示

- **位置**：`apps/web/src/components/publication/PublicationPanel.tsx:87`
- **现状**：

 ```tsx
 <p>{t('publicWiki.revision', { revision: preview.pageCount })} · {preview.totalBytes} bytes</p>
 ```

 `publicWiki.revision`的文案是「版本 {revision}」，于是界面显示成「版本12」而12其实是页数。这是用户可见的错误信息，且 `preview.expectedRevision`本来就有。
- **要求**：版本用 `preview.expectedRevision`（或提交后将成为的 revision，按语义选定并保持一致），页数改用新 key（如 `publicWiki.pageCount`: `'共 {count}篇'`），en/zh两份 locale都要加。
- **验收**：预览区同时出现正确的版本号与页数；`publicWiki.pageCount`在 `en.ts` / `zh.ts`都存在。

### P0-4 `git diff --check`不通过

- **位置**：`apps/web/e2e/publication-ui.spec.ts:77` —— `new blank line at EOF`
- **要求**：删掉文件末尾多余空行。
- **验收**：`git diff --check "124c205"..HEAD`无输出。

---

## 三、P1：建议处理（5项，可与 P0同批或后续）

### P1-1公开页渲染规则没有单元测试

`PublicSite.tsx`里的 `renderPublicMarkdown`负责三种改写（`molio-page:` / `molio-asset:` / `molio-unavailable:`）和 `<img>`白名单正则，目前只被 E2E间接覆盖，且函数未导出、无法单测。链接改写是最容易回归的一层。建议导出该函数并补 `apps/web/src/**/*.test.ts`：三种改写、`<img>` src不匹配时必须被移除、404重试后的降级渲染。

### P1-2预览会话绑定用 cookie原文

`apps/daemon/src/routes/publication.ts:35`、`:43`把 `c.req.header('cookie') ?? ''`直接当 `sessionKey`。后果：重新登录（cookie变化）会让未提交的预览静默失效；本地模式没有 cookie，所有预览共享空串 key，等于没有绑定。建议改用会话 ID，并在设计里写清本地模式下预览绑定的语义。

### P1-3 `getInternalPages`的 N+1查询

`apps/daemon/src/core/publication/store.ts:26-42`：先查全部页面，再对每页单独查一次资产。按本期上限1,000页，状态接口会放大到千次查询。改成一次 join后内存分组即可。

### P1-4 `setSiteEnabled`不推进 revision

`store.ts`里只 `UPDATE publication_state SET enabled = ?`，revision不变。于是同一 revision不完全等价于「同一公开状态」。有 `no-store`兜底，暂无缓存危害，但设计里 revision作为公开地址参数的约定需要补一句说明，或让开关也推进 revision。

### P1-5计划点名的组件未落地

计划 Task3写的是 `PublicWikiPage.tsx` / `PublicGraphPage.tsx`，实际是单个 `PublicSite.tsx`（107行，图谱为内联 SVG）。行为等价，但应在计划/设计里对齐文件结构，避免后续按文档找文件时对不上。

---

## 四、文档对齐

- `docs/phase3-public-wiki-graph-acceptance.md`是自述证据，内容与本次复跑一致，可保留；建议补一句指向 `docs/2026-11-12-phase3-public-wiki-graph-acceptance.md`（独立验收记录）。
- P0-1若选择「不做单事务」，必须同时改 `2026-11-11-public-wiki-graph-plan.md` Task2的措辞，不要让计划与实现长期不一致。

---

## 五、改完后的复跑与提交要求

按顺序执行，四项都必须绿：

```bash
cd /home/ss/.codex/worktrees/f1fa/molio

pnpm typecheck #期望 EXIT=0
pnpm --filter @molio/daemon test #期望0 fail；skip仍为12（win32/PyMuPDF）
pnpm --filter @molio/web test #期望0 fail
pnpm --filter @molio/web exec playwright test -c playwright.admin.config.ts \
 e2e/publication-ui.spec.ts e2e/publication-server.spec.ts #期望2 passed
pnpm --filter @molio/web exec playwright test #全量，期望652 passed /1 skipped /0 failed
git diff --check "124c205"..HEAD #期望无输出
```

改动触及 P0-2/P0-3时，`publication-ui.spec.ts`必须同 commit更新（`data-testid`变更属强制同步项）。E2E全量这一条：改动了 `PublicationPanel.tsx`与公开页渲染相关文件，必须重跑全量，不能用定向2项代替。

提交仍走 PR流程（分支 `feat/public-wiki-graph`，base `main`），push前先跑 OCR delegate自检。

---

## 六、本轮边界（不要做的事）

- **不要推送、合并或部署**：本次验收按设计 §7只在本地进行；`feat/public-wiki-graph`至今未推送，保持这个状态直到 P0修完并显式获批。
- **不要为了过 lint/测试重写文件**：P0-4只删一个空行，P0-2/P0-3是局部改动。
- **不要删除或跳过既有 E2E用例**来让全量变绿；唯一允许的跳过是既有 `kb-large-file-too-large.spec.ts:35:3`这一条。
- **新增测试必须用合成 fixture**，不要引入真实 vault内容或任何凭据。

---

## 附：证据位置

|内容 |路径 |
|---|---|
|完整验收记录 | `docs/2026-11-12-phase3-public-wiki-graph-acceptance.md` |
|设计与 §6完成条件 | `docs/2026-11-11-public-wiki-graph-design.md` |
|实施计划 Task0–4 | `docs/2026-11-11-public-wiki-graph-plan.md` |
| Codex自述证据 | `docs/phase3-public-wiki-graph-acceptance.md` |
|全量 E2E原始输出 | `/tmp/acc-p3/full-e2e.log2`（101 KB；同目录 `full-e2e.log`因重定向写法只含 `EXIT=0`，不要当作证据） |
| daemon / web单测原始 TAP | `/tmp/acc-p3/g2.log`、`/tmp/acc-p3/g3.log` |

---

## 七、合并策略现状（2026-11-14，用户决定）

本节覆盖第五节里「提交仍走 PR 流程（base `main`）」这一句，其余要求不变。

- 分期功能采用 fork `manoloss612/Molio` 内依赖链：`main ← codex/phase1-admin-access-backup (PR #1) ← feat/admin-web-access (PR #2) ← feat/public-wiki-graph (PR #3)`。三期的验收项已全部关闭，PR #3 已推送并处于 Ready for review（HEAD `66ff5f2`）。
- **不开跨仓库 PR**（不向 `zhuzhaoyun/Molio` 提），**任何 PR 都不合并**，直到所有功能做完再统一合并。
- 因此 `pr-check.yml`（只在 `branches: [main]` 触发）在这条链上不会运行。**不要为了触发它改 base、也不要单开跨仓 PR**——构建门禁改在本地执行（见下），等合并阶段再补 GitHub CI 证据。
- 第四节 P0 与第五节 P1 的清单与本节无关，仍按原样推进；P1 每项单独开 PR，不要塞回 #3 扰动已验证的 diff。
- `ocr-review.yml` 在 fork 未配 `OCR_LLM_*` secret 时 job 仍显示 pass（评论内容是 `no valid LLM endpoint`）。这是绿色空转，不要当作 AI 已审；push 前的 OCR 自检仍按根 `AGENTS.md` 用 `ocr delegate preview/rule` 本地执行。
- **GitHub Actions 已关闭**（2026-11-14，用户要求）：fork 上的 Actions 本次曾为让 CI 跑起来而打开，现已关回 `enabled=false`；PR #3 上既有的 `analyze` / `code-review` 结论保留为历史记录，不再有新检查。需要真实 CI 时临时打开即可。
- **代码评审人暂不处理**（2026-11-14，用户决定）：fork 内只有 `manoloss612` 一个 collaborator，`reviewDecision` 恒空。不开跨仓 PR、不加协作者，该问题先忽略；「至少 1 个 approve」留到合并阶段再解决。

### 本地构建门禁（替代 GitHub PR Check）

```bash
cd /home/ss/.codex/worktrees/f1fa/molio

pnpm build # 构建产物门禁（contracts / daemon / web）
pnpm typecheck
pnpm --filter @molio/daemon test
pnpm --filter @molio/web test
git diff --check "124c205"..HEAD
```

注意工具链：`better-sqlite3` 的原生绑定编译在 Node 26.7.0（ABI 147）上，用低版本 node 跑 daemon 测试会直接 `ERR_DLOPEN_FAILED`。本机可用 `/home/ss/.hermes/tools/node-26.7.0-linux-x64/bin/node`。
