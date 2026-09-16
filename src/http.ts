import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createMcpServer } from "./server.js";
import { requireEnv } from "./env.js";
import {
  registerClient,
  beginAuthorization,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  isValidAccessToken,
} from "./oauth.js";

const MCP_PATH = "/mcp";
const HEALTH_PATH = "/healthz";
const AUTH_METADATA_PATH = "/.well-known/oauth-authorization-server";
const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";
const REGISTER_PATH = "/register";
const AUTHORIZE_PATH = "/authorize";
const TOKEN_PATH = "/token";

function baseUrl(req: IncomingMessage): string {
  const proto = req.headers.host?.includes("localhost") ? "http" : "https";
  return `${proto}://${req.headers.host}`;
}

function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...extraHeaders });
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function parseFormBody(raw: string): Record<string, string> {
  const params = new URLSearchParams(raw);
  return Object.fromEntries(params.entries());
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function renderLoginForm(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  error?: string;
}): string {
  const hidden = (name: string, value: string) =>
    `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Authorize bip-mcp-server</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 420px; margin: 80px auto; padding: 0 16px; }
  input[type=password] { width: 100%; padding: 8px; font-size: 16px; box-sizing: border-box; margin: 8px 0; }
  button { width: 100%; padding: 10px; font-size: 16px; cursor: pointer; }
  .error { color: #b00020; }
</style>
</head>
<body>
  <h2>Authorize access to bip-mcp-server</h2>
  <p>Enter your MCP_AUTH_TOKEN to grant this client access.</p>
  ${params.error ? `<p class="error">${escapeHtml(params.error)}</p>` : ""}
  <form method="POST" action="${AUTHORIZE_PATH}">
    ${hidden("client_id", params.clientId)}
    ${hidden("redirect_uri", params.redirectUri)}
    ${hidden("state", params.state)}
    ${hidden("code_challenge", params.codeChallenge)}
    <input type="password" name="token" placeholder="MCP_AUTH_TOKEN" autofocus required>
    <button type="submit">Authorize</button>
  </form>
</body>
</html>`;
}

function isAuthorized(req: IncomingMessage, staticToken: string): boolean {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return false;
  }
  const token = header.slice("Bearer ".length);
  return token === staticToken || isValidAccessToken(token);
}

export async function runHttp(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const authToken = requireEnv("MCP_AUTH_TOKEN");

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", baseUrl(req));
    const method = req.method ?? "GET";

    if (method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    if (url.pathname === HEALTH_PATH) {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    // --- OAuth discovery metadata -------------------------------------------
    if (url.pathname === AUTH_METADATA_PATH && method === "GET") {
      const base = baseUrl(req);
      sendJson(
        res,
        200,
        {
          issuer: base,
          authorization_endpoint: `${base}${AUTHORIZE_PATH}`,
          token_endpoint: `${base}${TOKEN_PATH}`,
          registration_endpoint: `${base}${REGISTER_PATH}`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          scopes_supported: ["mcp"],
        },
        CORS_HEADERS,
      );
      return;
    }

    if (url.pathname === RESOURCE_METADATA_PATH && method === "GET") {
      const base = baseUrl(req);
      sendJson(
        res,
        200,
        {
          resource: `${base}${MCP_PATH}`,
          authorization_servers: [base],
        },
        CORS_HEADERS,
      );
      return;
    }

    // --- Dynamic client registration (RFC 7591) -----------------------------
    if (url.pathname === REGISTER_PATH && method === "POST") {
      const raw = await readBody(req);
      let body: Record<string, unknown> = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        // tolerate empty/invalid body, fall back to defaults
      }
      const clientId = registerClient();
      sendJson(
        res,
        201,
        {
          client_id: clientId,
          client_id_issued_at: Math.floor(Date.now() / 1000),
          redirect_uris: body.redirect_uris ?? [],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        },
        CORS_HEADERS,
      );
      return;
    }

    // --- Authorization endpoint (interactive login + consent) --------------
    if (url.pathname === AUTHORIZE_PATH && method === "GET") {
      const clientId = url.searchParams.get("client_id") ?? "";
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const codeChallenge = url.searchParams.get("code_challenge") ?? "";
      const codeChallengeMethod = url.searchParams.get("code_challenge_method") ?? "";
      const responseType = url.searchParams.get("response_type") ?? "";

      if (responseType !== "code" || codeChallengeMethod !== "S256" || !redirectUri || !codeChallenge) {
        sendJson(res, 400, {
          error: "invalid_request",
          message: "Missing/invalid response_type, redirect_uri, code_challenge, or code_challenge_method (must be S256).",
        });
        return;
      }

      sendHtml(res, 200, renderLoginForm({ clientId, redirectUri, state, codeChallenge }));
      return;
    }

    if (url.pathname === AUTHORIZE_PATH && method === "POST") {
      const raw = await readBody(req);
      const form = parseFormBody(raw);
      const { client_id: clientId, redirect_uri: redirectUri, state, code_challenge: codeChallenge, token } = form;

      if (token !== authToken) {
        sendHtml(
          res,
          401,
          renderLoginForm({
            clientId: clientId ?? "",
            redirectUri: redirectUri ?? "",
            state: state ?? "",
            codeChallenge: codeChallenge ?? "",
            error: "Invalid token. Try again.",
          }),
        );
        return;
      }

      const code = beginAuthorization({ clientId, redirectUri, codeChallenge });
      const redirect = new URL(redirectUri);
      redirect.searchParams.set("code", code);
      if (state) redirect.searchParams.set("state", state);
      res.writeHead(302, { Location: redirect.toString() });
      res.end();
      return;
    }

    // --- Token endpoint -------------------------------------------------------
    if (url.pathname === TOKEN_PATH && method === "POST") {
      const raw = await readBody(req);
      const form = parseFormBody(raw);

      if (form.grant_type === "authorization_code") {
        const result = exchangeAuthorizationCode({
          code: form.code ?? "",
          redirectUri: form.redirect_uri ?? "",
          codeVerifier: form.code_verifier ?? "",
        });
        if (!result) {
          sendJson(res, 400, { error: "invalid_grant" }, CORS_HEADERS);
          return;
        }
        sendJson(
          res,
          200,
          {
            access_token: result.accessToken,
            token_type: "Bearer",
            expires_in: result.expiresInSeconds,
            refresh_token: result.refreshToken,
          },
          CORS_HEADERS,
        );
        return;
      }

      if (form.grant_type === "refresh_token") {
        const result = exchangeRefreshToken(form.refresh_token ?? "");
        if (!result) {
          sendJson(res, 400, { error: "invalid_grant" }, CORS_HEADERS);
          return;
        }
        sendJson(
          res,
          200,
          {
            access_token: result.accessToken,
            token_type: "Bearer",
            expires_in: result.expiresInSeconds,
            refresh_token: result.refreshToken,
          },
          CORS_HEADERS,
        );
        return;
      }

      sendJson(res, 400, { error: "unsupported_grant_type" }, CORS_HEADERS);
      return;
    }

    if (url.pathname !== MCP_PATH) {
      sendJson(res, 404, {
        error: "not_found",
        message: `No route for ${method} ${url.pathname}. MCP endpoint is ${MCP_PATH}.`,
      });
      return;
    }

    if (!isAuthorized(req, authToken)) {
      sendJson(res, 401, { error: "unauthorized", message: "Missing or invalid Bearer token." }, {
        "WWW-Authenticate": `Bearer resource_metadata="${baseUrl(req)}${RESOURCE_METADATA_PATH}"`,
      });
      return;
    }

    // Stateless mode: a fresh server + transport per request, per MCP SDK guidance.
    try {
      const mcpServer = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        transport.close();
        mcpServer.close();
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error("Error handling MCP request:", err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal_error", message: "Failed to handle MCP request." });
      }
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, resolve));
  console.error(`bip-mcp-server listening on :${port} (MCP endpoint: ${MCP_PATH}, health: ${HEALTH_PATH})`);
}
