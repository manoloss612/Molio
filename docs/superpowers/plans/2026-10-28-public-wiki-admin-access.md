> **历史草案，已被后续分期方案替代（2026-11-25 对齐）。**
> 当前产品采用逐篇选择、预览确认和不可变发布快照；编辑、删除源文件不会自动更新已发布内容。
> 本文以下内容保留为最初提案，不再作为待实现清单；实时公开、多库 slug、公开搜索和 `/admin/*` 全面迁移等条目不代表当前承诺。
> 当前范围、实际交付、证据与剩余事项见 [公开 Wiki 当前设计与交付状态](../../2026-11-25-public-wiki-delivery-status.md)。
> 后端权限以一期执行计划为准，管理员 Web 以二期设计为准，公开发布以 2026-11-11 三期设计及上述状态文档为准。

# Wiki / 知识图谱公开访问与管理员权限 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本文为待审阅的实施草案，不代表已授权开始实现。

**Goal:** 访客匿名浏览指定 Wiki 和图谱，全部管理功能由独立管理员会话保护。

**Architecture:** 沿用现有 pnpm monorepo、Hono、React、SQLite。公开读取 API 和统一内容服务独立实现，现有管理 API 集中鉴权。通过显式 local/server 模式兼容桌面和公网部署。

**Tech Stack:** Node.js >=24、pnpm 11.5.0、TypeScript、Hono、React/Vite、better-sqlite3、node:crypto、node:test、Playwright。

**Spec:** `docs/superpowers/specs/2026-10-28-public-wiki-admin-access-design.md`（草案，重点审阅 §1、§3、§6）。

## Global Constraints

- 所有现有知识库默认不公开；公开范围先固定为 Wiki 正文和允许的图片。
- server 缺少管理员或可信站点配置时启动失败；local 只监听回环地址。
- 原有云端登录与管理员浏览器会话独立；不能复用实例共享登录态识别访客。
- 非白名单 `/api/*` 默认管理员可用，包括只读的会话、配置和原文件 API。
- 公开视图不触发 Agent、不写文件、不切换 daemon 的全局 active vault。
- 图片、正文、图谱、双链、搜索共享同一公开文档集合；撤销公开立即失效。
- 代码分支走 PR，不直接 push main；push 前遵守根 AGENTS.md 的 OCR 自检要求。
- 修改 docker-compose.yml / .env.example 时同步 install.sh 内嵌副本。

## Review Focus

- 原有 GET/POST/SSE/关机/代理等接口被遗漏鉴权：Task 1/2 的路由矩阵覆盖。
- 编码路径、Windows 分隔符与符号链接越界：Task 3 的真实临时目录测试覆盖。
- 私有节点名称、搜索摘要或资源通过关联关系泄露：Task 3/4 的公开/私有混合夹具覆盖。
- 退出、凭据变化、公开撤销后复用旧连接/缓存，以及 watcher 失败/漏事件：Task 2/4/6 的撤销和新鲜度测试覆盖。
- 公开页挂载后台 store 导致隐式管理请求，或桌面旧路由失效：Task 5/6/7 的网络断言和模式回归覆盖。

## 文件职责与任务依赖

以下新增文件名为建议命名；现有文件以仓库实际结构为准，不做无关重构。

| 任务 | 新增职责 | 主要修改现有文件 | 前置 |
| --- | --- | --- | --- |
| 1 | `core/access/config.ts`、`core/access/guard.ts`、`contracts/src/access.ts` | daemon server.ts/index.ts、contracts index.ts | 无 |
| 2 | `core/access/password.ts`、`core/access/sessions.ts`、`routes/access.ts`、`scripts/create-admin-password.mjs` | daemon core/db.ts、guard.ts、原 SSE 路由 | 1 |
| 3 | `core/publication/store.ts`、`core/publication/content.ts`、`core/graph-builder.ts`、`contracts/src/publication.ts` | daemon core/db.ts、routes/graph.ts、contracts index.ts | 1 |
| 4 | `routes/public.ts`、`routes/publication.ts` | daemon server.ts、vault watcher 的失效接线、static-files.ts | 2、3 |
| 5 | `PublicApp.tsx`、`components/public/*`、`api/publicClient.ts`、只读图谱展示组件 | web main.tsx/App.tsx、GraphPage.tsx、Markdown 链接适配 | 4 |
| 6 | `AdminApp.tsx`、管理员登录/守卫/公开设置组件、`api/accessClient.ts` | web App.tsx/client.ts/sse.ts、路由工具、i18n | 2、4、5 |
| 7 | 服务器部署文档、访问权限回归夹具 | Dockerfile/compose、.env.example、install.sh、desktop main.js、E2E 配置和 area-map | 1–6 |

## Task 1：访问模式与后端统一门禁

**Interfaces**

- `AccessMode = 'local' | 'server'`。
- `loadAccessConfig(env: NodeJS.ProcessEnv): AccessConfig`：规范化模式、监听地址、站点 Origin、管理员配置；非法 server 配置抛出明确错误。
- `createAccessGuard(config, sessionVerifier): MiddlewareHandler`：在所有业务路由之前安装，支持后续注入会话校验器。
- `AccessSession`：只包含模式、管理员是否登录及需要的 CSRF 字段，不包含内部配置。

**Test:** `apps/daemon/test/access/config.test.ts`、`guard.test.ts`。

- [ ] 测试 local 回环限制、server 必填配置、非法模式和非 HTTPS 公网配置。
- [ ] 用 Hono 夹具覆盖公开白名单的精确路径与方法；匿名访问现有管理 GET/POST/DELETE/SSE 一律 401，未知 API 不能绕过保护，GET 登录接口不被误开放。
- [ ] 实现启动配置前置校验、集中门禁和最小健康检查；匿名健康检查不含内存、活跃任务和版本以外的内部细节（建议只返回 status）。
- [ ] 先编译再运行新增 node:test，确认失败用例转为通过；提交 `feat(daemon): add server access boundary`。

## Task 2：管理员密码与浏览器会话

**Interfaces**

- `verifyPassword(password: string, encodedHash: string): Promise<boolean>`：使用带参数的 scrypt 哈希和恒定时间比较。
- `createSessionStore(db)`：提供 `create()`、`verify(rawToken)`、`revoke(rawToken)`、`revokeAll()`；数据库只保存 token 摘要。
- `accessRoutes(config, sessionStore): Hono`：实现 spec §7 中 session/login/logout。
- `requireAdmin` 校验会话与到期时间；Cookie 写请求必须通过可信 Origin 和 CSRF 验证。

**Test:** `apps/daemon/test/access/password.test.ts`、`sessions.test.ts`、`apps/daemon/test/routes/access.test.ts`。

- [ ] 编写登录成功/失败、限速、有效 Cookie、12 小时到期、重启恢复、退出和凭据变化撤销测试；校验 Cookie flags 与响应 no-store。
- [ ] 编写无 Origin/伪造 Origin、缺失/错误 CSRF、session fixation 和随机无效 token 的拒绝用例。
- [ ] 增加 SQLite 会话表和凭据指纹；实现登录路由、密码哈希生成脚本；输入密码不出现在进程参数或日志。
- [ ] 实现 SSE 会话到期/撤销后的关闭机制；限制新连接且防止长连接无限保留权限。
- [ ] 编译并运行上述测试；提交 `feat(daemon): add administrator sessions`。

## Task 3：统一公开内容服务与图谱数据构建

**Interfaces**

- `PublicationSettings`：`vaultId, enabled, slug, title, description, policyVersion, updatedAt`。
- `PublicVaultSummary`：仅含 `slug, title, description`；不复用包含绝对路径的 `Vault` DTO。
- `PublicContentService`：`listVaults()`、`getTree(slug)`、`readDocument(slug, path)`、`resolveLink(slug, target)`、`getAsset(slug, path)`、`search(slug, query)`、`getGraph(slug, scope?)`。
- `buildGraphFromDocuments(documents: Array<{path: string; content: string}>, options): GraphData`：复用现有解析规则；公开选项禁用私有/未解析目标节点，后台保持原有行为。

**Test:** `apps/daemon/test/publication/store.test.ts`、`content.test.ts`、`graph.test.ts`。

- [ ] 测试默认不公开、slug 唯一且稳定、无效 slug、删除库时清理配置；从现有数据库迁移不改变原数据。
- [ ] 建立混合夹具：wiki 公共文章、INDEX/LOG、根目录私有 Markdown、隐藏配置、公共图片、私有 PDF、符号链接及跨范围双链。
- [ ] 断言目录、正文、链接解析、图谱、搜索及图片共享范围；私有目标名称不出现在节点/边/统计/搜索摘要和错误中。
- [ ] 测试 `..`、百分号编码、反斜杠、大小写和符号链接越界；使用真实临时目录验证路径边界。
- [ ] 实现存储、统一范围判定和只读服务；抽出纯图谱构建入口，保留原 buildGraph 的后台包装与现有图谱用例。
- [ ] 编译并运行新增及受影响图谱测试；提交 `feat(kb): define public wiki content scope`。

## Task 4：公开读取 API 与管理员公开设置 API

**Interfaces**

- `publicRoutes(service): Hono`：实现 spec §7 全部 `/api/public/*` GET/HEAD 读取；不转发旧知识库接口。
- `publicationRoutes(store, service): Hono`：实现受保护的 `/api/admin/publication/:vaultId`。
- `service.invalidate(vaultId)`：文件变化、删除库和公开设置变化时统一失效，缓存 key 包含策略版本。

**Test:** `apps/daemon/test/routes/public.test.ts`、`publication.test.ts`、`static-files.test.ts`。

- [ ] 测试公开响应的逐字段 DTO、非法输入、未公开资源 404、公开端点拒绝写入、受限搜索、资源 MIME/no-sniff 以及私有路径不出现在错误中。
- [ ] 测试撤销公开/改 slug/删除文章/从范围内移出文件后，重复访问旧路径和缓存均不可读。
- [ ] 模拟 watcher 未就绪、失败及遗漏事件：外部删除、移出文件或替换为越界符号链接后，树、正文、图谱、搜索及图片均不复用旧的越界数据；文件变化后的新请求能看到当前内容。
- [ ] 实现公开路由与设置路由；每次请求复查当前公开集合、真实路径及文件签名，读取时再次校验目标，无法确认时重算或拒绝；watcher 仅作为额外失效提示。公开读取初版 no-store，API 不被 SPA fallback 接管。
- [ ] 测试 `/wiki/:slug`、`/graph/:slug`、`/admin/login` 深链接刷新返回页面入口；缺失静态资源仍返回 404。
- [ ] 编译并运行新增路由及静态服务测试；提交 `feat(daemon): expose scoped public knowledge APIs`。

## Task 5：公开 Wiki 与只读图谱页面

**Interfaces**

- `publicClient` 仅调用公开 API，响应类型来自新的公共契约。
- `PublicApp` 提供公开列表、Wiki、图谱、搜索和空状态。
- 图谱展示组件接受 `data, scope, onNodeOpen` 等展示属性，不直接调用 API 或写文件。
- 公共正文使用 `MdRenderer untrusted`，内部链接只解析公开目标，图片仅走公开资源 API。

**Test:** `apps/web/e2e/public-wiki.spec.ts`、`public-graph.spec.ts`。

- [ ] 编写访客列表→文章→双链→图谱→文章的 E2E；测试刷新、后退、URL 编码路径及无公开库状态。
- [ ] 监听网络，断言公开浏览不请求 config、agents、conversations、原 knowledge、原 graph 或管理 SSE，也不发任何写请求。
- [ ] 测试恶意 HTML/脚本链接的清理；私有附件不可读；公开死链点击不调用建文件接口。
- [ ] 拆分公共应用入口并实现页面；抽出图谱展示层，原后台 GraphPage 保留供数和管理交互。
- [ ] 运行新增 E2E 和既有图谱核心用例；提交 `feat(web): add public wiki and graph browsing`。

## Task 6：管理员界面、公开设置和旧路由兼容

**Interfaces**

- `accessClient` 封装管理员 session/login/logout；私有请求统一处理 401 与 CSRF。
- `AdminRoute` 在验证前显示加载状态，验证后挂载 `AdminApp` 及后台 stores/providers。
- 知识库的公开设置提供开关、唯一地址、标题、简介和访客预览入口；明确提示开启后修改实时可见。

**Test:** `apps/web/e2e/admin-access.spec.ts`、`publication-settings.spec.ts`；更新现有 `auth.spec.ts` 和路由相关用例。

- [ ] 测试匿名手输后台 URL、书签和刷新均进入登录，登录后返回允许的本站管理路径，拒绝外部 redirect。
- [ ] 测试管理员可正常操作原有工作台，公开设置保存后访客立即看到内容，关闭后旧公开 URL 失效。
- [ ] 测试两个浏览器 session 独立、访客切库不影响管理员、退出清理私有 store/请求、到期请求 401 后返回登录。
- [ ] 实现 `/admin/*`、登录守卫、设置页及必要的中英文文案；适配旧路由、协议跳转和 SSE cookie/过期处理。
- [ ] 运行新增用例及受影响导航、账号、知识库、聊天用例；提交 `feat(web): protect administrator workspace`。

## Task 7：部署、兼容回归与交付

**Test:** 扩充 daemon 启动配置测试、desktop 启动测试、E2E area-map 和部署 smoke 检查。

- [ ] Docker/安装脚本显式配置 server 模式；交互式生成管理员哈希并保存所需配置。缺少配置、代理 Origin 错误和 HTTP 公网配置时明确失败。
- [ ] 更新 compose/.env.example/install.sh 的内嵌副本、Docker 镜像资源和 HTTPS 反向代理文档；凭据只从环境/受保护配置读取。
- [ ] Electron 显式使用 local；验证本地监听地址、深链接与现有桌面工作流；更新 Node/pnpm 前置要求与 README。
- [ ] 检查所有 API 的方法/路径权限矩阵，覆盖 health/shutdown/proxy/tool-result/preload/auth/market/SSE；不遗漏只读管理端点。
- [ ] 执行 `pnpm typecheck`、`pnpm build`、相关包测试。由于触及根 AGENTS.md 列出的核心文件，运行完整 Web E2E，并记录命令与结果。
- [ ] 使用隔离数据目录做 server 模式部署 smoke：公开只读可访问、管理接口被拒绝、登录/退出/重启正常、撤销公开有效。
- [ ] 审查 diff、运行仓库要求的 OCR push 前自检，准备 PR；记录配置步骤、管理员恢复方法及实时公开的行为。

## 验证命令约定

实现时先按包的现有脚本准备依赖和 contracts；不为编写本方案安装依赖或运行产品测试。

```bash
pnpm build:contracts
pnpm --filter @molio/daemon build
# 在 apps/daemon 目录运行，例如：
node --test --test-timeout=30000 'dist/test/access/*.test.js' 'dist/test/publication/*.test.js'
pnpm --filter @molio/daemon test
pnpm typecheck
pnpm build
# 受影响 Web E2E 与最终完整 E2E，需按现有指南启动隔离的 daemon + web：
pnpm --filter @molio/web test:e2e
pnpm --filter @molio/desktop test
```

测试时使用独立 `MOLIO_DATA_DIR` 和临时 vault，不使用真实个人知识库与凭据。初版无需更改 cloud 的认证/市场实现；若开发中发现依赖，先说明新增范围。

## 可审阅的阶段交付

- 第一期（Task 1–2）：服务器全部管理入口有有效登录保护。
- 第二期（Task 3–5）：访客能够只读浏览指定 Wiki 和图谱，公开范围一致。
- 第三期（Task 6–7）：后台可配置公开内容、桌面兼容、部署配置和回归完成。

以上阶段按依赖顺序交付；完整上线应等三期全部完成。工作量属于跨前后端、数据库和部署的中型改造，不宜按“隐藏菜单”估算。
