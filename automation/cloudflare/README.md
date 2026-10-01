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
