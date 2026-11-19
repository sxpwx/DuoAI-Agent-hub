import * as crypto from "crypto";
import * as http from "http";
import { AddressInfo } from "net";
import { rec, str } from "./guards";

/**
 * 通用 OAuth2 PKCE 授权（浏览器弹窗 + 本地回环回调），
 * 与千问办公设备流同体验：选择 Agent → 弹窗 → 浏览器授权 → 自动回传令牌。
 * 流程参数来自各官方 CLI 的公开实现（Claude Code / Codex）。
 */
export interface OAuthProvider {
  id: string;
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  scope: string;
  callbackPath: string;
  extraAuthorize?: Record<string, string>;
}

export const OAUTH_PROVIDERS: Record<string, OAuthProvider> = {
  anthropic: {
    id: "anthropic",
    authorizeUrl: "https://claude.ai/oauth/authorize",
    tokenUrl: "https://console.anthropic.com/v1/oauth/token",
    clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    scope: "org:create_api_key user:profile user:inference",
    callbackPath: "/callback",
    extraAuthorize: { code: "true" },
  },
  openai: {
    id: "openai",
    authorizeUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    scope: "openid profile email offline_access",
    callbackPath: "/auth/callback",
    extraAuthorize: { id_token_add_organizations: "true", codex_cli_simplified_flow: "true" },
  },
};

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** 启动授权：打开浏览器并等待本地回调，返回令牌 */
export function oauthAuthorize(
  providerId: string,
  onUrl: (url: string) => void,
  isCancelled: () => boolean,
  timeoutMs = 5 * 60 * 1000
): Promise<OAuthTokens> {
  const p = OAUTH_PROVIDERS[providerId];
  return new Promise((resolve, reject) => {
    const verifier = b64url(crypto.randomBytes(64));
    const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
    const state = b64url(crypto.randomBytes(24));
    let settled = false;
    let server: http.Server | null = null;
    let timer: number | null = null;
    let poll: number | null = null;

    const finish = (err: Error | null, tokens?: OAuthTokens) => {
      if (settled) return;
      settled = true;
      if (timer !== null) window.clearTimeout(timer);
      if (poll !== null) window.clearInterval(poll);
      server?.close();
      if (err) reject(err);
      else resolve(tokens!);
    };

    server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://localhost");
      if (u.pathname !== p.callbackPath) {
        res.writeHead(404).end();
        return;
      }
      const code = u.searchParams.get("code");
      const st = u.searchParams.get("state");
      const err = u.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><body><h3>Authorization received / 已收到授权</h3><p>You can close this tab and return to Obsidian. / 可关闭此页返回 Obsidian。</p></body></html>");
      if (err) return finish(new Error(`OAuth error: ${err}`));
      if (!code || st !== state) return finish(new Error("OAuth state mismatch / 状态校验失败"));
      exchange(p, code, verifier, state, u.origin ?? `http://localhost:${(server!.address() as AddressInfo).port}`)
        .then((t) => finish(null, t))
        .catch((e) => finish(e));
    });

    server.on("error", (e) => finish(e instanceof Error ? e : new Error(String(e))));
    server.listen(0, "127.0.0.1", () => {
      const port = (server!.address() as AddressInfo).port;
      const redirect = `http://localhost:${port}${p.callbackPath}`;
      const q = new URLSearchParams({
        client_id: p.clientId,
        response_type: "code",
        redirect_uri: redirect,
        scope: p.scope,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        ...(p.extraAuthorize ?? {}),
      });
      onUrl(`${p.authorizeUrl}?${q.toString()}`);
      timer = window.setTimeout(() => finish(new Error("OAuth timeout (5 min) / 授权超时（5 分钟）")), timeoutMs);
      poll = window.setInterval(() => {
        if (isCancelled()) finish(new Error("cancelled"));
      }, 500);
    });
  });
}

async function exchange(p: OAuthProvider, code: string, verifier: string, state: string, redirect: string): Promise<OAuthTokens> {
  const r = await fetch(p.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: p.clientId,
      code_verifier: verifier,
      state,
    }),
  });
  const j = rec(await r.json().catch(() => ({})));
  if (!r.ok || !j.access_token) throw new Error(`OAuth token exchange failed / 令牌交换失败 HTTP ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return {
    accessToken: str(j.access_token),
    refreshToken: str(j.refresh_token),
    expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000,
  };
}

/** 刷新令牌 */
export async function oauthRefresh(providerId: string, refreshToken: string): Promise<OAuthTokens> {
  const p = OAUTH_PROVIDERS[providerId];
  const r = await fetch(p.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: p.clientId }),
  });
  const j = rec(await r.json().catch(() => ({})));
  if (!r.ok || !j.access_token) throw new Error(`OAuth refresh failed / 刷新失败 HTTP ${r.status}`);
  return {
    accessToken: str(j.access_token),
    refreshToken: typeof j.refresh_token === "string" ? j.refresh_token : refreshToken,
    expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000,
  };
}