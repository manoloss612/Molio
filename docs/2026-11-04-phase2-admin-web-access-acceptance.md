#第二期管理员 Web闭环 ——独立验收结论

验收日期：2026-11-04
验收对象：`/home/ss/.codex/worktrees/phase2-admin-web/molio`（分支 `feat/admin-web-access`），HEAD `b24258a`，产品源码 `7b2fdeb`
对照材料：`docs/phase2-admin-web-access-review.md`（验收指南）、`docs/2026-11-04-phase2-admin-web-access-design.md`、`docs/2026-11-04-phase2-admin-web-access-plan.md`
本次验收产出日志：`.artifacts/claude-acceptance-20261104/`（worktree内，已被 Git忽略）

---

##一、结论

**有保留通过，不建议按指南原文的「全部通过」直接验收。**

-七项非浏览器门禁由我独立复跑，数字与指南逐项一致，退出码全部为0。
- Codex证据包 `full-20261104-r3/`经交叉核对（退出码、`source-head`、递归解析 `results.json`）自洽有效。
- **但指南中「目标 HTTPS定向30/30全部通过」在我独立复跑中不成立**：同一批33项浏览器测试得到 **32通过 /1失败，EXIT=1**。失败用例可复现机制、间歇触发（单独重复3次 →2通过1失败）。
-定性：**测试用例自身的竞态假设不成立**，不是产品功能缺陷，但会让 CI（`retries:0`）存在失败概率，因此指南的全量绿只能视为**单次历史样本**。
-650项完整 Web E2E **本次未复跑**（端口3100/5173被本聊天之外启动的 dev服务占用，未获授权停止）。

---

##二、我独立复跑并通过的门禁

命令与指南「本机复现命令」一致；下表为**实跑结果**，非引用指南文字。

|检查 |实跑结果 |与指南是否一致 |
| --- | --- | --- |
| contracts `build:fresh` | EXIT=0 |一致 |
| web `typecheck` | EXIT=0 |一致 |
| web单元测试 | tests632 / pass632 / fail0 / cancelled0 / skipped0，9.2 s，EXIT=0 |一致 |
| daemon `typecheck` | EXIT=0 |一致 |
| daemon `build` | EXIT=0 |一致 |
| daemon全量（包目录内执行） | tests2048 / suites486 / pass2036 / fail0 / cancelled0 / **skipped12**，165.7 s，EXIT=0 |一致 |
| web `build` | EXIT=0 |一致 |

日志：`contracts-build.log`、`web-typecheck.log`、`web-unit.log`、`daemon-typecheck.log`、`daemon-build.log`、`daemon-unit.log`、`web-build.log`。

### daemon的12项跳过（我按用例名逐条核对）

-10项 Windows专用：`~/.molio/venv/Scripts`布局、Windows Python `Scripts`目录、Windows匿名相关、Hermes PortableGit ×2、GBK解码 ×2、win32 `taskkill`进程树 ×2、`cmd.exe`包装（`# SKIP`）。
-2项 `PyMuPDF unavailable`：页面渲染、字体修复。

与指南「10项 Windows专用 +2项 PyMuPDF」完全吻合。

###代码状态核对

- `git diff7b2fdeb..b24258a`仅文档改动，与指南「产品源码固定为 `7b2fdeb`」一致。
- `git status --porcelain`为空，`git diff --check`干净。

---

##三、证据包交叉核对

未采信文字描述，直接校验 `full-20261104-r3/`原始件：

- `exit-code` =0；`source-head` = `7b2fdeb`。
-递归解析 `results.json`（统计需遍历嵌套 `suites`，非顶层汇总）→ **649 passed /1 skipped /0 failed /0 flaky**，跳过项为 `kb-large-file-too-large.spec.ts`，与指南650项口径一致。
- `review-green-ui-final.log`实际内容为 `30 passed (2.4m)`。

实时端点亦逐一验证：

|地址 |实际返回 |
| --- | --- |
| `https://localhost:46735/api/access/session` | `{"mode":"server","authenticated":false}`（demo，回环 +自签证书） |
| `http://127.0.0.1:9331/` |200（HTML报告，仅监听回环） |
| `http://localhost:5173/api/access/session` | `{"mode":"local","authenticated":false}`（已恢复的原 checkout dev服务） |
| `http://localhost:3100/api/health` |200 |

---

##四、不通过项：`admin-access-ui.spec.ts:102`

用例：**「an old logout intent cannot revoke a newer cookie session」**

###4.1实跑结果

|运行方式 |结果 |
| --- | --- |
|定向全量（`admin-access-server.spec.ts` + `admin-access-ui.spec.ts`，33项） | **32 ✓ /1 ✘ /0 skip，5.2 min，EXIT=1**；失败耗时30.3 s（`timeout =30_000`） |
|隔离重复（`--grep "old logout intent" --repeat-each=3`） |2通过（7.2 s、7.1 s）/1失败（repeat2），EXIT=1 |

日志：`targeted-admin-e2e.log`、`repro-old-logout.log2`。

两次失败签名完全一致：`page.waitForResponse('/api/access/logout')`超时，且 `locator('[data-testid="admin-logout-confirm"]').click()`因元素消失而超时。

###4.2失败机制的逐请求还原（来自 trace，非推测）

```
14:56:37.734 POST /api/access/login200 ←用例在页内直接 fetch重新登录，签发新 token、替换 Cookie
14:56:37.916 PUT /api/config200 ←已在途的旧请求（旧 Cookie +旧 CSRF），仍匹配
14:56:38.195 PUT /api/config403 ←新 Cookie +旧 CSRF，被 guard拒绝
14:56:38.218 GET /api/access/session200 ←403触发复核，拿到新的 csrfToken
14:56:38.251 GET /settings200 ←整页重载开始（随后拉取全部 assets）
 ……之后30 s内没有任何 POST /api/access/logout ……
```

对应代码链条：

1.页内原始登录替换了 Cookie，但页面内存中仍是旧 CSRF。
2.应用自身还有在途/新发的写请求（`App.tsx`启动时 `api.updateConfig`、路由变化时 `configStore.refresh`），带旧 CSRF → `apps/daemon/src/core/access/guard.ts:35-40`返回403。
3. `apps/web/src/api/http.ts:28`对401/403调用 `controller.revalidate('http-error')`。
4.复核拿到新 `csrfToken`，`apps/web/src/access/session-controller.ts:104`判定 `session-changed` → `finish()`（同文件 `:80`）。
5. `apps/web/src/access/runtime.ts:16`执行 `window.location.replace(...)` **整页重载** ——这正是设计文档明写的「Cookie会话替换后原地址整页重载」。
6.确认对话框随 DOM销毁，`admin-logout-confirm`永远等不到；`waitForResponse('/api/access/logout')`超时。

间歇性的来源：**只有**当原始登录之后应用还发出一次带旧 CSRF的写请求时，才会触发上述重载链。没有这样的写请求时，旧 CSRF得以保留，点击确认后 logout真正发出并被403拒绝，用例通过。这是时序竞态，不是环境问题。

###4.3定性

- **不是产品缺陷**：从用户可观察行为看，「旧退出意图不能撤销更新的会话」这一安全属性在两条路径上都成立 ——要么 logout被403拒绝，要么页面重载后以新会话处于已认证态。
- **是用例的设计缺陷**：注释「No peer notification is sent by this raw login: the old page still holds the old CSRF」只考虑了跨标签页通知，没考虑页面自身的业务流量也会观察到会话替换。而「观察到替换就整页重载」正是本期设计要求。
- **影响**：CI配置为 `retries:0`，该用例在 CI上有失败概率；因此指南的「定向30/30、全量全绿」不能当作稳定保证。

###4.4附带观察（不构成阻塞）

`apps/daemon/src/routes/access.ts:69`的 `POST /logout`路由自身不做 Origin/CSRF校验（有 Cookie就撤销并返回204）；用例期望的403实际来自全局 `createAccessGuard`（`guard.ts:35-40`）。这不是漏洞（guard在路由之前拦截），但读代码时容易误解，建议在路由处加一行注释说明。

###4.5修复建议

把断言改为容忍两种合法结果，并显式等待在途写请求落定后再点击确认：

-结果 A：`POST /api/access/logout`返回403，页面仍在 `.entry-shell`，且 `GET /api/access/session` → `authenticated: true`；
-结果 B：页面已因 `session-changed`整页重载，重载后 `authenticated: true`，旧退出意图同样未生效。

再按既定规则补一条 error-driven回归用例（先复现失败再修）后，重复跑 ≥3次确认稳定。

---

##五、本次未验证的范围

1. **650项完整 Web E2E未复跑**：需占用默认端口3100/5173，当前被本聊天之外启动的 dev服务占用；按约定不停止非本聊天启动的进程。第三节引用的是 Codex的证据包，不是我的复跑结果。
2.生产反向代理 /真实 TLS证书（demo为回环 +自签）。
3. Windows / macOS真机、Electron打包启动。
4.真实12小时会话到期（仅虚拟时钟 +修改 SQLite到期时间证明）。
5.真实 AI模型调用（故障响应、静默 runtime由夹具控制，只证明前端副作用）。
6.指南标注的跳过项本身：Web1项（需 `MOLIO_E2E_LOW_CAP=1`与 `MOLIO_MAX_VIEW_SIZE=1048576`）、daemon12项。
7.公开 Wiki /公开图谱（指南已声明属后续阶段）。

---

##六、验收建议

1.修复 `apps/web/e2e/admin-access-ui.spec.ts:102`的竞态断言（见4.5），重复跑定向33项确认稳定。
2.重新执行一次650项完整 Web E2E（需释放3100/5173），以其结果替换指南中的历史样本。
3.指南「验证记录」表应把该用例标注为「间歇失败、已定位、修复后复跑」，不应继续表述为「全部通过」。
4.全部通过后再走 PR + Review；本期代码目前未推送、未合并、未部署。

---

##附：验收所用命令

```bash
export pnpm_config_verify_deps_before_run=false ELECTRON_SKIP_BINARY_DOWNLOAD=1
pnpm --filter @molio/contracts build:fresh
pnpm --filter @molio/web typecheck
pnpm --filter @molio/web test
pnpm --filter @molio/daemon typecheck
pnpm --filter @molio/daemon build
pnpm --filter @molio/daemon exec node --test --test-concurrency=2 --test-timeout=30000 'dist/test/**/*.test.js'
pnpm --filter @molio/web build
MOLIO_ACCESS_MODE=local MOLIO_E2E_REUSE_SERVERS=0 MOLIO_E2E_DAEMON_PORT=3100 MOLIO_E2E_WEB_PORT=5173 \
 MOLIO_E2E_CLOUD_PORT=3201 MOLIO_E2E_MOCK_OSS_PORT=3199 pnpm --filter @molio/web test:e2e

#定向浏览器用例（本项失败即出自此处）
cd apps/web && pnpm exec playwright test e2e/admin-access-server.spec.ts e2e/admin-access-ui.spec.ts --trace on

#单用例复现
cd apps/web && pnpm exec playwright test -c playwright.admin.config.ts \
 e2e/admin-access-ui.spec.ts --grep "old logout intent" --repeat-each=3
```

>注：daemon测试必须在包目录内通过 filter执行，不能只把编译产物路径从仓库根目录传给 Node。
