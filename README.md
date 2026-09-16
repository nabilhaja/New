# bip-mcp-server

An MCP (Model Context Protocol) server that exposes the [BiP Intelligence
Platform](https://app.bipintelligence.com) Open API — UK public-sector tender
notices, contract awards, and spend data — as tools for LLM clients (Claude
Desktop, Claude Code, etc.).

## Tools

| Tool | API call | Scope |
|---|---|---|
| `bip_search_notices` | `POST /notices` | `OPENAPI_NOTICES` |
| `bip_get_notice` | `GET /notices/{id}` | `OPENAPI_NOTICES` |
| `bip_search_awards` | `POST /awards` | `OPENAPI_AWARDS` |
| `bip_get_award` | `GET /awards/{id}` | `OPENAPI_AWARDS` |
| `bip_list_spend_buyers` | `GET /spend/buyers` | `OPENAPI_SPEND` |
| `bip_list_spend_suppliers` | `GET /spend/suppliers` | `OPENAPI_SPEND` |
| `bip_search_spend_transactions` | `POST /spend/transactions` | `OPENAPI_SPEND` |

Search tools accept a few common named filters plus a free-form `criteria`
object for any other field documented in the [Swagger
spec](https://app.bipintelligence.com/open-api/swagger-ui/index.html).

## Setup

```bash
npm install
cp .env.example .env
npm run build
```

By default `.env` is set to `BIP_ENV=sandbox`, which uses BiP's shared
sandbox client (`open-api-sandbox`) against mocked data and **does not use
your daily API quota** — good for verifying the server works before pointing
it at production.

To use your real account, generate an access token as the Primary/Admin user
on the **Open API** page in the BiP Platform, then set in `.env`:

```
BIP_ENV=production
BIP_CLIENT_ID=<your client id>
BIP_CLIENT_SECRET=<your client secret>
```

The client secret is shown only once at generation time — store it securely.
`.env` is git-ignored; never commit real credentials.

Note: **Open API Core accounts are limited to 10 successful calls/day** in
production. Each tool response includes the `X-Rate-Limit-Remaining` header
value so you can track remaining quota.

## Running

```bash
npm start
```

This starts the server on stdio, per the MCP spec. Point your MCP client
(e.g. Claude Desktop's `claude_desktop_config.json`) at it:

```json
{
  "mcpServers": {
    "bip": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {
        "BIP_ENV": "production",
        "BIP_CLIENT_ID": "...",
        "BIP_CLIENT_SECRET": "..."
      }
    }
  }
}
```

## How auth works

The server uses OAuth2 `client_credentials`: on first tool call it requests
an access token from `https://oidc.bipintelligence.com/oauth2/token` (or the
sandbox equivalent, discovered via
`https://sandbox.oidc.bipintelligence.com/.well-known/openid-configuration`),
caches it in memory, and automatically re-requests a new one shortly before
it expires (tokens are valid ~15 minutes). No token is ever written to disk.

## Running as a hosted server (Streamable HTTP)

By default the server speaks MCP over stdio, for clients that launch it as a
local subprocess. To expose it over the network at a real URL instead, set
`MCP_TRANSPORT=http` — this switches it to the
[Streamable HTTP](https://modelcontextprotocol.io/docs/concepts/transports#streamable-http)
transport, serving the MCP endpoint at `POST /mcp` and a health check at
`GET /healthz`.

Since this hands out access to your BiP credentials and their **10
calls/day** production quota, the HTTP mode requires a bearer token:
requests must include `Authorization: Bearer <MCP_AUTH_TOKEN>`, or they're
rejected with 401 before touching BiP at all. Generate one with
`openssl rand -hex 32` and keep it secret — it's your server's only access
control.

```bash
MCP_TRANSPORT=http MCP_AUTH_TOKEN=<random secret> npm start
```

### Deploying to Render

This repo includes a `Dockerfile` and `render.yaml` [Blueprint](https://render.com/docs/blueprint-spec)
for a one-click deploy on Render's free tier:

1. Push this repo to GitHub (already done if you're reading this from there).
2. In the Render dashboard: **New > Blueprint**, point it at this repo.
3. Render reads `render.yaml` and provisions a web service automatically. Fill
   in the secret env vars it prompts for: `MCP_AUTH_TOKEN`, and (if not using
   the sandbox) `BIP_CLIENT_ID` / `BIP_CLIENT_SECRET`.
4. Once deployed, your MCP server's URL is `https://<service-name>.onrender.com/mcp`.

Point a remote MCP client at that URL with header
`Authorization: Bearer <your MCP_AUTH_TOKEN>`.

Free-tier Render services spin down after inactivity and take a few seconds
to cold-start on the next request — fine for occasional use, not for
latency-sensitive workloads. Upgrade the plan in `render.yaml` if that
matters for your use case.

### Connecting from claude.ai / Claude Desktop (custom connector)

Claude's custom connector UI requires the server to support OAuth 2.1
discovery — it won't accept a bare bearer token pasted into a field. This
server implements the minimal pieces needed for that (RFC 8414 metadata,
RFC 7591 dynamic client registration, and an authorization-code + PKCE
flow), so you don't need to fill in the "Use your own OAuth client" form at
all:

1. In Claude: **Settings > Connectors > Add custom connector**.
2. Enter your server's MCP URL: `https://<service-name>.onrender.com/mcp`.
3. Claude auto-discovers the OAuth endpoints and registers itself as a
   client — you shouldn't see a manual client ID/secret screen.
4. You'll land on a login page asking for a token — enter your
   `MCP_AUTH_TOKEN` there (this is a one-time login step, not per-request).
5. Claude exchanges that for a short-lived access token (1 hour) and a
   refresh token (90 days) and stores them itself; you won't need to touch
   `MCP_AUTH_TOKEN` again unless the server restarts and you want to
   re-authorize sooner.

Note: OAuth state (issued codes/tokens, registered clients) is kept
in-memory only, so a server restart (e.g. a Render redeploy) invalidates
any in-flight authorization and requires reconnecting the connector. Your
raw `MCP_AUTH_TOKEN` env var itself is unaffected by restarts.
