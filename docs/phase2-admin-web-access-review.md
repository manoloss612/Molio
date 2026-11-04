# 第二期管理员 Web 闭环审核指南

状态：本期实现、独立审查修复与最终全量验收已完成，等待用户验收。独立分支 `feat/admin-web-access`；原 checkout、一期备份与 HANDOFF.md 保留。未推送、未合并、未部署。

## 使用与边界

本期提供管理员登录、退出、会话恢复、失效退场和管理请求/事件流适配。公开 Wiki、公开图谱及发布/撤回能力仍属于后续阶段。

生产配置复用[一期指南](phase1-admin-access-review.md)的 HTTPS Origin、用户名及 scrypt 密码哈希工具。server 必须由可信 HTTPS 反向代理提供同源 Web/API。桌面及默认 local 仍直接进入工作区。

- 本站管理员账号控制整台 daemon 的管理权限；“云账号”仍用于云端服务和资源市场，两者独立。
- 登录后保留原路径、query、hash；刷新时先确认 session，确认前不挂载业务 App。
- 主动退出先说明未保存文本可能丢失，允许取消。退出响应不确定时隐藏工作区，提供重试或复核后返回应用，不能宣称已经退出。
- 会话到期前五分钟提醒。确认到期、撤销、退出或 Cookie 会话替换后原地址整页重载，清除内存缓存。已保存文件保留；未保存内存草稿可能丢失；不会自动重发旧消息或写入。
- 业务 401/403 先独立复核管理员 session。云账号失败不会自动退出本站；新 CSRF 不会被旧操作采用。
- server 事件流按 1/2/4/8 秒最多自动恢复四次，之后显示重试。断流和静默超时保持 run 和队列，不能推断任务完成。local 保留原先语义。

## 可重复的人工验收

使用隔离 HTTPS 演示地址及测试管理员账号（交付消息提供，不提交凭据）：

1. 匿名打开 `/knowledge` 或 `/settings?tab=runtimes`，看到管理员登录；开发者工具中管理 API 返回 401。
2. 错误密码得到页面内提示，密码清空，用户名保留；正确登录返回原地址。刷新仍恢复登录。
3. 在临时知识库编辑并保存文档，导入附件，再刷新检查文件。图片和 PDF 可预览。
4. 打开第二个同浏览器标签页。退出先取消，检查内容仍在；再次确认退出，两页均回到登录页。
5. 使用另一个独立浏览器上下文登录：前一个会话退出后，独立会话仍有效。
6. 重新登录后没有自动重发先前排队消息；保存过的文件仍在。云账号登录/退出不等于本站管理员登录/退出。

演示仅监听本机回环，使用临时数据与自签名测试证书；不是生产部署或真机发布验证。真实生产证书与反向代理需独立验收。

## 验收证据映射

证据根目录：`.artifacts/phase2-admin-access/`（被 Git 忽略，本机可读取）。

测试源码：[HTTPS UI](../apps/web/e2e/admin-access-ui.spec.ts)、[一期 Cookie/CSRF](../apps/web/e2e/admin-access-server.spec.ts)、[controller](../apps/web/test/access/session-controller.test.ts)、[HTTP](../apps/web/test/access/http.test.ts)、[managed events](../apps/web/test/access/managed-events.test.ts)、[terminal replay](../apps/web/test/access/run-events.test.ts)、[reader](../apps/web/test/access/read-stream.test.ts)、[runtime](../apps/web/test/access/runtime.test.ts)、[daemon 四类流及心跳](../apps/daemon/test/access/streams-routes.test.ts)。

| 条目 | 证据 |
| --- | --- |
| A01 模式未决与匿名边界 | controller 非法响应/超时测试；UI anonymous/unreachable 用例记录私有请求为零 |
| A02 表单、错误、429、深链 | UI wrong password/rate limiting/deep link；一期真实 Secure/HttpOnly Cookie 测试 |
| A03 真实管理写入 | UI editor 落盘校验、multipart 上传与头边界、vault JSON/DELETE；http 方法矩阵 |
| A04 业务错误与写入次数 | http 401/403、网络故障与 CSRF 替换测试；云账号 UI；follow-up 不重放用例 |
| A05 恢复、提醒与迟到结果 | controller 虚拟时钟/旧响应测试；UI refresh 和真实 SQLite 指定测试会话过期 |
| A06 退出与不确定响应 | UI cancel/confirmed/lost response/unconfirmed resume/old logout 用例 |
| A07 资源与队列 | 双流重试/peer 竞态、延迟订阅初始化、reader 等待/缓冲取消；UI CLOSED/静默暂停/轮次间禁发、完整尾部回放及确认后队列；PDF 取消；四类 daemon 流测试 |
| A08 标签页与独立会话 | UI shared-cookie tabs、storage fallback 与两个真实 knowledge 订阅 |
| A09 私有资源与外部边界 | UI 图片/PDF 渲染及匿名 raw 401；http 外部地址拒绝、原生调用旁路审计 |
| A10 构建深链与浏览器恢复 | 每次 Playwright globalSetup 新生产构建；UI settings/resources 深链/刷新及 persisted pageshow；runtime 重复 start/stop/start 测试及完整导航回归 |
| A11 local 与云账号兼容 | 独立 local HTTPS UI；完整既有 local 流程、auth/market 回归 |
| A12 键盘与窄屏及全量回归 | UI 320px、Enter、Tab/Shift+Tab/Escape；最终完整连续 Web E2E |

### 测试分工与限制

HTTPS fixture 启动真实 daemon/SQLite/临时 vault/生产 Web 构建，自签名 TLS 代理只做本机转发。登录、Cookie、CSRF、文件保存/上传、知识库事件、图片/PDF 使用真实后端。故障响应、静默 runtime 与队列竞态由 Playwright 控制，只证明前端副作用，不声称调用了真实 AI 模型。

到期浏览器测试仅修改该测试的 token 摘要对应的 SQLite 到期时间；五分钟提醒、12 小时绝对寿命的时钟行为由虚拟时钟和一期 daemon 测试证明，没有真实等待十二小时。未验证 Windows/macOS 真机、Electron 打包启动、生产代理或公开内容模型。

原生网络例外：`access/runtime` 仅认证协议；`http` 仅受控网络执行；`managed-events` 仅受控原生连接；`MdRenderer` 的代码主题为静态资源；`useResourcePay` 的外部支付轮询继续原生 fetch，不注入管理员头；导出动态图片先用同源 `/api/` 分类。审计清单见 `native-network-audit.txt`。

## 验证记录

最终完整连续 Web E2E 已完成，以下为本轮实际结果；退出码均为 0。产品源码固定为 `7b2fdeb`，后续提交只更新审核材料。

| 检查 | 已读取的实际结果 | 日志 |
| --- | --- | --- |
| contracts fresh build | 退出 0 | contracts-after-review.log |
| Web 全部单元 | 632 通过、0 失败/取消/跳过 | web-unit-final-code.log |
| Web 类型检查 | 退出 0 | web-types-final-code.log |
| daemon 类型/构建 | 退出 0 | daemon-types-after-review.log / daemon-build-after-review.log |
| 管理流定向 | 2/2，包括 initial/interval ping 及取消时 listener/interval 恰好释放一次 | review-green-heartbeat-final.log |
| 目标 HTTPS 浏览器 | 定向 30/30；最终全量包含一期 API 1 项及新增 UI 32 项，全部通过 | review-green-ui-final.log / full-20261104-r3/results.json |
| daemon 全量 | 2048 项：2036 通过、12 跳过、0 失败/取消 | daemon-unit-package-cwd.log |
| Web 最终构建 | 退出 0 | web-build-final-code.log |
| Web 全量 E2E | 650 项：649 通过、1 跳过、0 失败/重试通过；38.3 分钟 | full-20261104-r3/run.log / results.json / exit-code |

有效 RED 证据包括 t1/t2/t3/t4 red、review-red-state-retry、review-red-terminal-replay、review-red-deferred、review-red-ui、review-red-readers、review-red-heartbeat、review-red-terminal-queue、review-red-replay-cancel、review-red-peer-budget。原始日志均保留在证据目录。

第一轮全量 Web 因独立审查确认问题主动中断，退出 130（47 通过、1 中断、其余未完成），不计为验收。第二轮发现 local 禁发规则误用，74 通过、4 失败后中断；新增 local 专用用例复现并修复，两个新增用例 2/2、四组聊天定向 12/12 通过。多轮 SSE 夹具改为新一轮递增序号、相同轮次重放保持序号，保留生产去重。最终以 `full-20261104-r3` 完整结果为准。第一轮全量 daemon 因从根目录启动而非包目录启动，出现夹具 ENOENT/tsx 缺包并中断，已按包目录重跑，不对产品作规避性修改。此前内存压力和编辑器/嵌套 vault 夹具错误同样保留原日志。

## 独立审查与修复

独立 reviewer 只读审核 `85e32b2..f2f099f`，未运行测试、未修改文件；无 Critical，确认六项 Important。按一次修复流程逐项复现后修复，没有委派第二轮审核：

1. **终态查询抢先结束回放**：先用同 epoch 的有限事件回放恢复 after 序号之后的文本，完整 EOF 后才完成；回放关闭即取消读取。补单元与真实浏览器尾部恢复/队列用例。
2. **多流互相重置预算**：普通 session 复核及 peer 替代旧探测不重置次数；只有真实不可达恢复、收到数据或明确手动重试才重置。双流和 peer 竞态测试证明上限。
3. **轮次之间仍可向暂停连接发送**：实际入口检查 transport，保留草稿并显示恢复动作；确认任务终止后恢复合法队列消费。
4. **采用触发前的 session 响应**：peer/到期可替代旧探测；登录 POST 成功后另发新探测，取消旧信号。迟到响应不改变新状态。
5. **异步初始化丢失句柄**：不可用时登记恢复监听，手动重试可初始化，close 后不再创建连接。
6. **知识库耗尽后无恢复入口**：增加状态与重试；daemon 改为浏览器可观察的初始/15 秒 `data: ping`，并修复 pipe 锁定时的清理。

额外覆盖了安装/预加载 reader 取消与无迟到回调、runtime 重复启动与 persisted page 恢复。当前未延期 Minor。全量回归额外发现的 local 兼容性问题已有专用 RED→GREEN 用例，server 的禁发规则保留。新纯模块 `api/run-events.ts` 负责可测的回放状态，`api/read-stream.ts` 负责取消 reader；没有新增运行时依赖。

## 工程决策与代价

按作出顺序保留完整执行裁决：

| 决策 | 原因与代价 |
| --- | --- |
| 关闭 pnpm 隐式安装、复用已装依赖并独立 task-state | 避免自动安装/根 symlink 被拒；代价是依赖基线不一致风险，已用基线与最终检查验证 |
| 新增独立管理员 Playwright 配置 | 目标测试无需四个外部服务；代价是目标结果不能代替完整回归 |
| 暂停聊天自有 local dev 进程 | 先确认 activeRuns=0，释放内存；代价是回归窗口内 5173 不可用，结束须恢复 |
| 合并请求/流共享集成提交 | client 与 HTTPS 夹具共享，分别保留 RED/GREEN；代价是单个 diff 较大 |
| 在 globalSetup 新构建生产资产 | 避免 worker 内构建与浏览器争用内存；代价是每次运行的构建时间，不复用旧 dist |
| 独立源码审查先于最终长回归 | 让审查修复进入最终连续运行；代价是最终文档/计数须另行核对 |
| daemon 增加可观察心跳并修复锁定 producer 清理 | comment heartbeat 不触发浏览器 onmessage；代价是增量流消息和额外 daemon 全量验证 |
| 公开 Wiki/图谱、多管理员、会话列表留在后续 | 本期完成已批准的单管理员边界；代价是匿名公开浏览尚不可用 |
| 生产代理/平台真机未作本机浏览器结论 | 区分实际证据；代价是真机/部署仍需后续验证 |
| daemon fetch 拒绝重定向 | 防止未来外跳转发 CSRF；代价是新增跳转接口须明确适配 |
| 最终计数只认新源码完整连续运行 | 不拼接局部结果；代价是等待整轮验收 |

核心环境调整是复用已安装依赖、使用独立状态目录并关闭 pnpm 隐式安装；每次浏览器运行在 globalSetup 新构建；开发服务暂停期间只操作本聊天 PID，最终恢复原 checkout 的 local 服务。任务 3/4/5 的共享集成统一提交，独立 RED/GREEN 记录仍分别保留。

原生 daemon fetch 拒绝重定向，防止未来同源 API 通过外跳转发 CSRF；未来若新增重定向接口须明确适配。公开发布模型仍在后续，生产代理与平台真机仍需专门验证。完整新测试结果已核对 JSON、日志与退出码；没有把中断或局部运行拼接成完整通过。

### 本机复现命令

```bash
export pnpm_config_verify_deps_before_run=false ELECTRON_SKIP_BINARY_DOWNLOAD=1
pnpm --filter @molio/contracts build:fresh
pnpm --filter @molio/web typecheck
pnpm --filter @molio/web test
pnpm --filter @molio/daemon typecheck
pnpm --filter @molio/daemon build
pnpm --filter @molio/daemon exec node --test --test-concurrency=2 --test-timeout=30000 'dist/test/**/*.test.js'
pnpm --filter @molio/web build
MOLIO_ACCESS_MODE=local MOLIO_E2E_REUSE_SERVERS=0 MOLIO_E2E_DAEMON_PORT=3100 MOLIO_E2E_WEB_PORT=5173 MOLIO_E2E_CLOUD_PORT=3201 MOLIO_E2E_MOCK_OSS_PORT=3199 pnpm --filter @molio/web test:e2e
```

本次 shell 重启后 pnpm 未进入 PATH，使用机器已有的 Codex runtime fallback 路径；没有安装或升级工具链。daemon 测试必须通过 filter/正确包目录执行，不能只把 compiled 文件路径从根目录传给 Node。完整 E2E 的 HTML/JSON/Trace 输出位于 `full-20261104-r3/`，实际源码提交记录在该目录 `source-head`。

## 跳过与边界

- Web 唯一跳过：`kb-large-file-too-large.spec.ts` 的强制载入卡片，需要独立 `MOLIO_E2E_LOW_CAP=1` 与 daemon `MOLIO_MAX_VIEW_SIZE=1048576` 环境；本轮其余 649 项正常通过，新增管理员用例零跳过。
- daemon：10 项 Windows 专用与 2 项 PyMuPDF 不可用，合计 12 跳过；2036 项通过。
- 未验证实际生产反向代理/证书、Windows/macOS 真机和 Electron 打包应用；公开 Wiki/图谱仍属后续阶段。

## 本机演示及恢复

- 第二期隔离演示：[HTTPS 登录页](https://localhost:46735/knowledge)，仅监听回环、临时 vault/SQLite、12 小时一期会话协议、自签名测试证书。测试账号在交付消息给出，凭据未提交；本机 `demo-session.json` 权限 0600。
- [完整 HTML 报告](http://127.0.0.1:9331/)；报告服务仅监听 127.0.0.1。完整 JSON/日志在 `full-20261104-r3/`。
- 原 checkout 的 [local 开发服务](http://localhost:5173/) 已恢复，daemon `/api/access/session` 实际返回 `local/authenticated=false`，HTTP 页面及健康检查为 200。它仍是原一期 checkout，不代表第二期 server 证明。
- 实际演示 smoke：登录、私有工作区、取消退出保留内存草稿、确认退出后草稿丢弃、保存文件保留、退出后管理 API 401；证据 `demo-smoke.json` / `demo-smoke.log`、`demo-login.png`、`demo-workspace.png`，截图已目视检查。
- 正常向 `demo-session.json` 的当前 demo PID 发 SIGTERM 会停止其 daemon/proxy 并删除它自己创建的临时目录；不会删除用户原知识库。开发服务及报告是独立进程。
- 当前会话 CUA 返回 `iab` 不可用且浏览器列表为空，无法自动打开可见标签页；服务与截图均已验证，请通过链接打开。浏览器自签名证书警告须由用户自行处理，没有修改系统信任设置。

原目录的 HANDOFF.md、计划草稿及用户修改保持原样；本期代码保留在 `/home/ss/.codex/worktrees/phase2-admin-web/molio` 的 `feat/admin-web-access`。未推送、未合并、未部署到生产。
