import { createHash, randomBytes } from "node:crypto";

/**
 * Minimal OAuth 2.1 authorization server (RFC 8414, RFC 7591, PKCE) so MCP
 * clients that require OAuth discovery (e.g. claude.ai custom connectors)
 * can connect. This is a single-user server: the "login" step just checks
 * the caller supplied MCP_AUTH_TOKEN, then mints short-lived opaque access
 * tokens (and longer-lived refresh tokens) for actual API use.
 *
 * All state is in-memory and reset on restart — acceptable for a personal
 * single-user deployment; re-authorize if the server restarts.
 */

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const AUTH_CODE_TTL_MS = 2 * 60 * 1000; // 2 minutes

interface AuthCode {
  codeChallenge: string;
  redirectUri: string;
  clientId: string;
  expiresAt: number;
}

interface TokenRecord {
  expiresAt: number;
}

const registeredClients = new Set<string>();
const authCodes = new Map<string, AuthCode>();
const accessTokens = new Map<string, TokenRecord>();
const refreshTokens = new Map<string, TokenRecord>();

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const hash = createHash("sha256").update(codeVerifier).digest();
  return base64url(hash) === codeChallenge;
}

export function registerClient(): string {
  const clientId = randomToken(16);
  registeredClients.add(clientId);
  return clientId;
}

export function beginAuthorization(params: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
}): string {
  const code = randomToken(32);
  authCodes.set(code, {
    codeChallenge: params.codeChallenge,
    redirectUri: params.redirectUri,
    clientId: params.clientId,
    expiresAt: Date.now() + AUTH_CODE_TTL_MS,
  });
  return code;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

function issueTokenPair(): IssuedTokens {
  const accessToken = randomToken(32);
  const refreshToken = randomToken(32);
  const now = Date.now();
  accessTokens.set(accessToken, { expiresAt: now + ACCESS_TOKEN_TTL_MS });
  refreshTokens.set(refreshToken, { expiresAt: now + REFRESH_TOKEN_TTL_MS });
  return { accessToken, refreshToken, expiresInSeconds: ACCESS_TOKEN_TTL_MS / 1000 };
}

export function exchangeAuthorizationCode(params: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): IssuedTokens | null {
  const entry = authCodes.get(params.code);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    authCodes.delete(params.code);
    return null;
  }
  if (entry.redirectUri !== params.redirectUri) return null;
  if (!verifyPkce(params.codeVerifier, entry.codeChallenge)) return null;
  authCodes.delete(params.code); // one-time use, only on success
  return issueTokenPair();
}

export function exchangeRefreshToken(refreshToken: string): IssuedTokens | null {
  const entry = refreshTokens.get(refreshToken);
  if (!entry || entry.expiresAt < Date.now()) return null;
  refreshTokens.delete(refreshToken); // rotate
  return issueTokenPair();
}

export function isValidAccessToken(token: string): boolean {
  const entry = accessTokens.get(token);
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) {
    accessTokens.delete(token);
    return false;
  }
  return true;
}
