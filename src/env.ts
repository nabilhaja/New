import "dotenv/config";

export type BipEnv = "sandbox" | "production";

export function getBipEnv(): BipEnv {
  return process.env.BIP_ENV === "sandbox" ? "sandbox" : "production";
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Set it in your .env file (see .env.example).`,
    );
  }
  return value;
}

export function getBipScope(): string {
  return process.env.BIP_SCOPE ?? "OPENAPI_NOTICES OPENAPI_AWARDS OPENAPI_SPEND";
}
