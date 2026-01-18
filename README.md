# Webhook Forwarder

[![Deploy to Cloudflare Workers](https://github.com/kutear/webhook-forwarder/actions/workflows/deploy.yml/badge.svg)](https://github.com/kutear/webhook-forwarder/actions/workflows/deploy.yml)

一个基于 Cloudflare Workers 的 Webhook 多目标转发服务。根据 URL 中的 UUID 将 webhook 请求转发到对应配置的多个后端地址，实现灵活的一对多 webhook 分发。

## 功能特性

- **UUID 路由** - 根据 URL 中的 UUID 路由到不同的目标配置
- **多目标转发** - 每个 UUID 可配置多个目标地址，并行转发
- **全方法支持** - 支持 GET、POST、PUT、DELETE 等所有 HTTP 方法
- **请求完整保留** - 保留原始请求头和请求体
- **子路径支持** - 支持 `/webhook/:uuid/xxx` 子路径转发
- **详细结果反馈** - 返回每个目标的转发状态、耗时等信息
- **零成本运行** - 基于 Cloudflare Workers 免费套餐

## 快速开始

### 前置要求

- Node.js >= 18
- Cloudflare 账号
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

### 安装

```bash
git clone https://github.com/kutear/webhook-forwarder.git
cd webhook-forwarder
npm install
```

### 本地开发

```bash
npm run dev
```

访问 http://localhost:8787 进行测试。

### 部署

```bash
# 首次部署需要登录
npx wrangler login

# 部署到 Cloudflare
npm run deploy
```

## 配置

### 配置目标地址

在 Cloudflare Dashboard 中配置环境变量 `WEBHOOK_TARGETS`：

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **Workers & Pages** → 选择 **webhook-forwarder**
3. 点击 **Settings** → **Variables and Secrets**
4. 添加变量 `WEBHOOK_TARGETS`，值为 JSON 对象：

```json
{
  "github-notify": [
    "https://hooks.slack.com/services/xxx",
    "https://discord.com/api/webhooks/xxx"
  ],
  "gitlab-notify": [
    "https://your-server.com/webhook"
  ],
  "monitoring": [
    "https://pagerduty.com/webhook",
    "https://opsgenie.com/webhook",
    "https://slack.com/webhook"
  ]
}
```

### 配置说明

| 变量名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `WEBHOOK_TARGETS` | JSON Object | 是 | UUID 到目标地址列表的映射 |

### 配置格式

```
{
  "<uuid>": ["<target-url-1>", "<target-url-2>", ...],
  "<uuid>": ["<target-url-1>"],
  ...
}
```

- **uuid**: 自定义的标识符，用于 URL 路由（如 `github`, `prod-alerts`, `service-a` 等）
- **target-url**: 要转发到的目标 webhook 地址

## API 文档

### 健康检查

```
GET /
GET /health
```

**响应示例：**

```json
{
  "status": "ok",
  "service": "webhook-forwarder"
}
```

### 查看配置

```
GET /config
```

**响应示例：**

```json
{
  "uuids": ["github-notify", "gitlab-notify", "monitoring"],
  "count": 3,
  "config": {
    "github-notify": [
      "https://hooks.slack.com/services/xxx",
      "https://discord.com/api/webhooks/xxx"
    ],
    "gitlab-notify": [
      "https://your-server.com/webhook"
    ],
    "monitoring": [
      "https://pagerduty.com/webhook",
      "https://opsgenie.com/webhook"
    ]
  }
}
```

### Webhook 转发

```
ANY /webhook/:uuid
ANY /webhook/:uuid/*
```

根据 UUID 转发请求到对应配置的所有目标地址。

**请求示例：**

```bash
# 转发到 github-notify 配置的所有目标
curl -X POST https://webhook-forwarder.kutear.workers.dev/webhook/github-notify \
  -H "Content-Type: application/json" \
  -d '{"event": "push", "repository": "my-repo"}'

# 带子路径的转发
curl -X POST https://webhook-forwarder.kutear.workers.dev/webhook/monitoring/alerts \
  -H "Content-Type: application/json" \
  -d '{"alert": "CPU high"}'
```

**响应示例：**

```json
{
  "uuid": "github-notify",
  "message": "Forwarded to 2 targets for UUID: github-notify",
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
  ]
}
```

### HTTP 状态码

| 状态码 | 说明 |
|--------|------|
| `200` | 所有目标转发成功 |
| `207` | 部分目标转发成功（Multi-Status） |
| `400` | 请求格式错误（缺少 UUID） |
| `404` | UUID 未找到或未配置目标 |
| `502` | 所有目标转发失败 |

## 使用场景

### 多环境 GitHub Webhook

为不同仓库或环境配置不同的通知目标：

```json
{
  "frontend-repo": [
    "https://slack.com/frontend-channel",
    "https://discord.com/frontend-webhook"
  ],
  "backend-repo": [
    "https://slack.com/backend-channel",
    "https://teams.com/backend-webhook"
  ],
  "prod-deploy": [
    "https://pagerduty.com/webhook",
    "https://slack.com/alerts"
  ]
}
```

在 GitHub 中配置：
- frontend 仓库 webhook URL: `https://your-worker.workers.dev/webhook/frontend-repo`
- backend 仓库 webhook URL: `https://your-worker.workers.dev/webhook/backend-repo`

### 监控告警分发

不同级别的告警发送到不同的渠道：

```json
{
  "critical": [
    "https://pagerduty.com/webhook",
    "https://slack.com/oncall",
    "https://sms-gateway.com/api"
  ],
  "warning": [
    "https://slack.com/warnings"
  ],
  "info": [
    "https://logging-service.com/events"
  ]
}
```

### 多租户 Webhook

为不同客户/租户配置独立的 webhook 转发：

```json
{
  "customer-a": ["https://customer-a.com/webhook"],
  "customer-b": ["https://customer-b.com/webhook", "https://customer-b-backup.com/webhook"],
  "customer-c": ["https://customer-c.com/webhook"]
}
```

## 项目结构

```
webhook-forwarder/
├── .github/
│   └── workflows/
│       └── deploy.yml    # GitHub Actions 自动部署
├── src/
│   └── index.ts          # Worker 主代码
├── package.json
├── tsconfig.json
├── wrangler.toml         # Cloudflare Worker 配置
└── README.md
```

## GitHub Actions 自动部署

本项目配置了 GitHub Actions，推送到 `main` 分支时自动部署。

### 配置步骤

1. 在 Cloudflare Dashboard 创建 API Token：
   - 访问 https://dash.cloudflare.com/profile/api-tokens
   - 点击 **Create Token**
   - 选择 **Edit Cloudflare Workers** 模板
   - 创建并复制 Token

2. 在 GitHub 仓库添加 Secret：
   - 进入仓库 **Settings** → **Secrets and variables** → **Actions**
   - 添加 `CLOUDFLARE_API_TOKEN`，值为上一步复制的 Token

3. 推送代码到 `main` 分支即可自动部署

## 开发命令

```bash
# 安装依赖
npm install

# 本地开发（热重载）
npm run dev

# 部署到生产环境
npm run deploy

# 查看实时日志
npm run tail
```

## 自定义请求头

转发时会添加以下请求头：

| 请求头 | 说明 |
|--------|------|
| `X-Forwarded-By` | 标识请求来自 webhook-forwarder |
| `X-Original-Host` | 原始请求的 Host |

以下请求头会被移除（避免冲突）：

- `host`
- `cf-connecting-ip`
- `cf-ray`
- `cf-visitor`
- `cf-ipcountry`

## License

MIT
