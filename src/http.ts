import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createMcpServer } from "./server.js";
import { requireEnv } from "./env.js";

const MCP_PATH = "/mcp";
const HEALTH_PATH = "/healthz";

function isAuthorized(req: IncomingMessage, expectedToken: string): boolean {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return false;
  }
  return header.slice("Bearer ".length) === expectedToken;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

export async function runHttp(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const authToken = requireEnv("MCP_AUTH_TOKEN");

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === HEALTH_PATH) {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    if (url.pathname !== MCP_PATH) {
      sendJson(res, 404, {
        error: "not_found",
        message: `No route for ${req.method} ${url.pathname}. MCP endpoint is ${MCP_PATH}.`,
      });
      return;
    }

    if (!isAuthorized(req, authToken)) {
      sendJson(res, 401, {
        error: "unauthorized",
        message: "Missing or invalid Bearer token.",
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
