import { randomBytes } from "node:crypto";
import type { AppConfig } from "../../config.js";
import { prisma } from "../../db.js";
import { encryptSecret } from "../../lib/secret-crypto.js";
import { AppError } from "../../lib/errors.js";

type ProviderConfig = { authorizeUrl: string; tokenUrl: string; clientId: string; clientSecret: string; redirectUri: string; scopes: string[] };

/** 配置驱动的 OAuth 服务；平台审核通过后只需填 provider 配置和 token 解析器。 */
export function createOAuthService({ config, tokenKey, providers }: { config: AppConfig; tokenKey: Buffer | null; providers: Record<string, ProviderConfig> }) {
  function getProvider(platform: string) {
    const provider = providers[platform];
    if (!provider?.authorizeUrl || !provider.tokenUrl || !provider.clientId || !provider.clientSecret) throw new AppError(`${platform} OAuth 尚未配置。`, "OAUTH_NOT_CONFIGURED", 503);
    return provider;
  }

  async function start({ userId, platform }: { userId: string; platform: string }) {
    const provider = getProvider(platform);
    const state = randomBytes(32).toString("base64url");
    await prisma.oAuthState.create({ data: { state, userId, platform, redirectUri: provider.redirectUri, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });
    const url = new URL(provider.authorizeUrl);
    url.searchParams.set("client_id", provider.clientId);
    url.searchParams.set("redirect_uri", provider.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    if (provider.scopes.length) url.searchParams.set("scope", provider.scopes.join(" "));
    return { authorizationUrl: url.toString(), state };
  }

  async function callback({ platform, code, state }: { platform: string; code: string; state: string }) {
    const provider = getProvider(platform);
    const oauthState = await prisma.oAuthState.findUnique({ where: { state } });
    if (!oauthState || oauthState.platform !== platform || oauthState.consumedAt || oauthState.expiresAt < new Date()) throw new AppError("OAuth state 无效或已过期。", "OAUTH_STATE_INVALID", 400);
    const response = await fetch(provider.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: provider.clientId, client_secret: provider.clientSecret, redirect_uri: provider.redirectUri }) });
    const raw = await response.text();
    const data = parseJson(raw);
    if (!response.ok) throw new AppError(data?.error_description || "OAuth token exchange 失败。", "OAUTH_TOKEN_EXCHANGE_FAILED", 502, data);
    await prisma.$transaction(async (tx: any) => {
      await tx.oAuthState.update({ where: { id: oauthState.id }, data: { consumedAt: new Date() } });
      await tx.platformConnection.upsert({
        where: { userId_platform: { userId: oauthState.userId, platform } },
        create: { userId: oauthState.userId, platform, accessTokenCiphertext: encryptSecret(data.access_token, tokenKey), refreshTokenCiphertext: data.refresh_token ? encryptSecret(data.refresh_token, tokenKey) : null, expiresAt: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000) : null, scopes: data.scope ? String(data.scope).split(" ") : [] },
        update: { accessTokenCiphertext: encryptSecret(data.access_token, tokenKey), refreshTokenCiphertext: data.refresh_token ? encryptSecret(data.refresh_token, tokenKey) : null, expiresAt: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000) : null, status: "ACTIVE", scopes: data.scope ? String(data.scope).split(" ") : [] }
      });
    });
    return { userId: oauthState.userId, platform, connected: true };
  }

  return { start, callback };
}

function parseJson(raw: string): any { try { return JSON.parse(raw); } catch { return { raw }; } }
