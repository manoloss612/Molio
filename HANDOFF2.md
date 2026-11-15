# Molio 第三阶段开发交接

更新日期：2026-11-11（Asia/Shanghai）。本文件供同一台电脑上的新 session 接续。开始前请重新核对实际 Git、PR 和工作区状态；本文件中的状态和测试数字是交接时的快照。

## 1. 用户目标与当前请求

Molio 是本地优先的知识库和 AI 工作应用。用户希望 **Wiki 和知识图谱可供公众访问，其余管理功能仅管理员可见、可操作**。

用户已经选择第三阶段的方向为“公开内容与发布”，目前确定的公开内容是 **Wiki 和图谱**。用户现在希望新 session 根据本交接开启第三阶段的构建。此前已形成设计与实施计划草案，但其中多项具体产品和技术选择是助手建议，尚未被用户逐项确认；不能将草案中的假设描述为用户已决定。

最关键的未决选择是：**按篇选择公开，还是整个知识库统一公开？** 上一轮已向用户提出该问题，写本文件时尚未收到选择。草案按“默认私有、逐篇选择、手动发布快照”拟定。快照更新时机、随页面发布图片、首期单站点/单 vault 等同样是建议，不是已确认需求。若新 session 仍缺少答案，应先就会改变数据模型和交互的选择做简明确认，同时推进不依赖答案的代码阅读、风险核对等工作；根据用户回答调整草案并推进实施，不要机械重复已获授权的问题。

用户偏好从第一性原理出发，重视真实的访问边界、完整行为闭环、实际测试结果和明确的验收限制。不要以隐藏按钮代替服务端权限，也不要把备份 PR 当成已合并、已上线或 GitHub CI 已通过。

## 2. 先读什么

1. 本项目根目录的 `AGENTS.md`，以及本次影响的目录里**实际存在**的说明文件。用户此前也在对话中提供过根 `AGENTS.md` 内容；项目要求错误驱动测试、UI 与 E2E 同步、核心文件修改后完整 Web E2E、PR 流程以及 push 前 OCR 自检。
2. 第三阶段设计草案：`/home/ss/.codex/worktrees/public-wiki-graph-plan/molio/docs/2026-11-11-public-wiki-graph-design.md`。
3. 第三阶段实施计划草案：`/home/ss/.codex/worktrees/public-wiki-graph-plan/molio/docs/2026-11-11-public-wiki-graph-plan.md`。
4. 第二期设计：`/home/ss/.codex/worktrees/phase2-admin-web/molio/docs/2026-11-04-phase2-admin-web-access-design.md`；第二期回归跟进：`/home/ss/.codex/worktrees/phase2-admin-web/molio/docs/2026-11-06-phase2-admin-web-access-acceptance-followup.md`。
5. 原始 `HANDOFF.md` 可补充一期背景；其中“第二期尚未开始”等信息是 2026-11-04 的历史状态，以本文和上述二期跟进记录为准。

**两份第三阶段草案目前仅为独立 worktree 中的未跟踪文件，尚未提交，也没有备份到 GitHub。** 新 session 必须保留并读取它们，不要在清理 worktree 时丢失。用户如需备份，再按项目流程处理；不要擅自覆盖原始工作目录中的同名文件。

## 3. 工作区与 Git 状态（交接时）

| 位置 | 分支与状态 | 作用 |
|---|---|---|
| `/home/ss/Projects/molio` | `codex/phase1-admin-access-backup`，HEAD `85e32b229fb7ad66e5e90a363d8dbc5f6553bd1b` | 原始工作区；有用户未跟踪文件 |
| `/home/ss/.codex/worktrees/phase2-admin-web/molio` | `feat/admin-web-access`，HEAD `124c205e81415da12468b914b62512e7c883f1fd` | 第二期已实现并备份的代码；交接时工作区干净，HEAD 等于 `backup/feat/admin-web-access` |
| `/home/ss/.codex/worktrees/public-wiki-graph-plan/molio` | `docs/public-wiki-graph-plan`，HEAD 同上 | 第三期规划 worktree；两份设计/计划草案未跟踪 |

原始工作区中已有以下未跟踪文件，属于需要保留的用户/历史工作：

- `HANDOFF.md`
- `docs/2026-11-04-phase2-admin-web-access-acceptance.md`
- `docs/2026-11-04-phase2-admin-web-access-design.md`
- `docs/2026-11-04-phase2-admin-web-access-plan.md`
- 本次新建的 `HANDOFF2.md` 也尚未提交。

不要运行 `git clean`、硬重置、强推或覆盖这些文件。第三阶段应基于第二期代码在隔离功能分支开发；先确认工作区/分支和未跟踪草案，再决定如何将草案带入该分支。不要假定原始工作区已包含第二期代码。

Remote：`origin` 是上游 `https://github.com/zhuzhaoyun/Molio.git`；`backup` 是用户 fork `https://github.com/manoloss612/Molio.git`。按项目规则不得直接 push main；推送前运行 OCR delegate preview/rule 并审查待推送增量。

## 4. GitHub 备份与整合依赖（交接时查询）

- [一期 Draft PR #1](https://github.com/manoloss612/Molio/pull/1)：`codex/phase1-admin-access-backup` → fork 的 `main`，Open / Draft；GitHub `mergeStateStatus=DIRTY`，有冲突；`statusCheckRollup=[]`，不能说 CI 通过。
- [二期 Draft PR #2](https://github.com/manoloss612/Molio/pull/2)：`feat/admin-web-access` → `codex/phase1-admin-access-backup`，Open / Draft；HEAD 为 `124c205e81415da12468b914b62512e7c883f1fd`，GitHub `mergeStateStatus=CLEAN`；`statusCheckRollup=[]`。
- 2026-11-11 的四个二期跟进提交已推送到用户 fork：`bc957b9`（悬浮聊天误触）、`e1d9dd0`（daemon raw 文件流）、`25dcf93`（终态重放测试同步）、`124c205`（验收记录）。push 前以 OCR 1.13.7 的 `delegate preview --from @{upstream} --to HEAD` 和 `delegate rule` 导出规则，宿主对增量进行自审。
- 两个 PR 是有依赖关系的备份草稿；整合到 fork main 或上游前需重新核对目标分支、冲突、review 和 CI，按依赖顺序处理。用户本次让新 session 开始第三阶段构建，并不自动授权合并 PR、强推或部署到公网。

## 5. 已完成的一、二期能力

- 一期：server 模式的 daemon 管理 API 默认鉴权；独立管理员登录/会话/退出、Secure/HttpOnly Cookie、Origin/CSRF、会话到期及受会话约束的管理 SSE。local 模式保持本机使用。
- 二期：管理员 Web 登录和退出、会话恢复/失效、管理请求和事件流的认证适配、local 兼容；未确认身份前不挂载私人业务 App。
- 跟进修复：悬浮聊天面板关闭后的点击误触；知识库 raw 文件使用 Node → WHATWG stream 适配以处理关闭竞态；终态重放 E2E 显式等待首段文本，去除测试前置条件的竞态。
- **当前尚无公开 Wiki/图谱 API、独立匿名页面或发布/撤回模型。** 二期不包含生产反向代理、真实证书、Windows/macOS 真机或 Electron 打包应用的完整验收。

关键源码起点：

- `apps/daemon/src/core/access/guard.ts`：server 默认管理 API 保护，当前只精确放行健康和认证入口。
- `apps/daemon/src/server.ts`：守卫在业务路由之前；知识库和图谱分别挂载于 `/api/knowledge`、`/api/graph`。
- `apps/daemon/src/routes/knowledge.ts`、`apps/daemon/src/core/knowledge.ts`：vault 读写与 raw 文件。
- `apps/daemon/src/routes/graph.ts`：现有图谱扫描整个 vault；图谱类型包含源路径、死链等，不能直接作为匿名公开数据。
- `apps/web/src/access/AccessBoundary.tsx`、`apps/web/src/main.tsx`：管理员工作区入口边界；公开页面需有明确的只读入口和数据边界。
- `apps/web/src/components/kb/MdRenderer.tsx`、`apps/web/src/components/graph/`：可评估复用纯显示能力；必须验证不可信 Markdown、链接、图片和图谱数据的公开安全性。
- `apps/daemon/src/routes/publish.ts` 是现有其他发布链路，不能直接当成公开 Wiki 权限模型。

## 6. 上一次实际验证与限制

以下是**2026-11-10 至 2026-11-11 的二期跟进历史结果**，不是第三期代码的测试结果：

| 验证 | 结果 |
|---|---|
| Web 完整 E2E | 650 通过、1 跳过、0 失败，33.3 分钟，退出码 0 |
| daemon 全量单测 | 2,037 通过、12 跳过、0 失败 |
| daemon `knowledge.test.ts` | 32 通过、0 失败 |
| 悬浮聊天拖拽及关闭回归 | 两个场景各重复 20 次，共 40/40 通过 |
| 管理员终态重放定向 | 20/20 通过 |
| workspace `pnpm typecheck`、`git diff --check` | 通过 |
| 最终完整 E2E 日志中 `FATAL` / `ERR_INVALID_STATE` | 0 次 |

完整 E2E 日志和退出码在第二期 worktree 的 `.artifacts/phase2-admin-access/full-20261110-final/run.log` 与同目录 `exit-code`；`.artifacts/` 被 Git 忽略，未备份到 GitHub。详细证据和之前失败情况见二期跟进记录。跳过的用例和未验证的平台不能被表述为已通过。

第三期改变访问边界，须使用隔离 server/临时 vault 和真实浏览器验证匿名、管理员、发布、撤回及会话生命周期；按 `AGENTS.md` 对相关错误添加回归测试，触及核心文件时运行要求的完整 Web E2E。测试执行前确认端口和现有用户服务，不随意终止他人进程。使用真实生产反向代理/证书或目标平台前，只能报告本地 HTTPS 夹具的范围。

## 7. 第三期草案的核心思路（建议，非用户已确认的决策）

- 默认私有；建议管理员逐篇选择、预览后发布独立快照；源文件改变不会自动更新公开版本。
- 匿名页面和 API 使用只读公开数据，图谱只含公开页面及两端都公开的连线；不应泄露未发布页面的路径、标题、死链或资源。
- 发布/撤回/站点开关受管理员会话和 CSRF 保护；快照、图谱和资源保持版本一致；发布失败、并发和重启不得出现半成品。
- 对公开 Markdown、图片、内部链接及跨 vault 路径做明确白名单和安全处理；管理员需预览要公开的正文及资源。系统不能自动识别正文或图片里的所有私人信息。
- 建议验收覆盖逐篇发布与更新、匿名只读、非公开数据无法获取、撤回和关闭、页面/图谱导航、资源安全、异常输入、故障恢复和完整回归。用户选择整库公开或其他语义时，须先调整模型、界面和验收。

第三期草案建议的路线依次为：**明确产品选择与基线 → 快照和公开图谱 → 匿名只读及管理员 API → 管理与访客 UI → 隔离 HTTPS 验收和交付**。文件路径、接口签名、容量限制、图片策略、公开入口 URL 目前均是待审建议，不要当作不可变规范。

## 8. 新 session 的接续顺序

1. 读取本文件、根 `AGENTS.md`、第三期两份草案和二期跟进记录；检查 `git status`、`git worktree list`、分支与 PR 的实时状态，保留所有未跟踪文件。
2. 结合新 session 中用户的最新回复，确认逐篇或整库公开，以及其他会显著改变设计的选择；可以先推进不依赖答案的源码研究和方案核对。用户已要求开启第三阶段构建，不要误解为只需重复汇报历史。
3. 根据已确认的目标定稿设计和任务边界，以第二期代码为基线在隔离功能分支实施；保持默认管理保护和 local/desktop 兼容。
4. 按项目测试规则进行有意义的回归、独立 HTTPS 浏览器验收及必要的完整 E2E；报告实际通过/失败/跳过和未覆盖范围。
5. 依用户后续指示完成 PR、备份、review 或部署；执行 push 前进行 OCR 自检，不能直接 push main。

本次交接只新建 `HANDOFF2.md`，未修改产品代码、未提交、未推送，也未启动第三期测试。
