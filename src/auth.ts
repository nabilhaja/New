import { getBipEnv, getBipScope, requireEnv } from "./env.js";

const PRODUCTION_TOKEN_URL = "https://oidc.bipintelligence.com/oauth2/token";
const SANDBOX_DISCOVERY_URL =
  "https://sandbox.oidc.bipintelligence.com/.well-known/openid-configuration";

const SANDBOX_CLIENT_ID = "open-api-sandbox";
const SANDBOX_CLIENT_SECRET = "open-api-sandbox-secret";

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;
let cachedSandboxTokenUrl: string | null = null;

async function resolveTokenUrl(): Promise<string> {
  if (getBipEnv() === "production") {
    return PRODUCTION_TOKEN_URL;
  }
  if (cachedSandboxTokenUrl) {
    return cachedSandboxTokenUrl;
  }
  const res = await fetch(SANDBOX_DISCOVERY_URL);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch sandbox OIDC discovery document (${res.status}): ${await res.text()}`,
    );
  }
  const config = (await res.json()) as { token_endpoint?: string };
  if (!config.token_endpoint) {
    throw new Error("Sandbox OIDC discovery document did not include a token_endpoint");
  }
  cachedSandboxTokenUrl = config.token_endpoint;
  return cachedSandboxTokenUrl;
}

function resolveClientCredentials(): { clientId: string; clientSecret: string } {
  if (getBipEnv() === "sandbox") {
    return { clientId: SANDBOX_CLIENT_ID, clientSecret: SANDBOX_CLIENT_SECRET };
  }
  return {
    clientId: requireEnv("BIP_CLIENT_ID"),
    clientSecret: requireEnv("BIP_CLIENT_SECRET"),
  };
}

/**
 * Fetches (and caches) an OAuth2 access token via the client_credentials grant.
 * Tokens are re-used until ~30s before their reported expiry.
 */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 30_000 > now) {
    return cachedToken.accessToken;
  }

  const tokenUrl = await resolveTokenUrl();
  const { clientId, clientSecret } = resolveClientCredentials();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: getBipScope(),
    }),
  });

  if (!res.ok) {
    throw new Error(`BiP token request failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as TokenResponse;
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return cachedToken.accessToken;
}
