# Molio 开发交接

更新日期：2026-11-04（Asia/Shanghai）。本文件用于新对话接续；先核对实际 Git 状态，再开展后续工作。

## 1. 用户目标与当前停止位置

用户希望将 **Wiki 和知识图谱做成可公开访问的部分，其余功能仅管理员可见、可操作**。

当前已完成第一期：daemon 访问控制与独立管理员认证 API，实现及自动化验收结果已交付。随后用户授权推送到自己的 GitHub 做备份，已完成。**用户尚未明确批准第一期审核通过，第二期尚未开始。** 当前请求仅为编写本交接文件，不代表授权实施第二期、合并或部署。

用户偏好：从第一性原理出发，以真实访问边界和完整行为闭环作为完成依据；保留已有修改；遇到安装或局部测试通过不能提前停止；明确报告真实测试结果和限制。此前用户特别追问完整 Web 回归是否实际运行，后续交付必须给出日志和实际结果，不能以单元测试替代浏览器回归。

## 2. 工作区、Git 与备份

| 项目 | 当前值 |
| --- | --- |
| 本地目录 | `/home/ss/Projects/molio` |
| 当前分支 | `codex/phase1-admin-access-backup` |
| 第一期开工基线 | `b918b3924a81f9ecf7215ebba94b50a95dc98038` |
| 第一期备份提交 | `85e32b229fb7ad66e5e90a363d8dbc5f6553bd1b` |
| 提交说明 | `feat(daemon): add phase one administrator access control` |
| 上游 remote | `origin` → `https://github.com/zhuzhaoyun/Molio.git` |
| 用户备份 remote | `backup` → `https://github.com/manoloss612/Molio.git` |
| tracking branch | `backup/codex/phase1-admin-access-backup` |
| 用户备份 PR | <https://github.com/manoloss612/Molio/pull/1> |

2026-11-04 已核对远程备份分支 SHA 与本地备份提交一致。第一期共提交 45 个文件，1858 行新增、101 行删除。写入本文件前工作区干净；**本 HANDOFF.md 为备份提交之后新建的本地文件，本次未提交、未推送。** 新对话不要认为它已存在于 GitHub 备份中。

### PR 的真实状态

- PR #1 位于用户自己的 fork，状态 OPEN、Draft，没有合并或部署，也没有向上游创建 PR。
- 最新查询：`mergeable=CONFLICTING`，`statusCheckRollup=[]`。不能声称 GitHub CI 已通过或 PR 可直接合并。
- fork 的 `main` 在创建备份时比本地开工基线领先 15 个提交。为保留已验证的第一期快照，备份没有 rebase/merge 这些新提交。
- 若用户以后要求合并，需先查看冲突及上游新提交，再决定如何整合并验证整合后的代码。不要为消除冲突覆盖 main、丢弃修改或擅自 force push。
- 旧 `docs/public-wiki-admin-plan` 分支仍在本地，停留于开工基线；已实现的第一期在当前备份分支。

## 3. 先读这些文件

1. 根 `AGENTS.md`，以及受影响包实际存在的说明文件。项目为 pnpm monorepo：contracts 共享类型、daemon Hono/SQLite/SSE、web Vite/React、desktop Electron、cloud 独立云账号认证。
2. `docs/2026-10-28-phase1-admin-access-execution-plan.md`：第一期执行依据，最终清单已勾选。
3. `docs/phase1-admin-access-review.md`：配置、接口、哈希工具、历史验证结果、证据索引及限制。
4. `.artifacts/phase1-access/progress.md`：本机完整实施过程、失败定位和各轮回归记录。

注意：第 2、3 项中的“未推送”“本地 diff”等描述记录的是 **2026-10-30 交付时的状态**；2026-11-04 已按用户新授权完成备份，以本文件第 2 节及实时 Git 状态为准。历史测试结果也不能表述为今天重新执行的结果。

## 4. 第一期实现内容及关键约束

### 启动与密码

- `apps/daemon/src/core/access/config.ts`：`local/server` 判别联合配置；默认 local，只允许 `127.0.0.1` 或 `::1`，`localhost` 规范化为 IPv4 回环。
- server 必须配置可信 HTTPS Origin、管理员用户名和固定格式 scrypt 哈希；配置无效拒绝启动，不回退免登录模式。校验位于 `server.ts` 创建服务、打开数据库之前，`index.ts` 显式传监听 hostname。
- `password.ts`：Node crypto scrypt，固定 N=32768/r=8/p=1/maxmem=64 MiB，随机盐和恒定时间比较。
- `scripts/create-admin-password.mjs`：TTY 隐藏输入、确认密码、生成哈希，复用构建后的 daemon 模块；不能通过命令行传入真实密码。

### 会话与统一门禁

- `sessions.ts`、`migration.ts`、`core/db.ts`：SQLite 只存随机会话令牌的 SHA-256 摘要；12 小时绝对到期，不续期。重启保留原到期时间；用户名/密码哈希变化后重启撤销历史会话。
- `routes/access.ts`：独立 `/api/access/login`、`session`、`logout`；不复用原 `/api/auth/*` 云账号，也不复用云市场管理员身份。
- Cookie：`__Host-molio_admin`，Secure、HttpOnly、SameSite=Lax、Path=/，Max-Age 对应剩余绝对寿命。
- 登录体按实际读取字节限制为 4 KiB；最多两个并发 scrypt 验证，所有用户名合计 60 秒内最多五次失败；错误凭据统一响应。限速为单进程内存状态，重启会重置。
- `guard.ts` 在业务路由/CORS 前挂载；server 默认保护所有管理 `/api/*`，只精确放行认证流程及最小健康检查。第一期没有 `/api/public/*` 放行前缀。
- 无有效会话返回 401；已登录的写请求须同时有可信 Origin 和 `X-Molio-CSRF`，不符合返回 403；认证及管理响应 no-store。

### SSE 与兼容

- `stream-lifetime.ts` 统一包装管理 SSE；退出、撤销、到期、断线清理订阅和计时器，两个会话互不误伤，不因一个观察流关闭而误停共享任务。
- 已覆盖任务、知识库、安装、预加载四类实际流；`routes/preload.ts` 补充取消清理，`routes/agents.ts` 增加可控测试依赖。
- `apps/desktop/src/daemon-env.js`、`main.js`：打包桌面的 daemon 强制 local+回环，不继承 shell 的 server 配置。
- `packages/contracts/src/access.ts`：对外认证响应类型。

### 必需回归中额外修复的三个既有问题

1. `apps/daemon/src/core/knowledge.ts`：Linux 嵌套目录大小写回退失败；逐段解析且保留路径边界与歧义检查，有新增回归测试。
2. `apps/web/src/components/kb/KnowledgeBasePage.tsx`：初始化时旧 URL 状态覆盖新的图谱导航；同步 vault 时读取当前 URL 并保留其他参数。
3. `apps/web/src/components/kb/MdRenderer.tsx`：MathJax 迟到触发相同 HTML 重绘，清空用户选区；相同 HTML/source 保留原状态对象，有可控延迟的回归用例。

还修复了若干 E2E 夹具：显式 mock runtime、等待登录恢复、等待动画清理、用 terminalGate 保持模拟运行直到测试完成导航。保留了业务断言，没有启用重试掩盖失败。

## 5. 已执行的验证与证据

以下为 **2026-10-30 最终代码上的历史验收结果**。2026-11-04 备份时未修改实现、未重跑测试；只完成 OCR 规则自审、diff 检查及远程 SHA 核对。

| 验证 | 实际结果 | 本机日志：`.artifacts/phase1-access/` 下 |
| --- | --- | --- |
| contracts build:fresh | 退出码 0 | 当时构建输出已检查 |
| daemon typecheck | 退出码 0 | `daemon-typecheck-final.log` |
| daemon 全量测试 | 2047 项：2035 通过、12 跳过、0 失败，退出码 0 | `daemon-test-migration-final.log` |
| daemon build | 退出码 0 | `daemon-build-final.log` |
| Web 单元测试 | 594 通过、0 失败，退出码 0 | `web-unit-last.log` |
| Web typecheck | 退出码 0 | `web-typecheck-last.log` |
| desktop 测试 | 370 项：363 通过、7 跳过、0 失败，退出码 0 | `desktop-test-skipping-binary.log` |
| 真实 server API smoke | 通过，退出码 0；也包含在 daemon 全量测试中 | `server-smoke-serial.log` |
| 完整 Web E2E | 618 项：612 通过、6 跳过、0 失败，退出码 0，27.2 分钟 | `web-e2e-acceptance.log` |

最终完整 Web 命令：

```bash
MOLIO_ACCESS_MODE=local MOLIO_E2E_DAEMON_PORT=3100 MOLIO_E2E_WEB_PORT=5173 MOLIO_E2E_CLOUD_PORT=3201 MOLIO_E2E_MOCK_OSS_PORT=3199 pnpm --filter @molio/web test:e2e
```

这是一次完整连续运行的结果，不是把零散复跑拼接起来。包含 `apps/web/e2e/admin-access-server.spec.ts` 的独立 server daemon、临时 HTTPS 代理和 Chromium 验证，实际检查 Secure/HttpOnly Cookie、401、CSRF、登录退出。其余既有流程在 local 模式下回归。

### 跳过和未验证范围

- Web：5 项因未安装 Claude Code；1 项需专用低文件大小上限环境。
- daemon：10 项 Windows 专用、2 项需 PyMuPDF。
- desktop：7 项需未生成的打包产物/平台辅助程序。执行使用 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`；未验证实际 Electron 二进制或打包应用启动。
- 未验证 Windows/macOS 真机、生产反向代理部署。
- 独立只读安全审查未发现已确认的 Critical/Important 实现漏洞，提出的路由方法矩阵和流清理证据缺口已补齐；该结论不是未来改动的保证。

原始日志、截图和临时产物在被 Git 忽略的 `.artifacts/` 等目录中，**没有推送到 GitHub**。同机新对话可读取；新机器 checkout 只有已提交的代码、测试及审核文档。

## 6. 当前产品限制

- 目前是后端管理访问边界，**没有管理员登录页面**。
- 现有 Web 业务请求尚未完成服务器管理员会话和 CSRF 的全面适配，因此 server 模式还不是可直接交给用户使用的完整网站。
- 没有公开 Wiki/图谱页面、公开 API、发布/撤回模型、公开附件或搜索边界。
- server 设计范围是单管理员、单 daemon 实例，外部 HTTPS 由反向代理提供。
- 未部署、未合并；fork 草稿 PR 有冲突，须与“第一期历史测试通过”分别看待。

## 7. 下一步建议与未决事项

上一个对话只提出了以下建议，**尚未得到用户选定设计或实施授权**：

1. 审核第一期 PR 和文档，确认第一期是否接受；如果要合并，单独处理与 fork main 的冲突和整合验证。
2. 第二期先补管理员 Web 登录、退出、会话恢复/失效和管理请求 CSRF 适配。
3. 建立明确的公开内容边界与发布/撤回能力。
4. 实现匿名只读 Wiki/图谱；搜索、附件、内部链接、图谱节点和边都只能包含准许公开的数据。
5. 浏览器验收匿名/管理员两种身份、发布与撤回，再交用户审核。

**助手建议但用户未确认的设计：**默认私有、逐篇选择发布、采用发布快照；修改草稿后重新发布才对访客生效。不要把它写成用户已同意的需求。

上轮最后向用户提出、尚未回答的问题：**公开范围按逐篇文档选择，还是按整个知识库统一公开？** 该选择影响数据模型、发布操作、图谱过滤和验收，应先结合用户新指令确认。

仓库目前没有本目标可直接执行的完整第二期计划；其他文档里的“第二期”可能属于图谱增强或云账号功能，不要混用。建议在普通 `docs/` 下编写本目标的第二期设计与执行计划，明确范围和验收；用户批准后再实施。`docs/superpowers/` 被忽略，不作为唯一交付入口。

## 8. 接续时的操作约束与经验

- 先读实际 `AGENTS.md`，保留用户修改。不得 git clean -fdx、重置工作区、覆盖用户数据、擅自变基/强推或终止其他项目的服务。
- GitHub 用户是 `manoloss612`；对 `zhuzhaoyun/Molio` 只有 READ 权限。推送备份用 `backup`，不要误向 origin 推送。所有代码变更遵循 PR 流程，不能直接 push main。
- 推送前按仓库要求做 OCR 自检。上次使用 `npm exec --yes --package @alibaba-group/open-code-review -- ocr delegate preview/rule`，版本 v1.13.5，导出规则后由宿主审 diff，无需配置或发送至外部 LLM。记录在 `.artifacts/phase1-access/backup-ocr-*.json`、`backup-ocr-rules.txt`、`backup-ocr-summary.md`。
- 本仓库已设置本地 Git 身份为 `manoloss612` 及 GitHub noreply 邮箱。不要读取或输出任何认证令牌。
- 依赖已经安装，先检查缺什么；确有缺失才过滤安装。避免并发安装，按需跳过 Electron 二进制下载，不为此升级工具链或改锁文件。
- 完整 Web 用例部分硬编码 localhost:5173；曾仅改环境端口导致大量伪失败。完整回归优先先确认 3100/5173/3201/3199 空闲，并使用隔离测试目录，不复用用户服务。
- 不要因测试长时间无输出而无依据中断；先核对进程及日志。测试失败要定位，不能直接归为“环境压力”。增加失败复现用例并说明修复。
- 当前任务只写交接文档，不需要重跑长回归。后续根据用户要求、实际改动及仓库门禁决定验证；历史结果不能冒充新改动后的结果。

## 9. 可复制到新对话的开场指令

> 请先阅读 `/home/ss/Projects/molio/HANDOFF.md`、根 AGENTS.md 和第一期审核指南，核对当前分支、备份 PR 与本地改动，再报告第一期状态和第二期仍需确认的选择。保留现有成果，不把备份视为审核通过，不擅自合并、推送、部署或进入第二期实现。根据我接下来的要求继续。
