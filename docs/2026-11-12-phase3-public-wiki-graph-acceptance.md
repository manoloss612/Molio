# 第三阶段（公开 Wiki +公开知识图谱）验收结论

- 日期：2026-11-12
- 验收对象：`/home/ss/.codex/worktrees/f1fa/molio`，分支 `feat/public-wiki-graph`，HEAD `7cd3391`（`f7b09b2` daemon → `d9bfb9c` web → `7cd3391` docs）
- 判定依据：`docs/2026-11-11-public-wiki-graph-design.md`（设计与 §6完成条件）、`docs/2026-11-11-public-wiki-graph-plan.md`（Task0–4）、Codex自述 `docs/phase3-public-wiki-graph-acceptance.md`
- 验收方式：独立复跑门禁 +代码复核 +隔离环境活体探测；**不采信自述数字，以本次实跑输出为准**

## 一、结论

**有保留通过**：设计 §6的完成条件在功能与边界层面成立，五项门禁（含全量 Web E2E）我自己全部复跑通过；但仍有第四节1–4项应在合并前修掉，因此不是无条件通过。

主链路是真实成立的，不是「按钮藏起来」式的假边界：

- 公开读接口在 daemon侧有独立 allowlist（`/api/public/site|graph|pages/<uuid>|assets/<uuid>`），与管理员会话解耦；UUID精确匹配，非匹配一律落到统一 `404 {"error":"unavailable"}`；服务端对所有 `/api`响应加 `Cache-Control: no-store`，公开响应另加 `X-Content-Type-Options: nosniff`。
- 公开页在 Web端挂在 `AccessBoundary`之外，只走裸 `fetch(..., {credentials:'omit'})`，不携带管理员 cookie / CSRF；E2E捕获了匿名上下文下的全部 `/api/`请求并断言前缀只能是 `/api/public/`。
- Markdown渲染先 DOMPurify白名单净化，再对 `<img>`的 `src`收窄到 `^/api/public/assets/<uuid>?revision=N$`，脚本与私网图片都被消除；快照只存在于活动 revision，撤回 /旧 revision走统一不可用。
- 投影层（`project.ts`）用 `realpath`做页面与图片的越界校验、扩展名与文件头双检、字节上限、代码块区间跳过，且投影文本里只有不透明资产 ID，不含 vault路径。

保留项（详见第四节）：计划 Task2明确要求的「同一读事务」未落实；生产代码里存在为测试 fixture特判的 `data-testid`；预览标题把页数当版本号显示；`git diff --check`不通过（EOF空行）；公开页链接改写 /资产白名单没有单元测试，只有 E2E覆盖。

## 二、我独立复跑并通过的门禁

全部在 `/home/ss/.codex/worktrees/f1fa/molio`、HEAD `7cd3391`、`CI=1`、未复用任何残留 server、3100/5173/3201/3199端口空闲的条件下执行。

| # |门禁 |命令 |实跑结果 | EXIT |与 Codex自述 |
|---|---|---|---|---|---|
|1 |类型检查 | `pnpm typecheck` |7个 TS工程全部 `Done` |0 |一致 |
|2 | daemon单测 | `pnpm --filter @molio/daemon test` |2065项 /2053 pass /0 fail /12 skip /94.8 s |0 |一致 |
|3 | web单测 | `pnpm --filter @molio/web test` |632项 /632 pass /0 fail /0 skip /4.8 s |0 |一致 |
|4 |定向公开页 E2E | `playwright test -c playwright.admin.config.ts e2e/publication-ui.spec.ts e2e/publication-server.spec.ts` | `2 passed (30.3 s)`；日志显示先构建当前管理端产物再起 worker |0 |一致 |
|5 |全量 Web E2E | `pnpm --filter @molio/web exec playwright test` | `653 tests using1 worker` → `652 passed (33.5m)`、`1 skipped`、0 failed；开头重新构建当日管理端产物；两份新 spec各自 ✓（`publication-server.spec.ts:11`3.8 s、`publication-ui.spec.ts:11`4.5 s） |0 |一致（Codex称652 /1 /0、33.8分钟） |

全量 E2E中唯一跳过项为 `kb-large-file-too-large.spec.ts:35:3 › shows too-large card and force-loads on click`，与三期无关，是既有用例。

>说明：本次启动全量 E2E的后台命令里输出重定向写成了 `... > full-e2e.log2>&1`，bash把它解析为「写到 `full-e2e.log2` +再复制到 stdout」，所以 `full-e2e.log`里只有一行 `EXIT=0`，真实输出在 `full-e2e.log2`（101,438字节）。上面的数字取自 `full-e2e.log2`。

### 12个 daemon skip的构成

与三期改动无关，且我逐条核对了跳过原因：

- 10个 win32-only：Windows venv / Python Scripts PATH布局（3）、PortableGit与 git-bash回退（2）、GBK解码（2）、`taskkill /T`两级 /三级进程树（2）、cmd.exe wrapper回收（1，唯一带字面 `# SKIP`）。
- 2个 `PyMuPDF unavailable`（页面渲染范围校验、字体修复）。

### 活体接口探测（本地模式、合成环境）

隔离 daemon：端口31311、数据目录 `/tmp/acc-p3/daemon-probe/data`，**未读取任何用户 vault内容**。

|请求 |结果 |
|---|---|
| `HEAD /api/public/site` |200，`cache-control: no-store`，`x-content-type-options: nosniff` |
| `GET /api/public/site` | `{"enabled":false,"revision":0,"pages":[]}` |
| `HEAD /api/public/graph?revision=0` |404（同样带 no-store / nosniff） |
| `GET /api/public/pages/<uuid>?revision=0` |404 `{"error":"unavailable"}` |

结论：HEAD与 GET走同一门禁与同一组安全响应头；站点关闭态不泄露任何 vault元数据；不可用态响应统一，无法用于枚举。

## 三、证据包交叉核对

- **分支从未推送**：`git ls-remote`在 origin（zhuzhaoyun/Molio）与 backup（manoloss612/Molio）都查不到 `feat/public-wiki-graph`；`git branch -r --contains HEAD`为空；分支无 upstream。工作树 `git status --porcelain`为空。
- **一期 /二期也未合入**：两个分支只存在于 backup（`codex/phase1-admin-access-backup` @ `85e32b2`、`feat/admin-web-access` @ `124c205`），origin无同名分支。设计 §7「不合并、不部署」成立。
- **变更面**：相对二期 head `124c205`共31文件、+2033 / −4（daemon9、web13、contracts2、docs3、e2e配置2、其他）。
- **测试声明增量**：全仓 `test()`声明从662 →664，正好 +2，即两份新 spec；`apps/web/e2e/area-map.json`新增 `public-wiki` area，把两份 spec都登记为 `priority: P1`。
- **新增测试文件**：`guard.test.ts`（改）、`publication-routes.test.ts`（4条）、`publication.test.ts`（11条）、`db-migration.test.ts`（改）；web侧只有 E2E，**没有新增 `apps/web/src/**/*.test.ts`**。
- **`git diff --check`**：`apps/web/e2e/publication-ui.spec.ts:77: new blank line at EOF`（CI lint级问题）。

## 四、偏差与问题（不构成安全阻塞，但应处理）

按严重度排列。前四项建议在合并前改掉，其余可作为后续项。

1. **计划 Task2的「同一读事务」未落实。** `apps/daemon/src/routes/public.ts`先 `store.getPublicSite()`判断 enabled / revision，再单独调 `getPublicPage / getPublicGraph / getPublicAsset`；store内部也是先 `getState()`再读数据。两次读取之间若发生 commit，可能出现「刚关闭站点仍返回本页」「刚切换 revision返回不可用」的瞬时不一致。由于响应是 `no-store`且内容按 revision键读取，不会泄露旧内容，但**不符合计划明文要求**，也未在设计里说明这一取舍。
2. **生产代码为测试特判。** `apps/web/src/components/publication/PublicationPanel.tsx:81`写了 `data-testid={... sourcePath.endsWith('public-a.md') ? 'public-a' : sourcePath}` ——用 fixture文件名决定 testid。E2E完全可以用已存在的 `data-page-id` +文案定位，这行应在合并前删除。
3. **预览标题误用字段。**同文件 `PublicationPanel.tsx:87`：`t('publicWiki.revision', { revision: preview.pageCount })`，把「页数」显示成「版本号」。用户可见的错误信息。
4. **`git diff --check`失败**（EOF空行），会让 lint类 CI红。
5. **公开页渲染规则无单元测试。** `renderPublicMarkdown`（`molio-page:` / `molio-asset:` / `molio-unavailable:`改写、`<img>`白名单正则）只在 E2E里被间接覆盖，且该函数未导出，无法单测。链接改写正是最容易回归的一层。
6. **预览会话绑定用 cookie原文。** `routes/publication.ts`把 `c.req.header('cookie') ?? ''`直接当 `sessionKey`。重新登录（cookie变化）会让未提交的预览静默失效；本地模式下没有 cookie，所有预览共享空串 key，等于没有绑定。
7. **`getInternalPages`存在 N+1查询**（每页一次资产查询），在1,000页上限下状态接口会放大到千次查询。
8. **`setSiteEnabled`不推进 revision。**同一 revision的语义因此不完全等于「同一公开状态」（enabled可独立变化）。有 `no-store`兜底，暂无缓存危害，但设计里 revision作为公开地址参数的约定需要写清。
9. **计划 Task3点名的 `PublicWikiPage.tsx` / `PublicGraphPage.tsx`未落地**，实际是单个 `PublicSite.tsx`（107行，图谱为内联 SVG）。行为等价，但与计划文件结构不一致，应在计划 /设计里对齐或说明。

## 五、本次未验证的范围

- **全量 Web E2E已在本次复跑通过**（见第二节第5行）：只覆盖 chromium单 worker本地/隔离 HTTPS，未覆盖 Firefox / WebKit、并行 worker下的竞态、以及生产静态资源经由真实 CDN /代理分发的路径。
- **真实反向代理 / TLS**：E2E用的是进程内 HTTPS反向代理 +自签证书；未验证 Caddy / Nginx +正式证书、HSTS、CDN /代理缓存分层。
- **Windows / macOS打包与 Electron壳**：未打包，也未验证桌面端内 `/public/wiki`的可用性。
- **多管理员并发**：设计是单管理员、单预览候选，未测两个会话同时预览 /提交的行为。
- **容量基准**：设计 §5的数字（1,000页事务576 ms、大负载1,442 ms、20,000边675,601字节）来自一次性合成测量，不是自动化容量测试，我未复跑。
- **部署 /合并 / PR**：按设计 §7本轮不做。

## 六、验收建议

1.修掉第四节1–4项（单读事务或改文档措辞、删 fixture testid、修预览标题、删 EOF空行）。
2.把 `renderPublicMarkdown`导出并补单元测试，覆盖三种 `molio-*`改写、`<img>`白名单拒绝、以及404重试后的降级渲染。
3.预览 `sessionKey`改用会话 ID，并明确本地模式下预览绑定的语义。
4.本节1–3项修完后，以「全量 Web E2E仍全绿」作为准入条件；本轮全量已绿，但改动上述文件后需重跑。

## 附：本次实际执行的命令

```bash
cd /home/ss/.codex/worktrees/f1fa/molio
pnpm typecheck
pnpm --filter @molio/daemon test
pnpm --filter @molio/web test
pnpm --filter @molio/web exec playwright test -c playwright.admin.config.ts \
 e2e/publication-ui.spec.ts e2e/publication-server.spec.ts
pnpm --filter @molio/web exec playwright test #全量；本次652 passed /1 skipped（33.5m），输出见 /tmp/acc-p3/full-e2e.log2
git ls-remote --heads backup | grep -Ei 'public-wiki|admin|phase'
git ls-remote --heads origin | grep -Ei 'public-wiki|admin|phase'
git branch -r --contains HEAD
git diff --check "124c205"..HEAD
```
