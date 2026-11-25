# 公开 Wiki：当前设计与交付状态

日期：2026-11-25。本文对齐已确认的产品选择、当前代码与交付边界；测试结果以本次最终验收记录为准，不把历史测试数字当作当前通过证据。

## 当前有效方案

目标：匿名访客只能浏览明确发布的 Wiki 正文、允许的图片及由这些页面构成的图谱；原有工作台与管理 API 由独立管理员会话保护。

- 默认私有。一个公开站点绑定一个知识库；候选页面来自 `wiki/` 内 Markdown。
- 管理员逐篇勾选，也可全选。批量发布先生成只读预览，再显式确认提交；更新选中页时保留其他已发布页。
- 访客读取 SQLite 中当前不可变快照。修改或删除源文件不会自动改变公开版本；更新须再次发布，删除公开内容须撤回。
- 支持单篇或批量撤回，以及独立的访客站点开关。内容修订号表示内容版本；站点开关不推进修订号。
- 页面、链接、图谱和图片只由同一快照生成；公开 ID 不暴露源知识库路径，旧修订不可读取。
- 公开路由为 `/public/wiki`、`/public/wiki/:id` 和 `/public/graph`。访客只请求 `/api/public/{site,pages/:id,graph,assets/:id}`。
- 公开图谱复用知识库 Pixi/d3 引擎，支持拖动、缩放按钮、滚轮缩放、适配画布、缩略图和公开文章导航。主导航提供公开 Wiki 入口。
- server 模式使用管理员 Cookie、CSRF 和可信 Origin 保护管理能力；local 模式只监听回环地址，Electron 显式使用 local。

## 文档效力与方案变更

| 文档 | 当前用途 |
| --- | --- |
| `superpowers/specs/2026-10-28-public-wiki-admin-access-design.md` | 最初提案，历史记录；其中编辑即公开等行为已替代 |
| `superpowers/plans/2026-10-28-public-wiki-admin-access.md` | 最初任务分解，历史记录；未勾选项不能直接视为当前欠项 |
| `2026-10-28-phase1-admin-access-execution-plan.md` | 后端模式、管理员会话、集中鉴权和流生命周期的实施依据 |
| `2026-11-04-phase2-admin-web-access-design.md` | 管理员浏览器登录、请求与会话恢复的实施依据 |
| `2026-11-11-public-wiki-graph-design.md` | 逐篇快照发布、投影与内容边界的实施依据 |
| 本文 | 当前范围及交付状态索引；界面新增能力补充三期设计 |

后续阶段与 10 月草案的阶段编号不同：一期是后端权限，二期是管理员 Web，三期是公开快照与图谱。原草案推荐的实时读取方案已由用户确认的快照方案替代；不再要求 watcher 实时同步源文件到公开站点。

## 已实现与证据入口

| 能力 | 实现与测试入口 |
| --- | --- |
| 模式校验、匿名管理 API 拒绝、Cookie/CSRF、到期与撤销 | `apps/daemon/src/core/access/`、`apps/daemon/test/access/`、`apps/daemon/test/routes/access.test.ts` |
| 管理员登录、退出、会话变化与旧请求处理 | `apps/web/src/access/`、`apps/web/e2e/admin-access-*.spec.ts` |
| 快照投影、图片边界、原子读取、发布与撤回 | `apps/daemon/src/core/publication/`、`apps/daemon/test/core/publication.test.ts` |
| 公共正文清理、公开资源重写、修订重试 | `apps/web/src/components/public/publicMarkdown*`、`publicSnapshot*` |
| 全选、批量发布/撤回、匿名导航、图谱缩放 | `apps/web/e2e/publication-ui.spec.ts`、`publication-server.spec.ts` |

历史验收记录保留其日期和当时提交的结论；其中“未推送”“圆圈 SVG”等描述不代表当前状态。三期审查后的事务读取、预览主体绑定、渲染单测、资产查询批处理、图片占位符等修复已通过阶段 PR 纳入基线。

## 本次收尾

- PR #11：`feat/public-wiki-batch-graph` → `feat/admin-web-access`，个人仓库 `manoloss612/Molio`；合并目标为阶段集成分支。
- 本次补充文档对齐、分支审查及完整 Web E2E；本次运行结果见下方验证与审查记录。
- `main`、正式发行和公网部署分别验收，阶段分支合并不等于上线。

## 仍待完成的上线事项

- Docker/compose、`.env.example` 与 `install.sh` 的 server 模式、管理员初始化和内嵌配置同步检查。
- 正式域名、真实反向代理与可信 TLS 证书环境中的公开访问、匿名管理边界、发布/更新/撤回/关闭、登录退出和重启验收。
- Windows/macOS 打包及桌面真机兼容验收。

公开全文搜索、多公开知识库及 slug/站点标题配置、局部图谱、静态导出和一键发布到第三方托管站点属于后续独立范围，不作为当前快照发布版本的完成条件。

## 本次验证与审查记录

2026-11-25，在独立功能工作区对 PR #11 最终产品改动执行：

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过，退出码 0 |
| `pnpm --filter @molio/web test` | 640 通过，0 失败 |
| `pnpm --filter @molio/web build` | 通过；保留既有 CSS 解析及 chunk 大小警告 |
| `MOLIO_ACCESS_MODE=local CI=1 pnpm --filter @molio/web exec playwright test` | 完整 653 项：652 通过、1 既有跳过、0 失败；39.4 分钟，单 worker、无重试 |
| 文档相对链接与 `git diff --check` | 通过 |

独立代码审查发现匿名直达公开图谱时小地图缺少私有页面提供的定位样式。新增 E2E 断言先以实际 `position: static` 失败；公开样式补齐独立定位与 160×110 尺寸，并将主画布的全尺寸样式排除小地图后，完整 E2E 通过。同一用例继续断言访客仅调用 `/api/public/*`。

原始日志位于 `/tmp/molio-pr11-{typecheck,web-unit,build,minimap-red,full-e2e-final}.log`；完整浏览器报告位于功能工作区 `apps/web/playwright-report/`，JSON 结果位于 `apps/web/test-results/results.json`。这些是本地生成件，不进入仓库。构建使用 Node 24；浏览器测试使用与本机 SQLite 原生模块匹配的 Node 26（两者满足项目 Node >=24 要求）。本次未运行平台打包或生产公网部署验证。

独立审查未发现新增匿名访问安全问题。个人仓库仅有本人协作者，本次依照用户明确的审查合并授权和既有阶段集成约定，在本地验证后合入 `feat/admin-web-access`；不将其表述为有独立 GitHub 人工 approve 或 CI 门禁通过。

## 个人仓库 main 集成

用户随后明确授权将功能合入个人仓库 `manoloss612/Molio` 的 `main`。核对时 main 为 `ed95ae2`，已通过 PR #1–#3 纳入一期到三期；阶段分支还停留在较早的上游基线。因此本次从最新 main 创建 `feat/public-wiki-main-closeout`，只迁入 PR #11 的 squash 提交 `cc36db9`，保留 main 中后续市场、测验与 Windows 路径等更新。

当前集成差异为 15 个文件，无冲突；独立审查未发现新增阻塞问题。本轮已对最新 main 集成结果重新执行验证，结果见下方。上节 652 项通过是阶段分支的历史验证，不能替代本轮 main 验证。

合入 main 后的下一步是部署交付：先检查 server 模式与管理员初始化在 Docker、compose、环境模板及安装脚本中的接线，再选择外部可访问的部署环境，以正式域名和 TLS 验收公开阅读、发布/更新/撤回/关闭和匿名管理访问拒绝。main 合并不触发本文所承诺的公网部署或正式发行。

主线首轮回归在悬浮按钮“再次藏边”用例中复现失败：按钮已贴右缘时，原手势仅移动约 4px，小于产品 6px 拖动阈值，被正确识别为点击，打开面板后按钮消失。修复测试为有明确纵向位移的斜向拖动，保留全部藏边、唤回和重载断言；定向连续运行 3 次通过。首轮因已确认失败而主动停止（202 passed，469 did not run，退出码 130），不算完整通过；最终完整运行单独记录。

### main 最终验证（2026-11-25）

| 检查 | 结果 |
| --- | --- |
| 全工作区构建（串行调度以控制内存） | 通过：`pnpm -r --workspace-concurrency=1 build` |
| `pnpm typecheck` | 通过 |
| Web 单元测试 | 698 通过，0 失败 |
| daemon 全量测试 | 2081 项：2069 通过，12 平台/环境跳过，0 失败 |
| 最终完整 Web E2E | 673 项：671 通过，2 跳过，0 失败，0 flaky，38.0 分钟，无重试，退出码 0 |

完整 E2E 跳过项为 `kb-large-file-too-large`（专用低上限环境）及市场管理员入口用例（验证码登录未返回 devCode 时的既有条件跳过）。后一项另行使用干净隔离环境补跑，结果追加于下方。完整结果保持 671/2 的原始口径，不将定向补跑拼成另一轮全量结果。

主线验证日志：`/tmp/molio-main-{contracts,typecheck-final,unit,build,daemon,e2e-final,drag-green,skipped-market}.log`。首次检查使用了切换分支前的 contracts 构建产物，导致市场新字段类型缺失；清理重建 contracts 后，最终类型检查通过。最终完整 E2E 的产品代码与拟合入主线代码一致；其后只补充本文验证记录。

市场管理员入口的隔离补跑结果：`playwright test e2e/market-community.spec.ts --grep '管理员：门禁未决'`，1 passed（44.6 秒），退出码 0。完整运行的 HTML 报告另存于功能工作区 `.artifacts/main-closeout/full-playwright-report/`，以免定向补跑覆盖；完整原始日志仍为 `/tmp/molio-main-e2e-final.log`。
