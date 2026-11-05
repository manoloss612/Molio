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
