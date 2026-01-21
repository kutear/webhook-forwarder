# Webhook Forwarder

A Cloudflare Workers-based service for forwarding webhooks to multiple destinations. It routes webhook requests to corresponding backend URLs based on a path identifier, enabling flexible one-to-many webhook distribution.

一个基于 Cloudflare Workers 的 Webhook 多目标转发服务。根据 URL 中的路径标识符将 webhook 请求转发到对应配置的多个后端地址，实现灵活的一对多 webhook 分发。

## 功能特性 (Features)

- **路径标识符路由** - Route to different target configurations based on a path identifier in the URL.
- **多目标转发** - Each identifier can be configured with multiple target URLs for parallel forwarding.
- **全方法支持** - Supports all HTTP methods including GET, POST, PUT, DELETE.
- **请求完整保留** - Preserves original request headers and body.
- **子路径支持** - Supports forwarding with sub-paths, e.g., `/webhook/:id/xxx`.
- **详细结果反馈** - Returns detailed forwarding status, duration, etc., for each target.
- **零成本运行** - Runs on the Cloudflare Workers free tier.

## 快速开始 (Quick Start)

### 前置要求 (Prerequisites)

- Node.js >= 18
- A Cloudflare account
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

### 安装 (Installation)

```bash
git clone https://github.com/kutear/webhook-forwarder.git
cd webhook-forwarder
npm install
```

### 本地开发 (Local Development)

```bash
npm run dev
```

Access http://localhost:8787 to test. The dev server will use variables from `wrangler.toml` under `[env.dev.vars]`.

### 部署 (Deployment)

You can deploy automatically via Cloudflare's Git integration or manually.

#### 手动部署 (Manual Deployment)

```bash
npx wrangler login
npm run deploy
```

After deployment, you need to configure the environment variables in the Cloudflare Dashboard.

## 配置 (Configuration)

### 配置目标地址 (Configuring Targets)

Configuration is done via environment variables with a `FORWARD_` prefix.

1.  Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com).
2.  Go to **Workers & Pages** → select **webhook-forwarder**.
3.  Click on **Settings** → **Variables and Secrets**.
4.  Add environment variables. The variable name defines the path, and the value defines the target URLs.

**Example:**

-   **Variable Name**: `FORWARD_github-updates`
-   **Variable Value**: `https://hooks.slack.com/services/xxx,https://discord.com/api/webhooks/xxx`

This configuration will create an endpoint at `/webhook/github-updates` that forwards requests to both the Slack and Discord URLs.

### 配置说明 (Configuration Details)

| 变量名 (Variable Name) | 类型 (Type) | 必填 (Required) | 说明 (Description) |
|---|---|---|---|
| `FORWARD_<your-id>` | String | 是 (Yes) | A comma-separated list of target URLs. `<your-id>` becomes the path identifier. |
| `DEBUG` | String | 否 (No) | Set to `"true"` to enable the `/config` endpoint for viewing the parsed configuration. |

## API 文档 (API Documentation)

### 健康检查 (Health Check)

```
GET /
GET /health
```

**响应示例 (Example Response):**

```json
{
  "status": "ok",
  "service": "webhook-forwarder",
  "code": 0
}
```

### 查看配置 (View Configuration)

> **Note:** This endpoint is only available when the `DEBUG` environment variable is set to `"true"`.

```
GET /config
```

**响应示例 (Example Response):**

```json
{
  "ids": [
    "test-id",
    "another-id"
  ],
  "count": 2,
  "config": {
    "test-id": [
      "http://localhost:3001/webhook",
      "http://localhost:3002/webhook"
    ],
    "another-id": [
      "http://localhost:3003/webhook"
    ]
  },
  "code": 0
}
```

### Webhook 转发 (Webhook Forwarding)

```
ANY /webhook/:id
ANY /webhook/:id/*
```

Forwards the request to all target URLs configured for the given `:id`.

**请求示例 (Example Request):**

```bash
# Forward to all targets configured for "github-updates"
curl -X POST https://your-worker.workers.dev/webhook/github-updates \
  -H "Content-Type: application/json" \
  -d '{"event": "push", "repository": "my-repo"}'

# Forward with a sub-path
curl -X POST https://your-worker.workers.dev/webhook/monitoring/alerts \
  -H "Content-Type: application/json" \
  -d '{"alert": "CPU high"}'
```

**响应示例 (Example Response):**

```json
{
  "id": "github-updates",
  "message": "Forwarded to 2 targets for ID: github-updates",
  "totalTargets": 2,
  "successful": 2,
  "failed": 0,
  "results": [
    {
      "target": "https://hooks.slack.com/services/xxx",
      "success": true,
      "status": 200,
      "statusText": "OK",
      "duration": 123
    },
    {
      "target": "https://discord.com/api/webhooks/xxx",
      "success": true,
      "status": 204,
      "statusText": "No Content",
      "duration": 156
    }
  ],
  "code": 0
}
```

### HTTP 状态码 (HTTP Status Codes)

| 状态码 (Status Code) | 说明 (Description) |
|---|---|
| `200` | All targets forwarded successfully. |
| `207` | Some targets forwarded successfully (Multi-Status). |
| `400` | Bad request (e.g., missing identifier). |
| `404` | Identifier not found or no targets configured. |
| `502` | All targets failed to forward. |

## 使用场景 (Use Cases)

### 多环境 GitHub Webhook (Multi-environment GitHub Webhooks)

Configure different notification targets for different repositories or environments.

**Cloudflare Environment Variables:**
- `FORWARD_frontend-repo` = `https://slack.com/frontend-channel,https://discord.com/frontend-webhook`
- `FORWARD_backend-repo` = `https://slack.com/backend-channel,https://teams.com/backend-webhook`
- `FORWARD_prod-deploy` = `https://pagerduty.com/webhook,https://slack.com/alerts`

**GitHub Webhook URLs:**
- `frontend-repo`: `https://your-worker.workers.dev/webhook/frontend-repo`
- `backend-repo`: `https://your-worker.workers.dev/webhook/backend-repo`

### 监控告警分发 (Monitoring Alert Distribution)

Send alerts of different severity levels to different channels.

**Cloudflare Environment Variables:**
- `FORWARD_critical` = `https://pagerduty.com/webhook,https://slack.com/oncall,https://sms-gateway.com/api`
- `FORWARD_warning` = `https://slack.com/warnings`
- `FORWARD_info` = `https://logging-service.com/events`

### 多租户 Webhook (Multi-tenant Webhooks)

Configure separate webhook forwarding for different customers/tenants.

**Cloudflare Environment Variables:**
- `FORWARD_customer-a` = `https://customer-a.com/webhook`
- `FORWARD_customer-b` = `https://customer-b.com/webhook,https://customer-b-backup.com/webhook`
- `FORWARD_customer-c` = `https://customer-c.com/webhook`

## 项目结构 (Project Structure)

```
webhook-forwarder/
├── src/
│   └── index.ts          # Main Worker code
├── package.json
├── tsconfig.json
├── wrangler.toml         # Cloudflare Worker configuration
└── README.md
```

## 开发命令 (Development Commands)

```bash
# Install dependencies
npm install

# Run local dev server (with hot-reload)
npm run dev

# Deploy to production
npm run deploy

# View real-time logs
npm run tail
```

## 自定义请求头 (Custom Request Headers)

The following headers are added during forwarding:

| Header | Description |
|---|---|
| `X-Forwarded-By` | Identifies the request as coming from `webhook-forwarder`. |
| `X-Original-Host` | The `Host` of the original request. |

The following headers are removed to prevent conflicts:

- `host`
- `cf-connecting-ip`
- `cf-ray`
- `cf-visitor`
- `cf-ipcountry`

## License

MIT