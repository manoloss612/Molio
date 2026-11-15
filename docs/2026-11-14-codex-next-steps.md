# 下一步任务清单（给 Codex 的执行指令）

- 日期：2026-11-14
- 工作区：`/home/ss/.codex/worktrees/f1fa/molio`，分支 `feat/public-wiki-graph`，HEAD `66ff5f2`
- 上游文档：`docs/2026-11-12-phase3-public-wiki-graph-codex-followup.md`（第七节合并策略）、`docs/2026-11-12-phase3-public-wiki-graph-acceptance.md`
- 本文用途：把「三期已交付、暂时不合并」之后要做的事整理成可执行清单。**开始前先核对实际 Git、PR 与工作区状态，本文数字是 2026-11-14 的快照。**

## 一、当前状态（已核对，非自述）

| 项 | 值 |
| --- | --- |
| PR #3 `feat/public-wiki-graph` → `feat/admin-web-access` | OPEN、Ready for review、MERGEABLE、HEAD `66ff5f2` |
| PR #1 / #2 | Draft，不动 |
| fork Actions | **已关闭**（`enabled=false`，用户要求） |
| 11-12 验收的 4 项 P0 | 全部关闭（有代码 + 单测证据） |
| 11-12 验收的 5 项 P1 | **已关 2 项**（P1-1 `renderPublicMarkdown` 单测、P1-2 预览绑定会话 digest），**剩 3 项** |
| 全量 Web E2E | 653 项：651 通过 /1 跳过 /1 偶发失败（37.3m，本机 node 26.7.0） |
| 全量 E2E 唯一失败 | `apps/web/e2e/split-view.spec.ts:128`（P1、kb area；单文件复跑 8/8、`--repeat-each=5` 5/5 通过） |

## 二、铁律（做任何事之前先读）

1. **不合并、不部署、不改 PR base。**用户已决定：所有功能做完再统一合并。不要因为 `pr-check.yml` 只认 `branches: [main]` 就去改 base，也不要为了跑 CI 开跨仓 PR。
2. **不开跨仓 PR。** `origin` = `zhuzhaoyun/Molio`，只读（无 push 权限）；备份只推 `backup`（`manoloss612/Molio`）。
3. **不往 PR #3 追加 commit。** #3 的 diff 已验证，任何新工作一条新分支、一个新 PR，base 取 `feat/public-wiki-graph`。
4. **push 前必须 OCR 自检**（根 `AGENTS.md`）：`ocr delegate preview --from=origin/main --to=HEAD`（增量 push 用 `@{upstream}`）→ `ocr delegate rule <文件…>` →逐条比对 diff，只修属实问题。注意 CI 侧 `ocr-review.yml` 是绿色空转（fork 无 `OCR_LLM_*`），不能替代本地自检。
5. **不覆盖用户工作区。** `/home/ss/Projects/molio` 下有用户未跟踪文件（`HANDOFF.md`、`HANDOFF2.md`、多份 `docs/2026-11-*.md`）。禁止 `git clean`、禁止批量 `git add .`。
6. **不读不写凭据。**认证 token、`demo-session.json`、`MOLIO_ADMIN_PASSWORD_HASH`、真实密码一律不碰；新测试只用合成 fixture，禁止引入真实 vault 内容。
7. **不删不跳既有 E2E 让全量变绿。**唯一允许的既有跳过是 `kb-large-file-too-large.spec.ts:35:3`。
8. **测试数字必须真实。**报 pass/skip/fail 三项；偶发失败要说明复跑证据；禁止拿历史数字冒充本轮结果。

## 三、任务

### T1 修 `getInternalPages` 的 N+1（P1-3）

- **位置**：`apps/daemon/src/core/publication/store.ts:26-42`。
- **现状**：先查全部页面，再对每页单独 `db.prepare(...).all(revision, page.page_id)` 查资产。按每修订 1,000 页上限，`/status` 会放大成 1,000+ 次查询。
- **要求**：改成一次 join 取全部 `(page_id, asset…)` 行，内存里按 `page_id` 分组；保持返回结构 `InternalPageRow[]` 与既有字段顺序不变。
- **验收**：
 - `getInternalPages` 的 SQL 语句数不随页数增长（用包装 `db.prepare` 计数的测试断言：100 页与 1,000 页语句数相同，且 ≤2）。
 - `publication.test.ts` 全绿；`/status` 返回内容与改动前逐字段一致。
- **禁止**：顺手改 projection、改表结构、改 revision 语义。

### T2 定 `setSiteEnabled` 与 revision 的契约（P1-4）

- **位置**：`apps/daemon/src/core/publication/store.ts:216-220`。现状只 `UPDATE publication_state SET enabled = ?`，revision 不变。
- **这是个决策点，二选一，写清楚再动手**：
 - A. 让开关也推进 revision（同一 revision 即同一公开状态，语义最干净；但会让所有已分享的 `?revision=N` 链接在开关后失效）。
 - B. 保持不推进，在设计文档里明确写下「revision 只标识内容快照，`enabled` 是与之正交的开关」，并在 `/site` 响应里让客户端能明确判断。
- **默认建议 B**（对访客链接更友好），但必须在 `docs/2026-11-11-public-wiki-graph-design.md` 里补一段契约说明，不能只在代码里默默如此。
- **验收**：设计文档有对应段落；单测覆盖「开关前后 revision 的取值」与「关闭后公开读一律 404」；E2E 若受影响同 commit 更新。

### T3 对齐计划与实现的文件结构（P1-5）

- **现状**：计划 Task3 写的是 `PublicWikiPage.tsx` / `PublicGraphPage.tsx`，实际只有一个 `apps/web/src/components/public/PublicSite.tsx`。
- **要求**：**改文档对齐实现**（行为等价，不要为了对齐文档去拆组件）。
- **验收**：`docs/2026-11-11-public-wiki-graph-plan.md` 与实际文件一致；文档里明确图谱为内联 SVG。

### T4 定位 `split-view.spec.ts:128` 偶发

- **现象**：点击 `beta.md` 后 `.kb-wtab.is-active` 在 5s 内仍停在「图谱」。
- **已知**：单文件复跑 8/8、`--repeat-each=5` 5/5 通过；kb area 的三期改动只有 `KbFilePanel.tsx` 的一个新按钮 prop 与 `KnowledgeBasePage.tsx` 的 publication overlay。
- **要求**：先定位，再决定修不修。用 `--repeat-each=20` 压测拿稳定失败率；失败时抓 `.kb-wtab` 数量、`is-active` 分布、附件、控制台错误。若根因在测试自身的等待策略（固定 5s、先点树再等 tab），优先改测试的等待方式而不是改产品代码。
- **验收**：给出根因结论 + 复现率；若修复，提供修复后 `--repeat-each=20` 全绿证据。
- **注意**：这项与三期功能无关，**单独分支单独 PR**，不要混进 T1/T2。

### T5 补一条可复现的本地门禁

- **背景**：GitHub Actions 已关，`pr-check.yml` 在这条依赖链上不触发，现在没有任何脚本化门禁。
- **要求**：在已有 `scripts/` 目录加 `scripts/local-gate.sh`，按序执行并在首个失败处非零退出、打印失败步骤名：
1. Node 版本预检（要求 26.7.0；不匹配直接报错退出，避免 ABI 假失败）
2. `pnpm build`
3. `pnpm typecheck`
4. `pnpm --filter @molio/daemon test`
5. `pnpm --filter @molio/web test`
6. `git diff --check "$BASE"..HEAD`
- **验收**：故意改坏一处 →非零退出且指出步骤；还原 →退出码 0。脚本里不要写死绝对路径以外的机器状态。
- **注**：全量 Playwright E2E（30 分钟以上）不进门禁脚本，单独手工跑。

### T6 两项需要用户拍板，不要自行决定

1. `[[molio-image-unavailable]]` 占位符在渲染侧没有对应改写（自产字面量，非数据泄露）。改不改、怎么改属产品/契约决策。
2. `/home/ss/Projects/molio` 下这些未跟踪文档是否入库：`HANDOFF.md`、`HANDOFF2.md`、`docs/2026-11-04-phase2-*`、`docs/2026-11-12-phase3-*`。**未获明确指示前一律不提交。**

## 四、分支与 PR 规范

```bash
cd /home/ss/.codex/worktrees/f1fa/molio
git fetch backup
git checkout -b fix/publication-status-n-plus-one backup/feat/public-wiki-graph
# 改完：本地门禁全绿 → OCR 自检 → git push -u backup <branch>
gh pr create --repo manoloss612/Molio \
 --base feat/public-wiki-graph --head <branch> \
 --title "fix(daemon): …" --body "…"
```

- 分支前缀：`fix/`、`refactor/`、`chore/`、`docs/`；commit 用 Conventional Commits，scope 取 `daemon` / `web` / `kb` / `ci`。
- commit 尾部：`Co-Authored-By: Claude Code <noreply@anthropic.com>`；PR 描述尾部：`🤖 Generated with [Claude Code](https://claude.com/claude-code)`。
- PR 描述必须含：改动范围、验证命令与**真实**结果（pass/skip/fail）、未验证项。
- 功能没做完就保持 Draft，不请求合并。

## 五、环境注意

- `better-sqlite3` 原生绑定编译在 **Node 26.7.0（ABI 147）**；用低版本 node 跑 daemon 测试会 `ERR_DLOPEN_FAILED`。本机路径：`/home/ss/.hermes/tools/node-26.7.0-linux-x64/bin/node`。
- 全量 Web E2E：`pnpm --filter @molio/web exec playwright test`，1 worker，约 33–37 分钟。
- 定向公开页 E2E：`pnpm --filter @molio/web exec playwright test -c playwright.admin.config.ts e2e/publication-ui.spec.ts e2e/publication-server.spec.ts`（自带独立 HTTPS 栈与临时 SQLite）。

## 六、什么时候才算「所有功能做完」

- 这一条**由用户判断**，Codex 不得自行宣布。当前已知的收尾条件是：T1–T4 全部关闭 + 用户确认没有后续阶段。
- 进入合并阶段时才做的事（现在都不做）：
1. 临时打开 fork Actions，跑一次真实 CI（届时需要一个 base 为 `main` 的验证 PR，或直接对上游仓库走流程）。
2. 按 `#3 → #2 → #1` 顺序逐级合并（或按用户选择 squash），每级合并前确认上一级的 commit 已在 base 上。
3. 合并前补一次全量 Web E2E 与全仓 typecheck，作为合并证据。

## 七、报告格式

交付时给：分支名 / PR 链接 / 改了哪些文件 / 每条验证命令 + 真实数字（含 skip）/ 未验证项 / OCR 自检命中与处理。**不要只贴「测试通过」。**
