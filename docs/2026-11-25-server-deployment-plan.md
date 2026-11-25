# server 部署配置与本机 main 实例实施计划

用户已授权：基于最新个人 main 重建本机实例，补齐 Docker、管理员初始化和 HTTPS 配置。实施范围沿用已批准的一期 server 配置和三期内容边界。

- [x] 从个人 main `dab2b70` 建隔离功能分支；保留原工作区和用户文档。
- [x] 构建并打包 main；在线备份现有演示数据库，保留知识库路径及管理员凭据，以用户级 systemd 服务运行 `https://localhost:46735/`。
- [x] 验证 HTTPS、本机构建资源、公开快照未变、匿名管理 401、管理员登录和退出。
- [x] 新增部署测试，复现模板副本不同步及缺少管理员初始化工具。
- [x] 实现 standalone `scripts/setup-server.mjs`：严格 HTTPS Origin、scrypt、隐藏密码输入、保留现有凭据和配置、原子写入 600 权限 env，非交互缺配置失败关闭。
- [x] Docker 默认 server + 容器内 0.0.0.0；宿主机默认只映射 127.0.0.1。提供可选 Caddy HTTPS compose 配置，支持已有反向代理。
- [x] install.sh 同步释放 compose/env/HTTPS/Caddy/初始化工具；Docker 依赖多级回退不变，启动后确认 server 边界，输出 HTTPS 入口。
- [x] 补部署、备份恢复、管理员恢复和本机实例管理文档；测试真实初始化与模板一致性、bash 语法、配置结构，独立审查并通过 PR 同步。

Docker 引擎与 OSS 上传工具当前不可用；本机原生 HTTPS 可实际验收，容器镜像构建、正式域名证书及 OSS 发布须明确记录未验证/未发布，不将源文件修改称为正式发行。

独立审查发现并修正：构建上下文遗漏初始化脚本、升级时旧 Caddy 提前转发与失败清理、特殊字符凭据的 Compose 转义。新增测试先复现失败，再验证修复；8 项部署专项测试（含真实 Compose CLI 解码）通过。

最终验证：daemon 全量 2089 项，2077 通过、12 跳过、0 失败；daemon typecheck、bash -n 与 diff 检查通过。已完成 OCR delegate 规则自审，提交到个人仓库的功能分支并通过 PR 交付，main 不直接推送。
