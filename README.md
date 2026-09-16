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
