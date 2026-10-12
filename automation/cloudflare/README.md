# Cloudflare 定时触发器

每 5 分钟调用 GitHub Actions 的 `workflow_dispatch`，由原有工作流读取腾讯文档和发布 Pages。Worker 不读取成绩、不持有腾讯文档凭据、没有公网 HTTP 入口；已有工作流未完成时跳过触发。GitHub runner 排队和部署仍可能延迟，不承诺严格每 5 分钟完成更新。

## 配置

1. 使用 Wrangler 登录自己的 Cloudflare 账号。
2. 在 GitHub 创建 fine-grained personal access token，仅授权 `CYRickyArAr/cube-training-stats` 仓库，Repository permissions 的 **Actions: Read and write**（Metadata 自动为只读），设置有效期。
3. 使用 `wrangler secret put GITHUB_TOKEN` 的交互输入保存 token，或在 Cloudflare Worker 的 Settings → Variables and Secrets 中以 **Secret** 类型保存。不放在源码、配置文件、命令参数、聊天或 GitHub 仓库中。
4. 使用此目录的 `wrangler.jsonc` 部署 Worker。首次创建时可以先部署无 Cron 的临时配置，设置 Secret 后再部署正式配置，避免未配置凭据就运行。
5. 在 Cloudflare 中确认 Cron 调用成功，再核对 GitHub `workflow_dispatch` 和 Pages 快照更新时间。Cron 配置变更可能需最多约 15 分钟传播。
6. 验证 Cloudflare 连续触发成功后，将原 GitHub `schedule` 降为每小时第 43 分钟兜底，避免两套高频定时器重复运行。

令牌到期需更新 Cloudflare Secret。Worker 日志只记录触发/跳过结果或 HTTP 状态，不输出凭据或 GitHub 响应正文。

## 已部署状态

Worker 名称：`cube-training-scheduler`；无公网 URL，Cron 为 `*/5 * * * *`，`GITHUB_TOKEN` 使用 `secret_text` 类型。已于北京时间 2026-10-02 验证自动触发：00:11:13、00:16:18（间隔约 5 分钟）；首轮源表读取失败，次轮成功发布，快照更新时间为 00:17:16。触发成功不等于源表一定读取成功，失败时保留旧快照，下一轮重试。

GitHub Token 的权限和有效期由账号持有人在 GitHub 管理；到期前更新 Cloudflare Secret。不要把 Token 设置成普通 Text 变量。

## 防止过期排队记录永久挡住触发

该保护在部署本版本 Worker 后生效：`queued` 的创建及最后更新时间均超过 30 分钟，并且 GitHub 返回该 main 运行所有 attempt 都没有 jobs，才允许绕过它继续检查其他状态。Worker 不调用取消接口；正常排队、已有 jobs、时间/状态不明，以及 `in_progress`、`waiting`（包括人工审批）、`pending`、`requested` 仍会阻止新触发。现有工作流继续使用 `statistics-pages` 并发组、`cancel-in-progress: false` 和每个 job 10 分钟超时；隐私检查及源读取成功后才部署，失败保留上次公开快照。

只对网络错误和 HTTP 500/502/503/504 的 GET 查询最多尝试 3 次，每次 10 秒超时，退避 250ms、1000ms。401/403/429 和数据结构错误直接失败，下一次 Cron 再检查。非幂等的 dispatch POST 只发一次；网络或服务端错误会明确记录结果不确定，不会立即重复提交。一次 Cron 最多 19 个 API 请求（不含重定向），无需新增 Cloudflare 存储、绑定或 GitHub 权限。

日志会说明阻塞运行的编号、状态和已等待分钟数，或说明已绕过的无 jobs 过期排队记录；重试次数、失败阶段和 HTTP 状态会记录，但不记录请求头、响应正文、上游异常原文或任何密钥。定时调用错误仍向运行时抛出，不能把失败记成成功。

部署验收需要确认线上版本、最近 Cron 日志及账户用量。未能访问这些证据时，不能以仓库配置代替线上状态，也不能据此断定是否额度耗尽。若 GitHub Pages 或真实审批等待阻塞，仍需单独核实；本保护只修复无 jobs 的过期 queued 长期阻断五分钟触发的问题。
