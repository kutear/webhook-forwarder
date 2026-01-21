/**
 * Webhook Forwarder - Cloudflare Worker
 *
 * Forwards incoming webhook requests to configured backend URLs based on a path identifier.
 */

export interface Env {
  // Configuration is now done via environment variables prefixed with `FORWARD_`.
  // The key for the webhook path is the part of the variable name after `FORWARD_`.
  // The value is a comma-separated list of webhook URLs.
  //
  // Example:
  // FORWARD_my-service = "https://example.com/hook1,https://example.com/hook2"
  // This will create a forwarding endpoint at /webhook/my-service
  //
  // For wrangler.toml, use quotes for keys if needed:
  // [vars]
  // "FORWARD_my-service" = "https://example.com/hook1,https://example.com/hook2"
  // "FORWARD_another-uuid-style-key" = "https://example.com/hook3"

  [key: string]: any; // Allow any environment variables

  // Set to "true" to enable the /config endpoint for debugging.
  DEBUG?: string;
}

interface WebhookConfig {
  [id: string]: string[];
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
  id: string;
  message: string;
  totalTargets: number;
  successful: number;
  failed: number;
  results: ForwardResult[];
  code: number;
}

/**
 * Forwards the request to a single target URL.
 */
async function forwardToTarget(
  target: string,
  method: string,
  headers: Headers,
  body: ArrayBuffer | null
): Promise<ForwardResult> {
  const startTime = Date.now();

  try {
    // Clone headers and remove sensitive/unnecessary ones.
    const forwardHeaders = new Headers(headers);
    forwardHeaders.delete('host');
    forwardHeaders.delete('cf-connecting-ip');
    forwardHeaders.delete('cf-ray');
    forwardHeaders.delete('cf-visitor');
    forwardHeaders.delete('cf-ipcountry');

    // Add custom headers to identify the forwarder.
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
 * Parses the configuration from environment variables.
 * A variable is considered a target if its name starts with `FORWARD_`.
 * The path identifier is the part of the name after the prefix.
 * The value should be a comma-separated list of URLs.
 */
function parseConfig(env: Env): WebhookConfig {
  const config: WebhookConfig = {};
  const prefix = 'FORWARD_';

  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(prefix) && typeof value === 'string' && value.length > 0) {
      const id = key.substring(prefix.length);
      if (id) {
        config[id] = value.split(',').map(url => url.trim()).filter(Boolean);
      }
    }
  }
  return config;
}

/**
 * Handles health check requests.
 */
function handleHealthCheck(): Response {
  return new Response(JSON.stringify({ status: 'ok', service: 'webhook-forwarder', code: 0 }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handles configuration query requests.
 */
function handleConfigQuery(config: WebhookConfig): Response {
  const safeConfig: { [id: string]: string[] } = {};

  for (const [id, targets] of Object.entries(config)) {
    safeConfig[id] = targets.map((t) => {
      // Hide sensitive information (like query params) from the config view.
      try {
        const url = new URL(t);
        return `${url.protocol}//${url.host}${url.pathname}`;
      } catch {
        return '(invalid url)';
      }
    });
  }

  return new Response(
    JSON.stringify({
      ids: Object.keys(config),
      count: Object.keys(config).length,
      config: safeConfig,
      code: 0,
    }, null, 2),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Extracts the identifier and sub-path from the request path.
 * e.g., /webhook/abc-123 -> { id: 'abc-123', subPath: '' }
 * e.g., /webhook/abc-123/extra/path -> { id: 'abc-123', subPath: '/extra/path' }
 */
function extractIdFromPath(pathname: string): { id: string; subPath: string } | null {
  const match = pathname.match(/^\/webhook\/([^\/]+)(\/.*)?$/);
  if (!match) {
    return null;
  }
  return {
    id: match[1],
    subPath: match[2] || '',
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health' || url.pathname === '/') {
      return handleHealthCheck();
    }

    // Config query endpoint (only available if DEBUG=true)
    if (url.pathname === '/config' && request.method === 'GET') {
      if (env.DEBUG !== 'true') {
        return new Response(
          JSON.stringify({ error: 'Not Found', code: -1 }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      const config = parseConfig(env);
      return handleConfigQuery(config);
    }

    // Webhook forwarding endpoint: /webhook/:id
    if (url.pathname.startsWith('/webhook/')) {
      const extracted = extractIdFromPath(url.pathname);

      if (!extracted) {
        return new Response(
          JSON.stringify({ error: 'Invalid path. Use /webhook/:id', code: -1 }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      const { id, subPath } = extracted;
      const config = parseConfig(env);
      const targets = config[id];

      if (!targets || targets.length === 0) {
        return new Response(
          JSON.stringify({
            error: 'Identifier not found or no targets configured',
            id,
            availableIds: Object.keys(config),
            code: -1,
          }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      // Read the request body once.
      const body = await request.arrayBuffer();
      const method = request.method;
      const headers = request.headers;

      // Forward to all targets for this ID in parallel.
      const results = await Promise.all(
        targets.map((target) => {
          // Append the sub-path if it exists.
          const targetUrl = subPath ? `${target.replace(/\/$/, '')}${subPath}` : target;
          return forwardToTarget(targetUrl, method, headers, body);
        })
      );

      const successful = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      const response: ForwardResponse = {
        id,
        message: `Forwarded to ${targets.length} targets for ID: ${id}`,
        totalTargets: targets.length,
        successful,
        failed,
        results,
        code: successful > 0 ? 0 : -1,
      };

      // Determine the overall status code.
      // 502 if all forwards failed.
      // 207 (Multi-Status) if some failed.
      // 200 if all succeeded.
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

    // Handle /webhook without an ID.
    if (url.pathname === '/webhook') {
      return new Response(
        JSON.stringify({
          error: 'Identifier required. Use /webhook/:id',
          example: '/webhook/your-service-id',
          code: -1,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Catch-all for unknown paths.
    return new Response(
      JSON.stringify({
        error: 'Not Found',
        availableEndpoints: [
          'GET / - Health check',
          'GET /health - Health check',
          'GET /config - View configured IDs and targets (requires DEBUG=true)',
          'ANY /webhook/:id - Forward request to targets for a specific ID',
          'ANY /webhook/:id/* - Forward request with sub-path',
        ],
        code: -1,
      }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  },
};