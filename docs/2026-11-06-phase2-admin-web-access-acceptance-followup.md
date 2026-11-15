# 第二期管理员 Web 闭环——独立验收复核补记

日期：2026-11-06
依据：[独立验收报告](2026-11-04-phase2-admin-web-access-acceptance.md)
验证分支：`feat/admin-web-access`；本次源码包含对退出竞态用例的修正。

## 结论

报告定位的管理员 E2E 竞态已修正。竞态用例单独重复 3 次通过，管理员 HTTPS 定向套件 33/33 通过。本次完整 Web E2E 仍有一个与管理员改动无关的浮动聊天拖拽用例失败；该用例单独重复 3 次通过，因此不能将本次完整运行记为全绿。另记录到 daemon 的 `ReadableStream is already closed` 未捕获异常日志，虽未使后续测试中止，仍需单独定位。

## 本次修改

用例先登录并打开退出确认框，再由同一浏览器上下文直接建立新 Cookie 会话。测试同时观察退出请求和主页面导航：旧 CSRF 的退出请求若先到，必须为 403；若另一个旧 CSRF 写请求先让应用发现会话变化并重载，则确认框随旧页面消失。两条路径最后都验证新会话仍认证有效。

这样验证的是安全属性“旧退出意图不会撤销新会话”，同时承认应用自身业务请求也可能先观察到会话替换。用例不再假设旧确认框必定存活到点击时刻。

## 验证结果

| 验证 | 实际结果 | 日志/产物 |
|---|---:|---|
| 竞态用例重复 3 次 | 3 通过，0 失败，37.4 秒 | Playwright 命令见下 |
| 管理员 HTTPS 定向套件 | 33 通过，0 失败，2.7 分钟 | Playwright 命令见下 |
| 完整 Web E2E | 650 项：648 通过、1 跳过、1 失败、0 flaky；42.46 分钟，退出码 1 | `.artifacts/phase2-admin-access/full-20261105-after-audit/run.log`、`test-results/`、`exit-code` |
| 完整套件中管理员 UI | 32 项全部通过 | 同上 `run.log` |
| 全量唯一失败项的单独重复 | 3 通过，0 失败，46.3 秒 | 本机 Playwright 输出 |

全量失败为 `apps/web/e2e/floating-chat.spec.ts` 的“拖近右缘实时磁吸”用例：拖动释放后未找到 `floating-chat-btn` 元素，期待其处于隐藏态。该测试和产品功能都未在本次管理员变更中修改。独立重复三次通过说明失败具有间歇性，但不足以证明全量运行已稳定，因此保留全量退出码 1。

完整日志还出现 3 次 daemon `ERR_INVALID_STATE: ReadableStream is already closed` 的 uncaughtException 记录。守护进程继续响应请求，650 项仍全部完成；这不等于异常已解决，需另行检查产生关闭竞态的流端点。

### 定向测试命令

```bash
export pnpm_config_verify_deps_before_run=false ELECTRON_SKIP_BINARY_DOWNLOAD=1
pnpm --filter @molio/web exec playwright test -c playwright.admin.config.ts e2e/admin-access-ui.spec.ts --grep 'old logout intent' --repeat-each=3
pnpm --filter @molio/web exec playwright test -c playwright.admin.config.ts e2e/admin-access-server.spec.ts e2e/admin-access-ui.spec.ts
```

### 完整 E2E 命令

完整运行使用 3100/5173/3201/3199；执行前确认端口空闲，日志及浏览器产物写到独立的 ignored artifact 目录。原有 local 开发服务随后已用 `pnpm dev` 恢复，健康检查返回 200，`/api/access/session` 返回 `local/authenticated=false`。

## 验收边界

本次报告针对的管理员竞态已复跑稳定，管理员定向门禁全绿。完整 Web 回归出现上述一个无关间歇失败和 daemon 流异常记录，因此不能把完整回归标为“全部通过”。未修改浮动聊天或 daemon 流代码，避免在缺少可复现证据时扩大改动范围。

## GitHub 备份状态

2026-11-06 已推送分支 `feat/admin-web-access` 到用户 fork，并创建以 `codex/phase1-admin-access-backup` 为 base 的 [Draft PR #2](https://github.com/manoloss612/Molio/pull/2)。PR 为 OPEN/Draft，GitHub 当时显示 `MERGEABLE`，没有 CI 检查记录；该状态只说明 GitHub 未报告分支冲突，不代表完整测试全绿。没有合并或生产部署。

## 2026-11-11 后续问题修复与复验

本节更新并取代上面的“完整 Web E2E 仍有一个失败”和“daemon 流异常需另行定位”状态。原报告是 2026-11-06 当时的验收快照。

### 修复

- `FloatingChatButton` 记录按钮本身的 pointerdown。关闭面板后刚重新挂载的按钮会忽略没有对应 pointerdown 的鼠标 click，避免旧关闭点击在 DOM 更新后误开面板。新增 E2E 覆盖关闭后的状态保持，并重复验证拖到右缘吸附隐藏场景。
- 知识库 raw-file 的完整响应和 Range 响应改用 `Readable.toWeb()` 转成 WHATWG stream，再交给 `Response`。此前 Node Readable 被 Undici 按异步迭代器适配，客户端取消与文件 EOF 同时发生时可能重复关闭 stream controller。
- admin-access 的终态重放 E2E 在安排排队消息和断线前显式等待首段 `Head ` 已显示。此前它只等待 composer 可用，而 composer 在首个 SSE 事件到达前即可使用；全量运行会偶发先断线，导致断言的前置文本并未建立。

### 验证

| 验证 | 结果 |
|---|---:|
| 悬浮按钮拖拽吸附 + 关闭点击回归，重复 20 次 | 40/40 通过 |
| admin-access 终态重放用例，重复 20 次 | 20/20 通过 |
| daemon `knowledge.test.ts` | 32 通过，0 失败 |
| daemon 全量单测 | 2,037 通过、12 跳过、0 失败 |
| Web 全量 E2E | 650 通过、1 跳过、0 失败，33.3 分钟，退出码 0 |
| workspace 全量 typecheck | 通过 |
| `git diff --check` | 通过 |
| 完整 E2E 中 daemon `FATAL` / `ERR_INVALID_STATE` | 0 次 |

完整 E2E 日志：`.artifacts/phase2-admin-access/full-20261110-final/run.log`，退出码记录在同目录 `exit-code`。日志无失败行、无 `FATAL`/`ERR_INVALID_STATE`；唯一跳过项由测试套件标记为 skipped。

全量运行期间发现的单个 admin-access 用例失败是测试建立时序不完整，不是重放实现失败：断线触发时首段 SSE 事件可能还没进入 UI。补充显式前置断言后，20 次定向重复和完整套件均通过。

本节记录修复和验证证据；提交与推送状态以 Draft PR #2 的最新 head 为准。
