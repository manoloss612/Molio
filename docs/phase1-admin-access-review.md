# 第一期审核指南：管理员访问控制

## 范围

第一期提供 daemon 级的管理员访问边界与认证 API。服务器模式需要经过浏览器会话鉴权；桌面和本机开发使用只监听回环地址的 local 模式。公开 Wiki、图谱及管理员登录页面属于后续阶段，当前服务器模式需要通过 API 登录才能调用管理接口。

原有 `/api/auth/*` 对应 Molio 云账号；本站管理员会话独立于该云账号。单实例、单管理员：使用配置中的用户名与 scrypt 密码哈希；修改配置后重启会使旧会话失效。

## 生成哈希与启动

在仓库根目录先构建 contracts 和 daemon：

```bash
pnpm --filter @molio/contracts build:fresh
pnpm --filter @molio/daemon build
node scripts/create-admin-password.mjs
```

脚本需要交互式终端，隐藏输入并要求再次输入，输出可配置的 scrypt 哈希。保存哈希时应使用服务器的受保护配置，不将其提交到仓库。

local 默认为 `127.0.0.1`：

```bash
MOLIO_ACCESS_MODE=local pnpm dev:daemon
```

服务器配置示例（在受控的环境文件或进程管理器中设置，以下值均为占位符）：

```text
MOLIO_ACCESS_MODE=server
MOLIO_HOST=127.0.0.1
MOLIO_PORT=3100
MOLIO_PUBLIC_URL=https://example.invalid
MOLIO_ADMIN_USERNAME=admin
MOLIO_ADMIN_PASSWORD_HASH=<交互式脚本输出的完整哈希>
```

`MOLIO_PUBLIC_URL` 是 HTTPS 反向代理对外提供的 Origin，不能含业务路径；Node daemon 自身不终止 TLS。代理与 daemon 在同一台机器时可使用示例中的回环地址，容器内按网络拓扑配置监听地址。密码哈希须保留 `$` 字符；若在 shell 中赋值，使用单引号或其他不会展开 `$` 的方式。服务器缺少配置或哈希格式不正确时拒绝启动。

## 审核接口

针对 HTTPS 地址，将下列 `<origin>` 换成配置的完整 Origin：

- `GET <origin>/api/health`：匿名返回 `{"status":"ok"}`。
- `GET <origin>/api/config`：未登录返回 401。
- `POST <origin>/api/access/login`：发送可信 Origin 和 JSON `{username,password}`；成功后浏览器保存 `__Host-molio_admin` Cookie。不要将真实密码放在命令行参数或 shell 历史中。
- `GET <origin>/api/access/session`：返回会话状态和写请求所需的 `csrfToken`。
- 管理写请求：同时发送可信 `Origin`、会话 Cookie 和 `X-Molio-CSRF`；缺少或错误时返回 403。
- `POST <origin>/api/access/logout`：携带上述三项，返回 204 并撤销当前会话。已建立的管理事件流同时结束。

Cookie 为 Secure、HttpOnly、SameSite=Lax；绝对有效期 12 小时，不因请求续期。登录失败限速是单进程内存状态，重启会重置；第一期的设计范围是单 daemon 实例。当前版本尚无管理员登录页，因此服务器模式现有 Web 界面不能直接完成登录和写操作。

可复跑的隔离 API 验证：

```bash
pnpm --filter @molio/daemon exec tsx --test test/access/server-smoke.test.ts
```

该测试使用临时数据目录和临时知识库，直接通过 HTTP 客户端携带 Cookie；它不能单独证明浏览器会保存 Secure Cookie。浏览器验证通过独立的本地 HTTPS 代理执行：

```bash
MOLIO_ACCESS_MODE=local MOLIO_E2E_DAEMON_PORT=3111 MOLIO_E2E_WEB_PORT=5199 MOLIO_E2E_CLOUD_PORT=3211 MOLIO_E2E_MOCK_OSS_PORT=3198 pnpm --filter @molio/web exec playwright test e2e/admin-access-server.spec.ts
```

先确认上述端口空闲；测试需要 Chromium 和 `openssl`。完整回归及其实际结果见下方执行记录。

## 最终验证记录（2026-10-30）

第一期实现及自动化验收完成，当前停在用户审核阶段。所有变更保留为本地 diff；未推送、未部署、未进入第二期。

| 检查 | 实际结果 | 本地日志（`.artifacts/phase1-access/`） |
| --- | --- | --- |
| contracts 构建 | `pnpm --filter @molio/contracts build:fresh`，退出码 0 | 构建输出已检查 |
| daemon 类型检查 | `pnpm --filter @molio/daemon typecheck`，退出码 0；最终 daemon test/build 亦重新编译 | `daemon-typecheck-final.log` |
| daemon 全量测试 | `pnpm --filter @molio/daemon test`，2047 项：2035 通过、12 跳过、0 失败，退出码 0 | `daemon-test-migration-final.log` |
| daemon 构建 | `pnpm --filter @molio/daemon build`，退出码 0 | `daemon-build-final.log` |
| Web 单元测试 | `pnpm --filter @molio/web test`，594 项全部通过，退出码 0 | `web-unit-last.log` |
| Web 类型检查 | `pnpm --filter @molio/web typecheck`，退出码 0 | `web-typecheck-last.log` |
| 桌面测试 | 在 `apps/desktop` 执行 `ELECTRON_SKIP_BINARY_DOWNLOAD=1 node --test 'test/**/*.test.js'`，370 项：363 通过、7 跳过、0 失败，退出码 0 | `desktop-test-skipping-binary.log` |
| 真实服务 smoke | `pnpm --filter @molio/daemon exec tsx --test test/access/server-smoke.test.ts`，通过，退出码 0；最终 daemon 全量测试亦包含此测试 | `server-smoke-serial.log` |
| 完整 Web E2E | 下述命令，618 项：612 通过、6 跳过、0 失败，退出码 0，约 27 分钟 | `web-e2e-acceptance.log` |
| diff 格式检查 | `git diff --check`，退出码 0 | 终端输出为空 |

最终完整 E2E 使用未被占用的默认端口，Playwright 启动独立数据目录及测试服务，不复用用户服务：

```bash
MOLIO_ACCESS_MODE=local MOLIO_E2E_DAEMON_PORT=3100 MOLIO_E2E_WEB_PORT=5173 MOLIO_E2E_CLOUD_PORT=3201 MOLIO_E2E_MOCK_OSS_PORT=3199 pnpm --filter @molio/web test:e2e
```

完整运行包含 `admin-access-server.spec.ts`：独立 server daemon + 临时 HTTPS 代理 + Chromium 验证 Secure、HttpOnly Cookie、登录、管理读取、CSRF 和退出。其余既有流程在 local 模式下回归。没有启用自动重试来隐藏失败。

跳过范围：Web 的 5 项 Claude Code 供应商配置测试因本机没有安装 Claude Code 跳过，1 项大文件上限测试需要专用低上限环境，本轮未启用。daemon 的 12 项包含 10 项 Windows 专用验证和 2 项需要 PyMuPDF 的 PDF 工具验证；桌面的 7 项需要打包产物/平台辅助程序，本期未生成，未算作通过。Electron 二进制下载按本期约定跳过，因此未验证打包桌面应用的实际启动；Windows/macOS 真机和生产反向代理部署也未验证。

## 验收证据索引

| 行为 | 对应测试/实现 |
| --- | --- |
| server 缺少配置拒绝启动；local 限制回环监听 | `test/access/config.test.ts`、`test/access/startup.test.ts`；`src/index.ts` 显式传 hostname |
| 管理 API 匿名 401，登录后可读，写入需可信 Origin + CSRF | `test/access/server-boundary.test.ts` 的管理路径及五类方法矩阵、`guard.test.ts`、`server-smoke.test.ts` |
| 固定 scrypt 参数、隐藏输入工具、请求体上限、失败限速与最多两个并发验证 | `password.test.ts`、`password-tool.test.ts`、`test/routes/access.test.ts` |
| SQLite 仅保存令牌摘要；绝对到期、退出、凭据变化撤销、重启不续期 | `sessions.test.ts`、`db-migration.test.ts`、`server-smoke.test.ts` |
| 任务/知识库/安装/预加载四类 SSE 撤销后关闭 | `streams-routes.test.ts`，真实路由配合受控外部依赖；真实服务 smoke 验证双会话隔离 |
| EOF、断线、AbortSignal、撤销、过期、重复清理无监听或计时器残留 | `stream-lifetime.test.ts` |
| 桌面启动不继承 server 模式配置 | `apps/desktop/test/daemon-env.test.js`，桌面完整测试 |
| 浏览器实际保存安全 Cookie 并执行鉴权 | `apps/web/e2e/admin-access-server.spec.ts`，最终完整 E2E |

表中的 daemon 路径均相对 `apps/daemon`。

## 改动审核入口

- `apps/daemon/src/core/access/`：配置、scrypt、会话迁移/存储、统一门禁、事件流寿命。
- `apps/daemon/src/routes/access.ts`：管理员登录、会话查询、退出、输入边界和限速。
- `apps/daemon/src/server.ts`、`src/index.ts`、`core/db.ts`：启动前校验、门禁挂载、监听地址、数据库迁移。
- `apps/daemon/src/routes/preload.ts`、`agents.ts`：流取消时清理订阅及可测试的安装依赖。
- `apps/desktop/src/daemon-env.js`、`main.js`：桌面启动固定 local + 回环地址。
- `packages/contracts/src/access.ts`：对外会话响应类型。
- `scripts/create-admin-password.mjs`：隐藏终端输入并生成密码哈希。

必需回归期间还修复了三个既有问题，均保留在 diff 供审核：Linux 嵌套目录的大小写文件解析、初始化时旧 URL 状态覆盖图谱导航、相同 Markdown 的迟到二次渲染清空用户选区。相应失败曾复现，增加或保留了回归测试。多个 E2E 用例的固定等待和过短模拟流也改为明确等待状态或由测试释放结束帧；业务断言保留。

此前完整回归曾失败，最终结果不是将单独复跑拼接为通过：针对失败定位修正后，重新执行了一轮完整 E2E，最终为 612 通过、6 跳过、0 失败。中间失败与主动中断记录保留在 `.artifacts/phase1-access/progress.md` 及各轮日志中。

## 验收清单与使用限制

- [x] 配置与监听模式真实接线，非法 server 配置失败关闭。
- [x] 管理 API 默认要求会话；认证流程和最小健康检查精确放行。
- [x] Cookie、密码、请求体、限速、CSRF、Origin 有自动化证据。
- [x] 退出、过期和凭据变更撤销；重启保留原到期时间。
- [x] 四类管理事件流受会话寿命控制，清理和双会话隔离有证据。
- [x] 本机流程及必需完整 Web 回归完成，跳过范围已列明。
- [x] 配置、哈希工具、API smoke 和审核入口已交付。

本期没有发现尚未解决的阻塞问题。独立只读安全审查未发现已确认的严重权限漏洞；审查提出的方法/端点矩阵和流生命周期证据缺口已补齐。

服务器模式仍需 HTTPS 反向代理和单 daemon 部署；登录失败限速在重启后重置。管理员登录页面、现有 Web 请求的管理员会话/CSRF 适配、公开 Wiki 和图谱、内容发布边界及 Docker 安装交互属于后续阶段。因此本期适合作为后续开发基础，不能直接作为最终公开网站上线。
