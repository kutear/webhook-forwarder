# Webhook Forwarder

[![Deploy to Cloudflare Workers](https://github.com/kutear/webhook-forwarder/actions/workflows/deploy.yml/badge.svg)](https://github.com/kutear/webhook-forwarder/actions/workflows/deploy.yml)

一个基于 Cloudflare Workers 的 Webhook 多目标转发服务。将收到的 webhook 请求同时转发到多个配置的后端地址，实现一对多的 webhook 分发。

## 功能特性

- **多目标转发** - 将单个 webhook 请求并行转发到多个目标地址
- **全方法支持** - 支持 GET、POST、PUT、DELETE 等所有 HTTP 方法
- **请求完整保留** - 保留原始请求头和请求体
- **子路径支持** - 支持 `/webhook/xxx` 子路径转发
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
4. 添加变量 `WEBHOOK_TARGETS`，值为 JSON 数组：

```json
["https://slack.com/api/webhook", "https://discord.com/api/webhooks/xxx", "https://your-server.com/webhook"]
```

### 配置说明

| 变量名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `WEBHOOK_TARGETS` | JSON Array | 是 | 目标 webhook 地址列表 |

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
  "targets": [
    "https://slack.com/api/webhook",
    "https://discord.com/api/webhooks/xxx"
  ],
  "count": 2
}
```

### Webhook 转发

```
ANY /webhook
ANY /webhook/*
```

接收任意 HTTP 请求并转发到所有配置的目标地址。

**请求示例：**

```bash
curl -X POST https://webhook-forwarder.kutear.workers.dev/webhook \
  -H "Content-Type: application/json" \
  -d '{"event": "push", "repository": "my-repo"}'
```

**响应示例：**

```json
{
  "message": "Forwarded to 2 targets",
  "totalTargets": 2,
  "successful": 2,
  "failed": 0,
  "results": [
    {
      "target": "https://slack.com/api/webhook",
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
| `500` | 配置错误（未配置目标地址） |
| `502` | 所有目标转发失败 |

## 使用场景

### GitHub Webhook 多平台通知

将 GitHub 仓库的 webhook 事件同时发送到 Slack、Discord、飞书等多个平台：

1. 在 GitHub 仓库 **Settings** → **Webhooks** 添加 webhook
2. Payload URL 设置为：`https://webhook-forwarder.kutear.workers.dev/webhook`
3. 配置 `WEBHOOK_TARGETS` 为各平台的 webhook 地址

### 监控告警分发

将监控系统的告警同时发送到多个接收端：

```json
[
  "https://api.pagerduty.com/webhooks/xxx",
  "https://hooks.slack.com/services/xxx",
  "https://your-logging-service.com/alerts"
]
```

### 数据同步

将数据变更事件同步到多个下游系统：

```json
[
  "https://service-a.internal/sync",
  "https://service-b.internal/sync",
  "https://analytics.internal/events"
]
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
