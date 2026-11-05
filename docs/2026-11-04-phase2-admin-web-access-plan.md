# 第二期管理员 Web 使用闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. 用户已批准顺序实施；当前 agent 执行，完成后进行一次独立全分支审核。

**Goal:** 让单管理员通过同源 HTTPS Web 完成登录、管理读写、刷新恢复、会话失效处理与退出，并保持 local 直接使用。

**Architecture:** 以独立 AccessBoundary 包住现有 App，用独立 controller 复用一期管理员协议；daemonFetch 与 managed-events 管理请求、流和会话世代。确认会话终止后整页重载以清除模块缓存，云账号继续独立。

**Tech Stack:** 现有 React 19、TypeScript、Vite 6、浏览器 fetch/EventSource、node:test、Playwright Chromium、现有 Hono/SQLite daemon；不新增运行时依赖。

**Spec:** [2026-11-04-phase2-admin-web-access-design.md](2026-11-04-phase2-admin-web-access-design.md)

状态：用户已批准并执行完成。最终源码 7b2fdeb；Web 完整连续 649 通过、1 专用环境跳过，零失败；详细证据见第二期审核指南。

## Global Constraints

- 单管理员、单 daemon、同源 HTTPS；复用一期 `/api/access/*`、`__Host-molio_admin` 和 12 小时绝对会话，不新增生产免密/短会话入口。
- 未确认模式/会话不挂载业务 App，不静默回退 local；local 的 authenticated=false 是合法直接使用状态。
- 云账号与本站管理员身份独立；任何 401/403 都不能直接认定为管理员失效。
- 密码、Cookie、CSRF 不写 URL、浏览器持久存储、日志或跨标签页消息；外部支付/OSS 请求不带管理员 CSRF。
- 管理写请求最多发送一次，重新登录不重放写入、创建任务或发送排队消息。
- 自动 session 复核每 30 秒（可见页），单次最长 5 秒；到期前 5 分钟提醒；以服务端复核为准。
- server SSE 网络自动恢复最多 4 次，延迟依次 1/2/4/8 秒；认证暂停/原生 CLOSED/重试耗尽不是任务完成。
- CSRF 变化表示会话替换，终止旧操作并重载；旧退出意图不得撤销新登录会话。
- 确认退出或失效后整页重载；未保存内存编辑可能丢失，主动退出须说明并允许取消；已保存文件与服务端任务记录保留。
- 不升级工具链，不改锁文件、生产部署、install.sh、Docker 配置或公开内容模型；保留现有 HANDOFF.md 及用户修改。
- UI 关键交互用 data-testid；错误修复在对应包补行为回归；触及核心文件后完整连续 Web E2E 必须通过。
- 所有实现通过 PR，禁止直接 push main；推送前 OCR 自审。当前 fork 草稿 PR 有冲突，不能把此计划视为合并、整合 main 或部署授权。

## Review Focus

1. 云账号业务 401/403 与管理员失效混淆，以及同 Cookie 被另一标签页替换——T1/T3/T5 以真实状态转换证明旧意图不能操作新会话。
2. 退出响应丢失、失败后返回应用、并发登录/复核迟到——T1/T2/T5 证明只在服务端确认后报告退出，旧异步结果不反转新状态。
3. SSE CLOSED、静默 OPEN、重连与排队 drain 竞争——T4/T5 证明仅续接原 run、暂停不清 runId、不发送队列、不重复恢复。
4. 时钟偏差、到期判断、后退缓存和重复挂载——T1/T2/T5 证明不误退、不闪现私人工作区、不泄漏监听/计时器。
5. 动态资源 URL、FormData 与外部支付请求——T3/T4/T5 证明上传边界正确、真实私有资源可用且 CSRF 不外发。

---

## 文件结构和接口约定

新增模块职责按设计 §9；下表锁定模块间约定，避免实现者临时发明不同协议。

| 模块 | 导出/依赖 |
|---|---|
| `access/resources.ts` | `createSessionResources(epoch: number): SessionResources`；readonly `epoch: number`、`signal: AbortSignal`、`closed: boolean`；`track(dispose: () => void): () => void`、`close(): void`。track 返回取消登记函数，不主动调用 dispose；登记到已关闭作用域立即 dispose |
| `access/session-controller.ts` | `createAccessController(deps: AccessDependencies): AccessController`、设计 §6 的 AccessState/AccessController；新增 `getContext(): AccessContext \| null`；匿名、退出、连接故障及需暂停的复核期间为 null |
| controller 类型 | `AccessContext = { mode: 'local'; resources: SessionResources } \| { mode: 'server'; expiresAt: number; csrfToken: string; resources: SessionResources }`；资源作用域与会话绑定，健康恢复可复用未终止作用域，已 close 不复用 |
| controller 依赖 | `AccessDependencies = { baseUrl: string; rawFetch: typeof fetch; now: () => number; schedule: (fn: () => void, ms: number) => () => void; createResources: (epoch: number) => SessionResources; retire: (reason: 'expired' \| 'signed-out' \| 'revoked' \| 'session-changed') => void; notifyPeer: () => void }` |
| 登录错误 | `AdminAccessError extends Error`：只公开 `status: number \| null`、`code: string`、`retryAt: number \| null`；不存输入密码、响应 Cookie 或 CSRF；不用必须依赖 TS 运行时转译的语法 |
| `access/runtime.ts` | `accessController: AccessController` 单例；`startAccessRuntime(): () => void` 装配 focus/visibility/pagehide/pageshow/BroadcastChannel/storage 事件，cleanup 幂等；保留单次、非敏感重载原因 |
| `api/http.ts` | `createDaemonFetch(controller: AccessController, rawFetch: typeof fetch, baseUrl: string): (input: string \| URL, init?: RequestInit) => Promise<Response>`；生产导出 `daemonFetch`；工厂测试不导入浏览器单例 |
| `api/managed-events.ts` | `ManagedTransportState = 'open' \| 'checking' \| 'reconnecting' \| 'paused' \| 'closed'`；`ManagedEventSubscription { close(): void; reconnect(): void }`；`ManagedEventsOptions { url: () => string; onMessage: (event: MessageEvent<string>) => void; onState?: (state: ManagedTransportState) => void; onError?: (event: Event) => void; onLocalClosed?: () => void }`；工厂 `createManagedEvents(deps: { controller: AccessController; createNative: (url: string) => EventSource; schedule: AccessDependencies['schedule'] }): (options: ManagedEventsOptions) => ManagedEventSubscription`；生产导出 `openManagedEvents(options)` |
| `api/sse.ts` | `subscribeToRun` 原 6 参数保留，追加 `onTransportState?: (state: ManagedTransportState) => void`，返回 ManagedEventSubscription；onDone 在 server 认证/网络暂停时不能触发，local CLOSED 适配保留 |

raw access API 不经 daemonFetch；controller 不反向 import http 或 React。runtime 在浏览器装配，纯工厂可被 node:test 导入。测试所需 E2E 夹具放 `apps/web/e2e/fixtures/`，不注入产品全局免密开关。

## 实施前置（必须在 T1 编码前完成）

- [x] 核对实际 Git/worktree/未提交文件，按 using-git-worktrees 技能选择现有合适工作区或隔离工作区；基线包含一期已验证快照和批准文档，不能默认切到 origin/main 丢失一期功能。分支遵循仓库规范，原备份分支、HANDOFF.md 和用户修改保留；先检查依赖，确有缺失才过滤安装，不并发安装、不下载无关 Electron 二进制。

## Task 1: 建立管理员会话状态机与资源作用域

**Files**

- Create: `apps/web/src/access/resources.ts`、`apps/web/src/access/session-controller.ts`
- Test: `apps/web/test/access/resources.test.ts`、`apps/web/test/access/session-controller.test.ts`

**Interfaces:** 消费现有 `@molio/contracts` 的 AccessSession/AdminLoginRequest；产出上表 controller、错误及 resources 工厂，供 T2/T3/T4 使用。

- [x] **1. 写失败测试：**用可动态切换的 rawFetch 与虚拟调度器驱动 `checking → local`、`checking → anonymous → authenticated`、超时 → unavailable → 重试恢复；断言缺字段/错误模式不会授权，local 不调用 login/logout。
- [x] **2. 写竞争与负面测试：**挂起一次 session 200，触发 logout/新登录后才释放；断言旧响应不覆盖新状态，被替代raw请求的signal被取消。403 后复核同 CSRF 保留业务错误；不同 CSRF 必须 retiring，不能继续旧 logout。对网络错误、5xx、畸形 JSON、429 Retry-After 两种格式分别断言准确状态。
- [x] **3. 写生命周期测试：**复核并发合并；5 秒超时释放 in-flight；30 秒轮询与 5 分钟提醒；模拟本机时间前后偏移，最终匿名判定必须来自真实协议响应。logout 未确认时不报告 signed-out；用户返回应用先复核，同会话恢复需新资源epoch，不复用已close作用域；retire 最多一次。
- [x] **4. 写资源行为测试：**close 两次只 dispose 一次；关闭后登记立即清理；signal 中止；已结束请求取消登记；旧 epoch 不复活；start/stop/start 不重复监听或计时器。
- [x] **5. 运行红灯：**`pnpm --filter @molio/web exec node --test 'test/access/resources.test.ts' 'test/access/session-controller.test.ts'`。预期相关行为断言失败；缺模块只证明尚无代码，关键竞态实现后仍须确认对应断言可捕获违规行为。
- [x] **6. 实现工厂和接口：**独立 raw access API、严格判别响应、递增操作世代、去重复核与定时器、logout 优先级。controller 自己实现会话判断，不复用 authStore 的“失败保留快照即继续授权”语义。
- [x] **7. 运行绿灯：**同命令零失败/零取消；检查计时器与资源被回收，再运行 Web typecheck。
- [x] **8. 提交此任务：**只 stage 上述文件，使用 `feat(web): add administrator session lifecycle`；若实际采用一并提交，保留本任务的独立检查记录。

## Task 2: 接入入口保护、真实登录与退出界面

**Files**

- Create: `apps/web/src/access/runtime.ts`、`AccessBoundary.tsx`
- Create: `apps/web/src/components/access/AdminLoginPage.tsx`、`AdminSessionControls.tsx`、`apps/web/src/styles/admin-access.css`
- Modify: `apps/web/src/main.tsx`、`App.tsx`、`components/NavRail.tsx`、`i18n/locales/zh.ts`、`en.ts`
- Create: `apps/web/e2e/fixtures/admin-server.ts`、`apps/web/e2e/admin-access-ui.spec.ts`
- Modify: `apps/web/e2e/area-map.json`
- Test: 扩展 `apps/web/e2e/admin-access-ui.spec.ts` 验证真实浏览器事件/广播/退场

**Interfaces:** 消费 T1。`AccessBoundary` 持有 controller 订阅且只在可用时 lazy App，由它调用 startAccessRuntime；runtime 内部调用 controller.start，避免两个宿主重复启动。AdminLoginPage 消费状态和 `login`；AdminSessionControls 消费状态和 logout/resumeAfterFailedLogout。夹具导出 worker 构建目录 fixture，以及 `startAdminServer(options: { webDir: string; username: string; password: string }): Promise<AdminServer>`；AdminServer 包含 `origin`、`dataDir`、`vaultDir`、`stop(): Promise<void>`、`restart(): Promise<void>`、`expireSession(tokenDigest: string): Promise<void>`，后两项只操作夹具进程/目录，不新增产品接口。

- [x] **1. 将夹具作为本任务的验收依赖建立：**worker fixture 以当前源码运行 `pnpm --filter @molio/web exec vite build --outDir <本次临时绝对路径> --emptyOutDir`，180 秒独立准备超时；不能复用旧 apps/web/dist。每例再建独立数据/runtime/vault 目录和 daemon、HTTPS 代理，使用随机测试凭据和原密码算法，设置 MOLIO_STATIC_DIR，并显式隔离默认/sample vault 路径。仅测试 context 使用 ignoreHTTPSErrors 接受临时自签名证书。启动失败输出脱敏日志，finally 有界关闭子进程/连接并删自己的目录。
- [x] **2. 写 UI 红灯：**匿名直达 `/knowledge?vault=test&file=article.md#anchor`；断言 `[data-testid="admin-login-form"]` 可见，`.entry-shell` 不存在，session 判定前没有 agents/config/knowledge/auth 请求；登录后 pathname/query/hash 原样保留，刷新恢复。初始session 500/超时不能出现 App；local 无管理员登录/退出。
- [x] **3. 写表单红灯：**`admin-username-input`、`admin-password-input`、`admin-login-submit`、`admin-login-error` 的键盘/重复提交/401/429/连接错误行为；密码不落持久存储，待提交状态阻止重复 POST。中文/英文文案可用，320px 不溢出。
- [x] **4. 写退出与事件红灯：**`admin-logout-btn`、`admin-logout-confirm`、`admin-logout-cancel`；取消不发请求；确认只发一次；204 后工作区卸载重载；网络错误显示 `admin-logout-unconfirmed`，不会声称已退出。BroadcastChannel 不含敏感字段，storage fallback 同样生效；重复 start/stop 不重复广播，收到 peer 事件只复核不回广播。
- [x] **5. 跑针对性红灯：**使用本计划“验证命令”中的独立端口执行 `admin-access-ui.spec.ts`。初次必须真实构建成功后在目标 UI 行为失败，不能把证书/启动错误当成功复现。
- [x] **6. 实现 runtime 与 UI：**入口在确认前不 import App；登录页只读本地语言/主题，不调用 LanguageProvider 写配置；NavRail 的管理员退出与云账号按钮分开。未知状态可重试，退出确认写清内存草稿代价；到期提醒与连接暂停展示；终止后只保留非敏感原因并 replace 当前同源地址。
- [x] **7. 接入 pagehide/pageshow：**后退缓存恢复前保持遮蔽；persisted 恢复重新加载并重新验证；普通 focus/visibility 复核。变更 CSRF 先退场、废弃旧操作。暂停罩层阻止键盘、焦点、鼠标和辅助技术访问工作区；暂时故障保留已挂载树、初次未决不挂载、新资源epoch以新key重挂载，已确认匿名立即卸载，而非只盖一层 CSS。
- [x] **8. 注册 P0：**新 spec 声明 auth/P0；在 area-map.specs 注册，同时加入 auth 的 specs；paths 纳入 `apps/web/src/access/**`、`apps/web/src/components/access/**`、`apps/web/src/styles/admin-access.css`、新传输模块。保留一期 server spec 及既有优先级。
- [x] **9. 针对性绿灯与提交：**T1/T2 测试、Web typecheck；保存首轮登录/刷新/退出 Trace。提交 `feat(web): add administrator access boundary and login`。此时“登录入口可验收”，其余管理写入由 T3 完成，不将阶段性结果当全期交付。

## Task 3: 统一所有 daemon 请求，保持业务错误与外部请求语义

**Files**

- Create: `apps/web/src/api/http.ts`、`apps/web/test/access/http.test.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/hooks/useMarketCatalog.ts`、`useWikiLinkClick.ts`
- Modify: `apps/web/src/components/account/AccountPage.tsx`、`ListingsSection.tsx`、`PurchasesSection.tsx`
- Modify: `apps/web/src/components/resources/ResourceDetailPage.tsx`、`PublishForm.tsx`、`TaxonomyFields.tsx`、`resourceAction.ts`
- Modify: `apps/web/src/components/kb/KnowledgeBasePage.tsx`、`KbMainContent.tsx`、`MdTypesetEditor.tsx`、`docExport/dom.ts`
- Test: 扩展 `apps/web/e2e/admin-access-ui.spec.ts`，保留/同步既有 auth、market-community、publish-flow、知识库链接/导出相关 spec

**Interfaces:** 消费 T1 的 getContext/revalidate/resources 与 T2 runtime 单例；产出 daemonFetch。保留 api 原业务方法签名、AuthApiError 解析和所有原 HTTP method/body。controller rawFetch 不能 import 该包装。

- [x] **1. 写传输红灯：**GET/HEAD/OPTIONS 不注入 CSRF；server POST/PUT/PATCH/DELETE 注入当前令牌；local 无令牌；Headers 与 JSON/body/signal 合并；FormData 不设置 Content-Type。绝对同源 URL允许，外源/协议相对外源 URL拒绝且从未调用 rawFetch。
- [x] **2. 写状态码红灯：**业务 401/no_session 后 session 仍相同有效，原响应交回 AuthApiError；业务 403 同理；session 匿名才退场；探测网络失败仅暂停。403 后新 CSRF 不再执行原请求。每个变体断言写入调用次数为 1。
- [x] **3. 写取消红灯：**调用方 signal、资源 close 都中止 fetch/body；挂起旧 200/401，先 logout/换会话再释放，旧返回被拒绝、不交给业务更新 store；清理已完成请求的订阅。
- [x] **4. 运行红灯：**`pnpm --filter @molio/web exec node --test 'test/access/http.test.ts'`，失败指向上述规则。
- [x] **5. 实现 createDaemonFetch 并迁移清单：**逐项改显式调用；管理 URL 分类集中在 http 模块内部（同源与 pathname `/api/`），导出场景按分类选择包装或原生 fetch；不使用 monkey-patch。解析401/403前使用独立 session 复核，不提前消费原业务 response body。
- [x] **6. 审核所有旁路：**重新 `rg -n 'fetch\(|new EventSource' apps/web/src --glob '*.{ts,tsx}' --glob '!*.test.*'`，按“daemon/外部/静态/第三方资源”记录每个原生例外；具体保留 MdRenderer 的 codeThemeUrl、useResourcePay 的外部支付及外部下载。迁移 URL 读取不把认证取消落入“仍尝试打开”业务 fallback。
- [x] **7. 补真实 UI 断言：**登录后创建临时 vault、读取/编辑并保存测试文档、上传测试附件；检查 JSON、DELETE 和 FormData 请求。云账号未登录时有正确业务提示且管理员工作区仍在；拦截外部请求只检查头，不实际下单/付费；token 不进入外部请求。
- [x] **8. 运行绿灯并提交：**http/controller 测试、Web typecheck、目标 UI 用例及对应业务 spec；提交 `feat(web): authenticate daemon management requests`。所有出错响应仍须有具体用户提示，不能让已有 void 方法悄悄吞掉 401/403。

## Task 4: 绑定四类管理流、资源读取与任务重连

**Files**

- Create: `apps/web/src/api/managed-events.ts`、`apps/web/test/access/managed-events.test.ts`
- Modify: `apps/web/src/api/sse.ts`、`apps/web/src/api/client.ts`（安装/预加载 reader）
- Modify: `apps/web/src/hooks/useKnowledge.ts`、`useChatCore.ts`、`apps/web/src/components/kb/PdfViewer.tsx`
- Modify: `apps/web/src/components/kb/KbChatSessionController.tsx`、`KbChatSession.tsx`、`apps/web/src/components/ChatSessionView.tsx`、`HomePage.tsx`
- Modify: `apps/web/src/access/AccessBoundary.tsx`（同源资源失败捕获）
- Test: `apps/web/e2e/admin-access-ui.spec.ts`；同步已有 SSE/watchdog/chat-queue 与 PDF 相关 spec（实施前按 area-map 和 rg 确认实际文件）

**Interfaces:** managed-events 使用 T1/T2 controller、资源和调度器；`close()` 是终止，内部暂停可恢复。subscribeToRun 返回新句柄并追加 onTransportState，useChatCore 不再依赖原生 `.onmessage/.readyState`。URL 工厂使用最新事件 seq，重连只续接原 run。useChatCore 产出 `transportState: ManagedTransportState`、`retryTransport(): void`；KbChatSessionState 透传这两个字段；ChatSessionViewProps 增加可选 `transportState`、`onRetryTransport?: () => void`，HomePage/KbChatSession 接线。

- [x] **1. 写受控流红灯：**fake EventSource 可逐次发 message/error/close；错误后原生连接立刻 close；复核同会话后按 1/2/4/8 秒重建，第五次暂停；收到消息/keepalive重置次数；知识库和任务均覆盖。复核 pending 时不新建连接，网络故障不伪造匿名。
- [x] **2. 写负面行为红灯：**失效、logout、CSRF变化、close 后不恢复；pending重试被清；任务按 after 最新seq恢复，无新run；server CLOSED、复核暂停和重试耗尽不会 onDone、清 runId 或 drain。local CLOSED/onDone 保持既有语义。
- [x] **3. 写竞争红灯：**静默 OPEN 时只由 watchdog 请求 reconnect；恢复中 watchdog/fallback不再竞争；close与error同时发生只清理一次；重新打开后旧事件被世代拦截。已终止任务空回放后闭流时，只有同epoch的GET run确认 succeeded/failed/canceled 才允许完成，running/pending/404/网络错误保持暂停且不drain；历史校准不重复消息。重连与首次发送互斥，不自动创建新的任务来“恢复”。
- [x] **4. 运行红灯：**`pnpm --filter @molio/web exec node --test 'test/access/managed-events.test.ts'`；同时以 Playwright 验证 useChatCore 队列副作用，不能只断言工厂状态字段。
- [x] **5. 实现 managed-events、任务和知识库接线：**传输层独占 server 普通网络恢复；useChatCore 仅保留静默 OPEN 检测，完成事件观察移到 onEventCb，空回放闭流时按明确run状态校准；暂停展示连接故障与重试动作，保持 runId 和队列。状态与动作经 controller 传给全屏/悬浮会话的 ChatSessionView，两处均可重试。资源终止时回调不能再访问/更新旧工作区。
- [x] **6. 接入 fetch 流和原生资源：**安装/预加载 reader在作用域取消时释放锁/停止回调，不触发额外 cancelRun；图片错误捕获只对同源 `/api/` 请求复核；PDF失败区分登录与文件错误。保留 loadingTask 引用，卸载时即使尚未得到 PDFDocument 也能 destroy；关联断线/退出测试。
- [x] **7. 跑真实知识库流及资源绿灯：**两个有效会话观察同一测试 vault，写文件发事件，退出一个后其流结束而另一个继续；图片/PDF/下载登录可读、匿名拒绝；不以 mock 的 Cookie证明浏览器安全属性。任务重连副作用用受控runtime/SSE证明，并明确它与真实daemon证据的分工。
- [x] **8. 回归并提交：**T4针对性测试与对应既有聊天/PDF用例通过，Web typecheck；提交 `feat(web): bind management streams to admin sessions`。

## Task 5: 完成跨标签页、到期、退出失败和真实网站验收矩阵

**Files**

- Modify: `apps/web/e2e/admin-access-ui.spec.ts`、`apps/web/e2e/fixtures/admin-server.ts`
- Modify: 与实际修复对应的 T1–T4 文件/测试；`apps/web/e2e/bootstrap.spec.ts`、`navigation.spec.ts`、`auth.spec.ts`（有行为/夹具变化时同步）
- Preserve: `apps/web/e2e/admin-access-server.spec.ts` 的一期 API 证据；`apps/web/e2e/area-map.json` 既有映射

**Interfaces:** 使用 T2 真实 HTTPS fixture；每例隔离数据/凭据；两个 page 共享 cookie 用于标签页，独立 browser context 用于独立会话。故障仅在测试代理/请求层注入，无生产后门。

- [x] **1. 写并运行失败/竞态场景：**登录后刷新与直接深链；退出发出后才释放旧session/旧读取；确认退出响应被代理丢弃后检查session；请求未到daemon就断网；同cookie在另一页重新登录后旧logout403不能撤销新会话。断言没有外跳、重复写或成功退出假提示。
- [x] **2. 写跨标签页场景：**同一context两个标签页退出同步；仅收到peer消息但session有效时不能登出；BroadcastChannel被禁用时storage fallback；另一context的有效会话仍可读取。隐藏页恢复可见先复核；CSRF变化后旧队列不续发。
- [x] **3. 写到期场景：**真实 fixture 的 `dataDir/app.sqlite` 只将指定测试 token_digest 的 expires_at 改为过去（摘要在夹具内计算，不打印原token）；触发真实session复核，断言工作区卸载且再访问401。另由T1/T4虚拟时钟断言提醒、到期计时和无事件时关闭，不宣称浏览器实际等了12小时。
- [x] **4. 写浏览器恢复与草稿场景：**生产构建 `/knowledge`、`/settings?tab=runtimes`、`/resources/:id` 刷新加载；后退缓存/pageshow和focus状态；主动退出确认说明草稿代价、取消保留输入；确认失效后旧DOM消失，重新登录不自动发送先前草稿/队列；已保存文件仍存在。
- [x] **5. 写真实操作场景：**登录后建vault、保存与上传；安装/预加载入口真实鉴权而外部安装执行mock；访问资源/云账号页的业务401不驱逐管理员；JSON、FormData及外部头边界逐项检查。覆盖 A01–A12，保留现有业务断言，不用skip/retry把失败变绿。
- [x] **6. 验证与提交：**目标 server UI +一期server浏览器spec连续通过，0失败/取消；核对P0选择确实包含新spec。修复若必要先失败复现再改；提交 `test(web): cover administrator web access lifecycle`，UI修复与测试同commit。

## Task 6: 完整回归、审核材料与可交付演示

**Files**

- Create: `docs/phase2-admin-web-access-review.md`
- Update: 当前计划的执行复选框、最终证据映射与真实限制
- Artifacts: 新建 `.artifacts/phase2-admin-access/<本次运行目录>/`，不覆盖一期日志，不提交测试凭据/真实用户数据

**Interfaces:** 消费 T1–T5 的最终代码与结果；产出 A01–A12 审核映射和一次真实连续全量回归日志。这里是交付任务，不另开功能。

- [x] **1. 最终小范围检查：**contracts fresh build、Web typecheck/test/build；若改 daemon 则跑相应类型/构建/测试；一期访问控制4文件定向测试复核。确认构建和UI测试用的是本次源代码。
- [x] **2. 安排完整E2E端口：**优先默认3100/5173/3201/3199。当前3100/5173由本聊天启动的pnpm dev占用，先告知回归窗口，核对PID归属后仅停止本聊天那组服务；记录启动方式，测试完恢复。遇其他项目服务不终止；替代端口前先检查硬编码localhost:5173，不能只改env造成伪失败。
- [x] **3. 跑完整连续Web E2E：**用下方完整命令及pipefail保存完整日志、HTML、JSON/Trace；报告实际通过/失败/跳过和退出码。有失败定位并补回归后，最终代码再跑一次完整连续E2E；零散复跑不拼接成通过。
- [x] **4. 写审核指南：**管理员配置/生成密码方式引用一期工具；正常浏览器访问、登录、刷新、写入、退出与失效的验收步骤；两套账号区别；会话重载/草稿取舍；恢复本地服务。逐条A01–A12链接测试、日志、截图；清楚列出mock层、跳过原因、未验证平台/生产代理范围。
- [x] **5. 交付检查：**`git diff --check`；只提交任务文件，保留用户修改。用户若另行要求推送，先跑OCR delegate preview/rule并自审将推改动；推向用户backup，创建/更新合适PR并附着，不误推origin/main，不自动合并冲突PR或部署。
- [x] **6. 交付可复核版本：**打开隔离HTTPS server模式演示（测试账号/临时vault，生命周期和清理方式明确）以及最终报告；不将测试后的local:5173当成server权限证明。向用户报告实际结果后等待审核。

## 验证命令与预期

以下路径均从仓库根目录执行；先检查端口，生成每次独立artifact目录，日志捕获使用pipefail。node:test用例优先使用可注入依赖，Web行为必须有Playwright证据。

```bash
pnpm --filter @molio/contracts build:fresh
pnpm --filter @molio/web exec node --test 'test/access/*.test.ts'
pnpm --filter @molio/web typecheck
pnpm --filter @molio/web test
pnpm --filter @molio/web build
pnpm --filter @molio/daemon exec tsx --test test/access/server-boundary.test.ts test/access/server-smoke.test.ts test/access/streams-routes.test.ts test/access/stream-lifetime.test.ts
```

目标浏览器测试（不复用用户当前3100/5173服务）：

```bash
MOLIO_ACCESS_MODE=local MOLIO_E2E_REUSE_SERVERS=0 MOLIO_E2E_DAEMON_PORT=3111 MOLIO_E2E_WEB_PORT=5199 MOLIO_E2E_CLOUD_PORT=3211 MOLIO_E2E_MOCK_OSS_PORT=3198 pnpm --filter @molio/web exec playwright test e2e/admin-access-server.spec.ts e2e/admin-access-ui.spec.ts --trace on
```

外围服务用local；admin用例的实际受测服务由夹具独立以server启动并经HTTPS访问。真实静态构建在worker夹具生成，不能复用旧构建。

完整 Web E2E（默认端口确认空闲后）：

```bash
MOLIO_ACCESS_MODE=local MOLIO_E2E_REUSE_SERVERS=0 MOLIO_E2E_DAEMON_PORT=3100 MOLIO_E2E_WEB_PORT=5173 MOLIO_E2E_CLOUD_PORT=3201 MOLIO_E2E_MOCK_OSS_PORT=3199 pnpm --filter @molio/web test:e2e
```

预期：所有必需检查退出码0；新增管理员用例零跳过；全量既有跳过须逐项解释。当前历史618项不是本期数量基线，新增后的真实计数以最终日志为准。完成后恢复原本的local开发服务，保留报告供审核。

## 设计覆盖与计划自检

| 设计要求 | 实施/验证任务 |
|---|---|
| §1–§3 权限事实、范围与身份隔离 | T1、T2、T3、T5 |
| §4–§5 重载方案、入口/登录/退出/草稿取舍 | T2、T5 |
| §6 状态机、世代与竞态 | T1、T2、T3、T5 |
| §7 显式请求包装、CSRF、业务错误、外部URL | T3、T5 |
| §8 SSE、watchdog、资源、跨页与浏览器生命周期 | T1、T2、T4、T5 |
| §9 文件清单和旁路核查 | T2、T3、T4 |
| §10 A01–A12及完整证据 | T5、T6 |
| §11 用户审核及边界 | 本稿状态说明、T6 |

实施前审核重点：用户是否接受重载时未提交内存内容的取舍；是否仍按本期管理员闭环范围。执行者不得把本稿未勾选的测试步骤写成已完成，也不得以文档审核替代实际测试。

## 最终执行记录（2026-11-04）

- 会话/HTTP/流/reader/runtime 新增行为测试纳入 Web 单元：632/632。
- daemon 改动为知识库可观察心跳及锁定流清理；全量 2036 通过、12 平台/依赖跳过、零失败。
- 最终完整连续 Web：650 项，649 通过、1 专用低大小上限环境跳过、0 失败、0 flaky，38.3 分钟，退出码 0；源码 7b2fdeb。
- 一次独立源码审查发现六项 Important，逐项 RED→GREEN 修复；最终全量额外发现 local 兼容性回归，有专用复现与修复。没有延期 Minor。
- 共享请求/流及夹具采用集成提交；目标配置新增 standalone 模式，生产资产从 worker 内构建改为 globalSetup 新构建。完整服务、浏览器覆盖未缩减。
- 原 checkout local 服务已恢复，隔离 HTTPS 演示/报告已启动且经过实际登录退出/草稿 smoke。自动打开可见标签页因当前无浏览器连接不可执行，交付 URL 和截图供用户打开；没有绕过浏览器证书警告。
- 当前仅保留本地分支供验收，没有推送、合并或生产部署。原 HANDOFF.md 及用户文件保留。

## 独立验收补记（2026-11-06）

- [x] 修复 `admin-access-ui.spec.ts` 旧退出意图竞态断言；单例重复 3 次通过，管理员 HTTPS 定向套件 33/33 通过。
- [x] 按报告建议重跑完整 Web E2E：650 项中 648 通过、1 跳过、1 间歇失败、0 flaky。唯一失败为未改动的 floating-chat 拖拽用例；单独重复 3 次通过。完整结果退出码 1，不能标注为全绿。
- [x] 记录全量期间 3 次 daemon `ReadableStream is already closed` uncaughtException 日志；进程继续响应，需作为独立问题定位。
- [x] 原 checkout 的 local 服务在测试后恢复；health 200，access session 为 `local/authenticated=false`。
- [x] 详细结果与证据见 [独立验收复核补记](2026-11-06-phase2-admin-web-access-acceptance-followup.md)。

所有执行项的证据、具体命令、失败定位与 11 项执行裁决见 [第二期审核指南](phase2-admin-web-access-review.md) 及本机 `.artifacts/phase2-admin-access/`。
