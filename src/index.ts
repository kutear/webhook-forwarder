/**
 * Webhook Forwarder - Cloudflare Worker
 * 
 * 将收到的 webhook 请求转发到多个配置的后端地址
 */

export interface Env {
  // 目标 webhook 地址列表，JSON 数组格式
  WEBHOOK_TARGETS: string;
}

interface ForwardResult {
  target: string;
  success: boolean;
  status?: number;
  statusText?: string;
  error?: string;
  duration: number;
}

interface ForwardResponse {
  message: string;
  totalTargets: number;
  successful: number;
  failed: number;
  results: ForwardResult[];
}

/**
 * 转发请求到单个目标
 */
async function forwardToTarget(
  target: string,
  method: string,
  headers: Headers,
  body: ArrayBuffer | null
): Promise<ForwardResult> {
  const startTime = Date.now();
  
  try {
    // 复制请求头，移除一些不应转发的头
    const forwardHeaders = new Headers(headers);
    forwardHeaders.delete('host');
    forwardHeaders.delete('cf-connecting-ip');
    forwardHeaders.delete('cf-ray');
    forwardHeaders.delete('cf-visitor');
    forwardHeaders.delete('cf-ipcountry');
    
    // 添加自定义头标识这是转发的请求
    forwardHeaders.set('X-Forwarded-By', 'webhook-forwarder');
    forwardHeaders.set('X-Original-Host', headers.get('host') || '');

    const response = await fetch(target, {
      method,
      headers: forwardHeaders,
      body: body && body.byteLength > 0 ? body : undefined,
    });

    return {
      target,
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      target,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    };
  }
}

/**
 * 解析目标地址配置
 */
function parseTargets(targetsConfig: string): string[] {
  try {
    const targets = JSON.parse(targetsConfig);
    if (!Array.isArray(targets)) {
      throw new Error('WEBHOOK_TARGETS must be a JSON array');
    }
    return targets.filter((t): t is string => typeof t === 'string' && t.length > 0);
  } catch (error) {
    console.error('Failed to parse WEBHOOK_TARGETS:', error);
    return [];
  }
}

/**
 * 处理健康检查
 */
function handleHealthCheck(): Response {
  return new Response(JSON.stringify({ status: 'ok', service: 'webhook-forwarder' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * 处理配置查询
 */
function handleConfigQuery(targets: string[]): Response {
  return new Response(
    JSON.stringify({
      targets: targets.map((t) => {
        // 隐藏敏感信息
        try {
          const url = new URL(t);
          return `${url.protocol}//${url.host}${url.pathname}`;
        } catch {
          return '(invalid url)';
        }
      }),
      count: targets.length,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // 健康检查端点
    if (url.pathname === '/health' || url.pathname === '/') {
      return handleHealthCheck();
    }

    // 配置查询端点
    if (url.pathname === '/config' && request.method === 'GET') {
      const targets = parseTargets(env.WEBHOOK_TARGETS || '[]');
      return handleConfigQuery(targets);
    }

    // Webhook 转发端点
    if (url.pathname === '/webhook' || url.pathname.startsWith('/webhook/')) {
      const targets = parseTargets(env.WEBHOOK_TARGETS || '[]');

      if (targets.length === 0) {
        return new Response(
          JSON.stringify({ error: 'No webhook targets configured' }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      // 读取请求体（只读一次）
      const body = await request.arrayBuffer();
      const method = request.method;
      const headers = request.headers;

      // 并行转发到所有目标
      const results = await Promise.all(
        targets.map((target) => {
          // 如果原始请求有子路径，保留它
          const subPath = url.pathname.replace('/webhook', '');
          const targetUrl = subPath ? `${target}${subPath}` : target;
          return forwardToTarget(targetUrl, method, headers, body);
        })
      );

      const successful = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      const response: ForwardResponse = {
        message: `Forwarded to ${targets.length} targets`,
        totalTargets: targets.length,
        successful,
        failed,
        results,
      };

      // 如果所有转发都失败，返回 502
      // 如果部分成功，返回 207 (Multi-Status)
      // 如果全部成功，返回 200
      let statusCode = 200;
      if (failed > 0 && successful === 0) {
        statusCode = 502;
      } else if (failed > 0) {
        statusCode = 207;
      }

      return new Response(JSON.stringify(response, null, 2), {
        status: statusCode,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 未知路径
    return new Response(
      JSON.stringify({
        error: 'Not Found',
        availableEndpoints: [
          'GET / - Health check',
          'GET /health - Health check',
          'GET /config - View configured targets',
          'ANY /webhook - Forward request to all targets',
          'ANY /webhook/* - Forward request with sub-path',
        ],
      }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  },
};
