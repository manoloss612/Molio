# 第一期执行计划：服务器访问控制与独立管理员会话

状态：第一期实现与自动化验收已完成，等待用户审核（2026-10-30）。实际结果、跳过范围和审核入口见 `docs/phase1-admin-access-review.md`；以下保留执行依据，已有成果一节描述实施前状态。

本文件接续当前工作区，作为第一期执行依据；此前完整方案中的第二、三期仍不实施。本文的接口和验收约定优先于旧方案中的第一期草案。

## 1. 目标和完成定义

服务器模式下，每次管理请求都必须持有有效管理员会话；匿名请求无法读取私有数据或触发管理操作。退出、到期、凭据变化后，旧会话和相应管理事件流失效。本地模式只绑定回环地址，保持现有本机工作流。

一期只交付后端访问边界、管理员认证 API、必要的调用方兼容、密码工具和审核文档。公开 Wiki、公开图谱、公开设置、完整管理员前端及 Docker 安装交互属于后续阶段。

一期没有完整登录页面，用户通过 API smoke 和自动化测试审核。服务器界面的原业务请求尚不具备登录/CSRF 适配，不应把一期称为最终可上线的网站。

**停止条件：**本文件第 9 节全部核验完毕，提交测试记录及改动说明，停止等待用户审核。不推送、不部署，不进入第二期；最终保留本地可审阅 diff。

## 2. 已有成果与执行约束

- 工作目录 `/home/ss/Projects/molio`；当前分支 `docs/public-wiki-admin-plan`。执行前确认分支与工作区，保留用户修改；不得在 main 上实施。
- 已有 `apps/daemon/src/core/access/config.ts` 和 `apps/daemon/test/access/config.test.ts`，目前均未跟踪。四项测试已通过，但配置未接入运行链路，不算 Task 1 完成。
- daemon/contracts 的过滤安装已成功；contracts 构建及 daemon 类型检查已通过。重新验证当前状态，除非缺依赖，不重复安装。
- Node.js >=24；package.json 指定 pnpm 11.5.0；当前运行工具报告 pnpm 11.25.0。记录实际版本，不为本期升级工具链或改锁文件。
- 原 `/api/auth/*` 是实例持有 token 的云账号镜像，不能用作访客或管理员身份。`apps/cloud` 的市场管理员也不能复用为本站管理会话。
- 遵守根 `AGENTS.md`。代码变更必须在分支上；涉及核心路径时完成要求的完整 Web E2E。不得把四个单元测试通过描述成权限改造完成。
- 此文件位于普通 `docs/`，便于进入 Git；旧 `docs/superpowers/` 被仓库忽略，不要依赖它作为唯一交付记录。

创建本期本地进度记录 `.artifacts/phase1-access/progress.md`，记录每步状态、命令、退出码及未解决事项。该目录已被忽略；最终另写可交付的 `docs/phase1-admin-access-review.md`，后续 Codex 以记录和实际代码恢复进度。

## 3. 固定接口和行为约定

### 启动配置

`loadAccessConfig(env: NodeJS.ProcessEnv): AccessConfig` 改为判别联合：local 只有 mode/host；server 必须包含 mode/host/publicOrigin/username/passwordHash。避免后续调用方用非空断言掩盖漏校验。

- `MOLIO_ACCESS_MODE` 未设置默认 local，未知值拒绝启动。
- local 默认 `127.0.0.1`，允许显式 `::1`；现有 `localhost` 输入规范化为 `127.0.0.1`，其余地址拒绝。
- server 默认监听容器内 `0.0.0.0`；必须提供 `MOLIO_PUBLIC_URL`、`MOLIO_ADMIN_USERNAME`、`MOLIO_ADMIN_PASSWORD_HASH`。
- PUBLIC_URL 必须是无凭据、无查询、无 fragment、无业务路径的 HTTPS Origin，可有显式端口。它描述反向代理后的外部地址，不表示 Node listener 自己终止 TLS。
- 密码编码格式固定为 `scrypt$32768$8$1$<16字节salt的hex>$<64字节key的hex>`；启动时检查格式、参数、长度，禁止任意非空字符串通过。scrypt maxmem 使用 64 MiB，不接受配置任意提高计算参数。
- 校验必须早于 server 的数据库/服务初始化副作用、端口监听和后台任务。引入独立 bootstrap 模块或经审查等价的导入结构；仅在 index.ts 静态导入 server 后校验不满足此条件。
- 显式把 `host` 传给 `serve`。启动失败错误不输出配置值、哈希或凭据。

### 管理员会话

- 单管理员、单 daemon 进程。密码与会话模块使用 Node 内置 crypto，不新增认证框架。
- `hashPassword(password): Promise<string>`、`verifyPassword(password, encodedHash): Promise<boolean>`；恒定时间比较派生 key。
- `createSessionStore(db, options?)` 提供 `create()`、`verify(rawToken)`、`revoke(rawToken)`、`revokeAll()`、`subscribeRevocation(callback)`；时间可依赖注入用于测试。
- token 为 32 字节安全随机数的 base64url；SQLite 只存 SHA-256 摘要、创建/到期时间及凭据指纹，不保存原 token。会话绝对有效期 12 小时，查询不续期。
- 凭据指纹包含规范化用户名和密码哈希；启动时指纹变化撤销历史会话，指纹未变时有效会话可跨重启恢复。通过重启应用变更管理员配置，本期不热更新。
- CSRF token 可由有效原始会话 token 以 HMAC-SHA256 派生，使用固定用途字符串 `molio-admin-csrf-v1`。不把会话 token 本身返回到 JSON，也不把 CSRF token 用作认证凭据。
- Cookie 名 `__Host-molio_admin`，固定 `HttpOnly; Secure; SameSite=Lax; Path=/`，不设置 Domain；Max-Age 与剩余绝对寿命一致。
- SQLite 会话表迁移遵循 `core/db.ts` 现有约定，旧数据与云端登录不受迁移影响；过期会话有明确清理路径。

### HTTP API 与统一门禁

| 方法和路径 | 约定 |
| --- | --- |
| `GET /api/access/session` | `{mode, authenticated, expiresAt?, csrfToken?}`；匿名不返回私有字段；local 返回 mode=local、authenticated=false，不伪造管理员登录 |
| `POST /api/access/login` | server 接收 `{username,password}`；成功 200 并设置新 Cookie，旧 Cookie 不得被升级复用；错误凭据统一 401 |
| `POST /api/access/logout` | server 必须有会话及有效 CSRF/Origin；撤销当前会话、清 Cookie，返回 204 |
| `GET/HEAD /api/health` | server 匿名只返回 `{status:'ok'}`；local 保留桌面需要的原诊断字段 |
| 其他所有 `/api/*` | server 默认要求管理员；local 按原有本机行为处理 |

第一期不放行任何 `/api/public/*` 占位前缀。未知 API、错误方法、编码及重复斜杠变体不能绕过保护并执行原有路由；正常静态前端资源允许加载，但它们不能读取未授权 API。

server 返回规则：无效/缺失/过期会话为 401；已登录但 Origin/CSRF 不合规则为 403。管理与认证响应统一 no-store，不被旧 SSE/header 设置覆盖。健康检查可单独例外。

server 登录必须校验配置的 Origin；其他非安全方法（非 GET/HEAD/OPTIONS）必须同时校验 Origin 和 `X-Molio-CSRF`。缺少 Origin 也拒绝；CLI smoke 显式携带 Origin，不留无 Origin 绕过通道。server 不信任任意 Host 或 X-Forwarded-For，不因 localhost Origin 自动放行。CORS 只允许配置的站点 Origin，带 Cookie 策略与之匹配；local 保留现有开发跨端口行为。

登录请求体最大 4 KiB，按实际读取字节限制，不能只信 Content-Length；验证 JSON、字段类型与长度。限制同时进行的 scrypt 校验最多 2 个；单实例所有用户名合计每 60 秒最多 5 次失败，达到上限返回 429 和 Retry-After。重启会重置内存限速，本期明确为单进程部署，后续多实例再共享限速状态。

用户名规范化后长度为 1–128 个字符，密码按 UTF-8 限制为 1–1024 字节；超限输入返回 400。哈希工具生成新密码时要求至少 12 个字符且不超过上述字节上限，并要求两次输入一致。local 的 login/logout 返回 409 `local_mode_no_login`，不创建会话或 Cookie。

### 事件流失效

所有管理 SSE 入口都经统一门禁。已建立流在绝对到期时关闭，退出/revokeAll 同进程立即触发关闭；关闭须清理事件订阅、ping timer、会话监听及不再需要的临时资源，重复关闭须安全。

新增通用 `bindSessionLifetime(context, close): dispose` 或等价 helper；它读取已验证会话、注册撤销监听和到期计时，正常结束/断线时 dispose。local 为 no-op。流关闭与底层业务任务是不同生命周期，不得因为一个观察连接失效而盲目取消可供其他管理员会话观察的运行任务；安装流的连接取消沿用现有业务语义。

必须检查并接入目前发现的四个位置：`routes/events.ts`、`routes/knowledge.ts`、`routes/agents.ts`、`routes/preload.ts`。实施时重新搜索 `text/event-stream`、`stream(`、`new ReadableStream`，发现其他管理流一并纳入，不能只改任务 SSE。

## 4. 文件责任边界

| 文件 | 责任 |
| --- | --- |
| `apps/daemon/src/core/access/config.ts` | 校验配置和判别联合类型 |
| `apps/daemon/src/core/access/password.ts` | 哈希编码、解析及密码验证 |
| `apps/daemon/src/core/access/sessions.ts` | 持久化会话、凭据变化撤销、撤销通知 |
| `apps/daemon/src/core/access/guard.ts` | 身份识别、精确白名单、写请求保护、缓存头 |
| `apps/daemon/src/core/access/stream-lifetime.ts` | 管理流的会话寿命绑定与清理 |
| `apps/daemon/src/routes/access.ts` | 登录、查询会话、退出、限速和输入约束 |
| `packages/contracts/src/access.ts`、`src/index.ts` | 对外响应类型；不能导出内部令牌/密码哈希类型 |
| `apps/daemon/src/core/db.ts` | 会话表/状态迁移，保留已有数据 |
| `apps/daemon/src/server.ts`、`src/index.ts`、必要的 bootstrap 模块 | 提前校验、接线、正确监听顺序 |
| 上述四处流路由 | 绑定会话寿命并释放资源 |
| `scripts/create-admin-password.mjs` | 终端隐藏输入并确认密码，仅输出可复制的编码哈希 |
| `docs/phase1-admin-access-review.md` | 配置、API smoke、实际测试结果、已知限制及审核清单 |

密码脚本导入构建后的 `../apps/daemon/dist/src/core/access/password.js`，与服务复用同一算法模块。文档注明先运行 contracts/daemon build，再 `node scripts/create-admin-password.mjs`；缺少构建产物时输出操作提示。脚本要求 TTY，不通过命令行参数传明文；Ctrl-C 时恢复终端状态。

## 5. 按行为闭环执行，不在准备工作后停止

每项先写关键失败用例并观察失败，再实现并运行相关测试。已有配置测试保留扩充，不重复声称从零完成。

### A. 补齐配置和密码能力

- [x] 检查当前依赖；缺失时仅执行 `pnpm install --filter @molio/daemon... --frozen-lockfile`。单次安装串行完成，不同时触发第二次安装，不等待 Electron 二进制。
- [x] 在 `test/access/config.test.ts` 加合法 server 配置、无效哈希、URL/host 边界和 localhost 规范化测试。
- [x] 新增 `test/access/password.test.ts`：正确/错误密码、不同 salt、畸形哈希及资源参数上限；覆盖密码工具生成结果可被服务验证。
- [x] 实现密码模块、配置收紧及脚本；完成针对性测试、contracts 构建和 daemon 类型检查。

### B. 完成持久化会话及认证 API

- [x] 新增 `test/access/sessions.test.ts`：真实临时 SQLite；验证无原 token 落盘、独立会话、退出、绝对到期、同文件重新打开恢复、凭据变化撤销、过期清理。
- [x] 新增 `test/routes/access.test.ts`：成功/失败登录、Cookie flags、匿名状态、CSRF 派生绑定、请求体边界、登录失败限速、并发校验限制及退出。
- [x] 实现 DB 迁移、session store、access 路由；时间/定时器按现有测试模式注入，不等待真实 12 小时。
- [x] 检查凭据和 Cookie 不进入日志；测试错误响应不包含密码、哈希或 token。

### C. 接入真正的启动与请求链路

- [x] 新增 `test/access/guard.test.ts`，用挂载真实 guard/access 路由的 Hono app 驱动真实会话；断言匿名拒绝、登录可读、写请求 CSRF/Origin、登出后拒绝、local 兼容及精确白名单。
- [x] 新增 `test/access/startup.test.ts`：子进程使用独立数据目录和临时端口；非法配置非零退出且端口未开放，合法配置按指定 host 监听。
- [x] 让配置校验先于 server 初始化副作用；把 guard 放到全部业务处理之前，按模式处理 CORS 和 health。
- [x] 新增 `test/access/server-boundary.test.ts` 驱动实际 server app/隔离服务，证明下表管理接口匿名返回 401。关机等危险请求只能用被拒绝的匿名测试，成功路径用隔离子进程，避免退出测试 runner。
- [x] 修正任何因回环监听而出现的 Vite/Electron localhost IPv4/IPv6 兼容问题，选择本机地址须保持一致；对必要调用方改动加回归测试，不扩大到前端登录功能。

权限矩阵至少包含：agents、runs（含 tool-result 和 events）、config、skills、conversations、projects、knowledge（含文件/raw/树/搜索/events）、publish、proxy、graph、weixin、feishu、preload、maintenance、quiz、原 auth、market、shutdown。覆盖 GET/POST/PUT/PATCH/DELETE 的实际存在路由；未经授权时业务处理不得产生副作用。

### D. 关闭失效会话的管理流

- [x] 新增 `test/access/stream-lifetime.test.ts`：到期、当前会话退出、全部撤销、正常结束、客户端断线和重复 cleanup；验证没有残留监听/计时器。
- [x] 对四类实际流做路由集成测试，验证撤销后 EOF/关闭并停止后续事件；两个管理员会话中的一个退出不影响另一个，也不误停共享任务。
- [x] 接入 helper 并运行原 SSE 相关测试；新连接必须重新验证会话。

### E. 运行验证并整理用户审核材料

- [x] 先跑新增/受影响测试，再执行 daemon 全量单元测试、类型检查和 build；遇到失败先定位，记录是否原有，不把失败静默归为环境问题。
- [x] 根据触及路径执行根 AGENTS.md 要求的完整 Web E2E，使用现有 Playwright 隔离目录和独立端口；local 模式显式设置以防继承开发者 server 环境。需要 Web/cloud 依赖时过滤安装对应包，浏览器安装独立于 Electron。
- [x] 运行 server 模式 API smoke；实际服务的 data/runtime 目录隔离，外部 Origin 用 HTTPS 测试站点值。用原始 HTTP 客户端显式带 Cookie 验证接口不等同于验证浏览器 Secure Cookie，必须注明区别；浏览器 Cookie 验证需要 HTTPS 测试链路或已有 browser context 能力。
- [x] 完成 diff 检查，填写交付清单，停止供用户审核。若某项回归因真实外部条件无法完成，保留明确未验收状态、错误与复现命令，不宣称第一期全部完成。

## 6. 验证命令

首次只在确有缺依赖时使用过滤安装。基本验证按顺序执行，长输出保存到本期 artifacts 后阅读结果：

```bash
pnpm --filter @molio/contracts build:fresh
pnpm --filter @molio/daemon exec tsx --test 'test/access/*.test.ts' test/routes/access.test.ts
pnpm --filter @molio/daemon typecheck
pnpm --filter @molio/daemon test
pnpm --filter @molio/daemon build
```

新增测试在创建后才能列入命令；按实际新增文件更新命令，不能因不存在的 glob 产生伪失败。node:test/tsx 支持情况以本地输出核对，必要时改为编译后 `node --test` 运行同一组测试。

完整 Web E2E 示例，先确认这些端口未占用：

```bash
MOLIO_ACCESS_MODE=local MOLIO_E2E_DAEMON_PORT=3100 MOLIO_E2E_WEB_PORT=5173 MOLIO_E2E_CLOUD_PORT=3201 MOLIO_E2E_MOCK_OSS_PORT=3199 pnpm --filter @molio/web test:e2e
```

最终完整回归使用以上默认端口；既有用例包含固定 localhost:5173 地址，不能假设仅更换环境变量即可切换所有用例端口。不设置复用已有服务；使用现有 Playwright config 创建的独立目录。不要为恢复依赖删除用户数据、执行 git clean -fdx、杀掉其他项目的服务或把 PRIVATE 配置写进仓库。

## 7. 人工 API smoke 的固定顺序

把以下操作做成可复跑的测试或脚本，错误凭据使用测试专用数据，不能使用真实知识库：

1. 空白隔离目录，缺少管理员配置启动 server：失败且无监听；合法配置启动：health 只返回 status。
2. 匿名读 config/knowledge、创建 run、请求 graph/流、调用 shutdown：全部 401，无业务副作用。
3. 带可信 Origin 登录：200，保存新 Cookie；查询 session：authenticated=true，取到 csrfToken。
4. 带 Cookie 读管理 API：成功；写请求无 CSRF、错 CSRF、无 Origin、错 Origin：403；两者正确时成功。
5. 开启两个管理员会话的管理 SSE，退出其中一个：该流关闭、旧 Cookie 401，另一个会话仍可用。
6. 重启同配置同目录：未过期的另一个会话仍有效；改密码哈希并重启：旧会话 401。
7. 到期用受控时钟测试证明；用 local 启动验证回环监听和现有知识库/任务请求兼容。

## 8. 执行中的判断规则

- 用户已授权第一期；常规实现选择自行解决并记入记录，不再反复请求开工确认。
- 遇到安装/测试长时间无输出，先检查进程及真实错误；不得无依据中断后把 SIGINT 描述为依赖故障。
- 不以读完技能、安装结束、四项配置测试通过或类型检查通过为停止条件。
- 阶段内每完成一个闭环给出简短进度；发生阻塞时说明具体证据及独立可继续的工作。
- 不把第二期功能混入第一期，也不为了少改文件跳过 server 的真实接线和流清理。

## 9. 最终验收与交付格式

- [x] 启动模式真实生效，错误 server 配置拒绝启动，local 只监听回环。
- [x] 匿名管理 API 均为 401，登录后访问成功，无遗漏路由或方法绕过。
- [x] Cookie、密码、限速、CSRF 和 Origin 约束有自动化证据。
- [x] 退出/到期/凭据变化撤销有效，数据库恢复不延长会话寿命。
- [x] 四类管理流关闭及资源清理有证据，独立会话互不误伤。
- [x] 原有本地工作流回归通过；必要的调用方兼容改动已说明。
- [x] daemon 测试/build/typecheck 和要求的完整 Web E2E 结果已记录；未完成项明确列出。
- [x] 提供哈希工具用法、server/local 配置示例、API smoke 命令及审核入口；仓库无测试凭据和真实数据。

最终答复只报告：实现了哪些行为、哪些命令实际通过、未解决事项、审核文档位置。只有本节全部满足才能说“第一期完成”；随后停止等待用户审核。
