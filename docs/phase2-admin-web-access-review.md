# 第二期管理员 Web 闭环审核指南

状态：实现与验收进行中，最终结果以本文最后更新的验证表为准。独立分支 `feat/admin-web-access`；原 checkout、一期备份与 HANDOFF.md 保留。未推送、未合并、未部署。

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

| 条目 | 证据 |
| --- | --- |
| A01 模式未决与匿名边界 | controller 非法响应/超时测试；UI anonymous/unreachable 用例记录私有请求为零 |
| A02 表单、错误、429、深链 | UI wrong password/rate limiting/deep link；一期真实 Secure/HttpOnly Cookie 测试 |
| A03 真实管理写入 | UI editor 落盘校验、multipart 上传与头边界、vault JSON/DELETE；http 方法矩阵 |
| A04 业务错误与写入次数 | http 401/403、网络故障与 CSRF 替换测试；云账号 UI；follow-up 不重放用例 |
| A05 恢复、提醒与迟到结果 | controller 虚拟时钟/旧响应测试；UI refresh 和真实 SQLite 指定测试会话过期 |
| A06 退出与不确定响应 | UI cancel/confirmed/lost response/unconfirmed resume/old logout 用例 |
| A07 资源与队列 | managed-events 生命周期测试；UI CLOSED/静默暂停不创建新 run；PDF 加载中退出取消；一期四类 daemon 流测试 |
| A08 标签页与独立会话 | UI shared-cookie tabs、storage fallback 与两个真实 knowledge 订阅 |
| A09 私有资源与外部边界 | UI 图片/PDF 渲染及匿名 raw 401；http 外部地址拒绝、原生调用旁路审计 |
| A10 构建深链与浏览器恢复 | 每次 Playwright globalSetup 新生产构建；UI settings 深链/刷新；runtime pagehide/pageshow/focus 处理及完整导航回归 |
| A11 local 与云账号兼容 | 独立 local HTTPS UI；完整既有 local 流程、auth/market 回归 |
| A12 键盘与窄屏及全量回归 | UI 320px、Enter、Tab/Shift+Tab/Escape；最终完整连续 Web E2E |

### 测试分工与限制

HTTPS fixture 启动真实 daemon/SQLite/临时 vault/生产 Web 构建，自签名 TLS 代理只做本机转发。登录、Cookie、CSRF、文件保存/上传、知识库事件、图片/PDF 使用真实后端。故障响应、静默 runtime 与队列竞态由 Playwright 控制，只证明前端副作用，不声称调用了真实 AI 模型。

到期浏览器测试仅修改该测试的 token 摘要对应的 SQLite 到期时间；五分钟提醒、12 小时绝对寿命的时钟行为由虚拟时钟和一期 daemon 测试证明，没有真实等待十二小时。未验证 Windows/macOS 真机、Electron 打包启动、生产代理或公开内容模型。

原生网络例外：`access/runtime` 仅认证协议；`http` 仅受控网络执行；`managed-events` 仅受控原生连接；`MdRenderer` 的代码主题为静态资源；`useResourcePay` 的外部支付轮询继续原生 fetch，不注入管理员头；导出动态图片先用同源 `/api/` 分类。审计清单见 `native-network-audit.txt`。

## 验证记录

尚未完成最终全量验收，不将中间局部通过当作交付完成。

- 基线 Web 单元 594/594；状态机阶段 607/607；入口阶段 613/613；当前集成单元 618/618（后续新增以最终日志为准）。
- 有效 RED 证据：`t1-red-behavior.log`、`t2-red-behavior.log`、`t3-red.log`、`t4-red.log`、`t5-red-keyboard-idle.log`、`t4-red-pdf-cancel.log`。
- 首批目标 HTTPS 浏览器 14 通过/1 失败：失败为编辑器定位错误，已改用实际 textarea；串行扩展 23 通过/1 失败：最后用例把新 vault 放进已有 vault 内被后端正确拒绝，夹具正在修正为同级目录。
- 构建或内存压力导致的超时单独保留日志，不计作业务 RED 或验收通过。

## 执行中的工程决策

完整决策记录将在交付时固定，包括依赖复用、独立浏览器配置、构建时机和临时停止聊天自有开发服务。不会改动其他应用或用户数据库。测试结束恢复原 checkout 的 `pnpm dev`；该 local 服务不能当作 server 鉴权证据。
