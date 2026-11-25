# 上游更新兼容合并计划

> 执行方式：superpowers:executing-plans。用户已批准备份、新分支合并、验证、PR 合入、部署的完整流程。

## 目标与约束

将 `zhuzhaoyun/Molio@ab091bb1` 的更新整合到个人仓库，同时保留管理员访问边界、逐篇/批量发布撤回、公开 Wiki 与交互图谱，以及 PR #13 的部署配置。当前运行实例保持至验证和 PR 合入完成。不得直接 push main；不得上传 OSS/ACR。原主工作区及未跟踪文档保持原状。

## 执行步骤

- [x] 备份代码所有 refs、当前运行数据库（SQLite 在线备份）、知识库及部署配置，记录回退方法。
- [x] 基于 `124b3fd8`（个人 main + PR #13）建立 `chore/sync-upstream-20261125`，运行 daemon 基线。
- [x] 合并上游提交；逐个处理冲突，同时保留双方行为。优先保护匿名边界、外部素材根权限、图谱与桌面导航。
- [ ] 对冲突产生的实际缺陷补回归；运行构建、类型检查、daemon/web 单测及全量 Web E2E。
- [ ] 最终独立审查与 OCR 自审，创建个人仓库 main PR；说明其同时包含 PR #13，合入后关闭被替代 PR。
- [ ] 门禁满足后通过 PR 合入，打包并部署新 main，沿用当前 admin 凭据，验证公开快照、匿名管理 401、管理员登录退出。失败则恢复旧程序和必要的数据备份。

## 回退

代码备份分支 `backup/pre-upstream-sync-20261125` 指向 `124b3fd8`；原个人 main 为 `dab2b707`。完整 bundle、在线数据库及 runtime/vault 备份位于 `~/.molio/backups/pre-upstream-sync-20261125/`，权限受限。

合并尚未完成时使用 `git merge --abort`。合入 main 后若发现问题，通过回退 PR 撤销；部署先切回 `releases/dab2b70` 并重启用户服务。若新程序迁移数据库，停服务后恢复在线备份及配套知识库，再启动旧版。不要将备份中的管理员凭据、密钥或私有文档提交进仓库。

## 记录

- 决策：从包含 PR #13 的提交起步，避免丢失尚未合入 main 的已交付部署工作；最终 PR 将明确替代 PR #13。

- 基线：daemon 2089 项，2076 通过、13 跳过、0 失败（未指定可选 Compose CLI 解码测试）。
- 冲突处理：保留流取消安全适配 Readable.toWeb，同时使用上游解析后的真实文件路径；managed-events 会话校验与上游窗口聚焦开关同时保留；图谱同时保留公开页缩放回调与上游 trunk 事件。
- 决策：跟随上游移除未开放的“发布到资源库”入口及其过时测试；保留独立“公开 Wiki”发布入口、批量操作和公开页。两者是不同发布出口，公开 Wiki 功能不删减。
- 测试冲突：保留本地终止门闩避免时序竞态，并采用上游相对 URL 端口平移规则。

- 最终独立审查：发现上游新增 API 绕过 daemonFetch，server 写请求缺少 CSRF。浏览器用例 upstream-server-api 在修复前复现 mount 403；统一恢复受控请求（含 market role GET），随后运行完整回归。
- 环境修复：上游新增 Electron 二进制完整性测试发现本机此前未下载 binary，已执行现有 postinstall 补装；未修改或跳过该测试。

- CSRF 回归 RED→GREEN：upstream-server-api.spec.ts 修复前 mount 403，修复后 1/1 通过。全仓 typecheck 与 Web 生产构建已通过，完整单测与 747 项 E2E 进行中。
- 集成方式：最终 PR 使用 merge commit，保留上游提交祖先关系，便于后续继续合并上游，避免 squash 后重复回放同一批更新。

- 全仓单测最终结果：3866 项，3851 通过、15 跳过、0 失败；cloud/daemon/cli/dsh-plugin/desktop/web/landing 均成功（已补装 Electron，无人为跳过失败项）。
