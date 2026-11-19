import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { requestUrl } from "obsidian";
import { COSY_SITES, CosyCred } from "./qwenwork-chat";
import { t } from "../i18n";
import { rec, str } from "./guards";

/**
 * COSY 站点（千问办公 / Qoder CN）登录：PKCE 设备流 + PAT 交换。
 * 协议移植自 MIT 社区实现 @magpie-community/opencode-qoder-auth。
 * 凭据保存在 ~/.local/share/opencode/auth.json（沿用历史位置，按站点 id 键控）。
 */
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function authFile(): string {
  return path.join(os.homedir(), ".local", "share", "opencode", "auth.json");
}

function clientHeaders(siteId: string): Record<string, string> {
  if (siteId !== "qwenwork") return { Accept: "application/json" };
  return {
    Accept: "application/json",
    "User-Agent": "qoderwork/2.1.0",
    "X-Request-Id": crypto.randomUUID(),
    "X-QwenWork-Version": "2.1.0",
    "X-QwenWork-Release-Version": "2.1.0-26111801",
    "X-QwenWork-Build": "26111801",
    "X-QwenWork-Platform": process.platform,
    "X-QwenWork-Arch": process.arch,
    "X-QwenWork-Channel": "stable",
  };
}

function deviceExpiry(dt: unknown): number {
  const d = rec(dt);
  const at = Date.parse(String(d.expires_at ?? "").trim());
  if (!isNaN(at)) return at;
  const ei = Number(d.expires_in);
  if (ei > 0) return Date.now() + ei * 1000;
  return Date.now() + 24 * 3600 * 1000;
}

async function openapi(siteId: string, p: string, opts: { method?: string; token?: string; body?: unknown; query?: Record<string, string> } = {}) {
  const site = COSY_SITES[siteId];
  const url = new URL(site.openapi + p);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { ...clientHeaders(siteId) };
  if (opts.body) headers["Content-Type"] = "application/json";
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const r = await requestUrl({
    url: url.toString(),
    method: opts.method ?? "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    throw: false,
  });
  return { status: r.status, json: r.json as unknown, text: r.text };
}

/** 设备流登录：回调授权 URL（调用方打开浏览器），轮询直至成功/超时/取消 */
export async function cosyDeviceLogin(
  siteId: string,
  onUrl: (url: string) => void,
  isCancelled: () => boolean,
  timeoutMs = 5 * 60 * 1000
): Promise<CosyCred> {
  const site = COSY_SITES[siteId];
  const verifier = b64url(crypto.randomBytes(64));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const nonce = crypto.randomUUID();
  const machineId = crypto.randomUUID();
  const q = new URLSearchParams({
    challenge,
    challenge_method: "S256",
    nonce,
    machine_id: machineId,
    client_id: site.clientId,
  });
  if (site.redirect) q.set("redirect_uri", site.redirect);
  onUrl(`${site.openapi}/device/selectAccounts?${q.toString()}`);

  const until = Date.now() + timeoutMs;
  let dt: Record<string, unknown> | null = null;
  while (Date.now() < until) {
    if (isCancelled()) throw new Error(t("loginCancelled"));
    try {
      const r = await openapi(siteId, "/api/v1/deviceToken/poll", { query: { nonce, verifier, challenge_method: "S256" } });
      const j = rec(r.json);
      if (r.status === 200 && String(j.token ?? "").trim()) {
        dt = j;
        break;
      }
    } catch {
      /* 网络抖动：继续轮询 */
    }
    await new Promise((r) => window.setTimeout(r, 2000));
  }
  if (!dt) throw new Error(t("loginTimeout"));

  // Qoder CN 优先换 job token；千问办公设备令牌即聊天令牌
  let access = str(dt.token);
  let refresh = str(dt.refresh_token);
  let expires = deviceExpiry(dt);
  if (!site.deviceOnly) {
    try {
      const jr = await openapi(siteId, "/api/v1/me/jobToken", { method: "POST", token: str(dt.token), body: { clientId: site.clientId } });
      const jj = rec(jr.json);
      if (jr.status === 200 && String(jj.token ?? "").trim()) {
        access = str(jj.token);
        refresh = str(jj.refresh_token ?? refresh);
        expires = deviceExpiry(jj);
      }
    } catch {
      /* 回退设备令牌 */
    }
  }

  let uid: unknown = dt.user_id;
  let email = "";
  let name = "";
  try {
    const ui = await openapi(siteId, site.userInfoPath, { token: str(dt.token) });
    if (ui.status >= 200 && ui.status < 300) {
      const uj = rec(ui.json);
      const base = uj.data ?? uj;
      const user = rec(rec(base).user ?? base);
      email = str(user.email);
      name = str(user.name);
      uid = String(user.id ?? user.user_id ?? user.uid ?? uid ?? "") || undefined;
    }
  } catch {
    /* 用户信息可选 */
  }
  if (!String(uid ?? "").trim()) throw new Error(t("loginNoUid"));

  const cred: CosyCred = {
    type: "oauth",
    access,
    refresh,
    expires,
    deviceChat: !!site.deviceOnly,
    accountId: email || uid || name || dt.user_id,
    uid,
    email,
    name: name || str(dt.user_name),
    machineId,
    deviceToken: dt.token,
    deviceRefresh: str(dt.refresh_token),
  } as CosyCred;
  writeCosyCred(siteId, cred);
  return cred;
}

/** PAT 登录（Qoder CN）：Personal Access Token 交换 job token */
export async function cosyPatLogin(siteId: string, pat: string): Promise<CosyCred> {
  const site = COSY_SITES[siteId];
  const r = await openapi(siteId, "/api/v1/jobToken/exchange", { method: "POST", body: { personal_token: pat } });
  if (r.status !== 200) throw new Error(t("patExchangeFail", { agent: site.name, status: r.status }));
  const j = rec(r.json);
  const token = String(j.token ?? j.job_token ?? "").trim();
  if (!token) throw new Error(t("patEmpty"));
  let uid = "";
  let email = "";
  let name = "";
  try {
    const ui = await openapi(siteId, "/api/v1/userinfo", { token });
    if (ui.status >= 200 && ui.status < 300) {
      const uj = rec(ui.json);
      email = str(uj.email);
      name = str(uj.name);
      uid = String(uj.id ?? uj.user_id ?? uj.uid ?? "");
    }
  } catch {
    /* 可选 */
  }
  if (!uid) throw new Error(t("patNoUid"));
  const cred: CosyCred = {
    type: "oauth",
    access: token,
    refresh: String(j.refresh_token ?? ""),
    expires: deviceExpiry(j),
    accountId: email || uid,
    uid,
    email,
    name,
    machineId: crypto.randomUUID(),
    deviceToken: "",
    deviceRefresh: "",
    patAuth: true,
    pat,
  } as CosyCred;
  writeCosyCred(siteId, cred);
  return cred;
}

export function readCosyCred(siteId: string): CosyCred | null {
  try {
    const all = rec(JSON.parse(fs.readFileSync(authFile(), "utf8")));
    const cv = all[siteId];
    if (!cv) return null;
    const c = rec(cv);
    const v1 = rec(rec(c.metadata).v1 ?? c);
    if (!v1.access || !v1.uid || !v1.machineId) return null;
    return v1 as CosyCred;
  } catch {
    return null;
  }
}

export function writeCosyCred(siteId: string, cred: CosyCred): void {
  const file = authFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let all: Record<string, unknown> = {};
  try {
    all = rec(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    /* 新建 */
  }
  all[siteId] = { ...cred, metadata: { v1: cred } };
  fs.writeFileSync(file, JSON.stringify(all, null, 2), "utf8");
}

/** 修复历史写入的仅 2.x 形态凭据 */
export function repairLegacyCreds(): void {
  try {
    const file = authFile();
    const all = rec(JSON.parse(fs.readFileSync(file, "utf8")));
    let changed = false;
    for (const k of Object.keys(all)) {
      const c = rec(all[k]);
      const v1 = rec(c.metadata).v1;
      if (v1 && !c.uid && rec(v1).uid) {
        all[k] = { ...rec(v1), ...c, metadata: { v1 } };
        changed = true;
      }
    }
    if (changed) fs.writeFileSync(file, JSON.stringify(all, null, 2), "utf8");
  } catch {
    /* ignore */
  }
}

/** 读取本机 Claude Code 的 OAuth 登录态（若存在） */
export function readClaudeLocalOAuth(): string | null {
  try {
    const j = rec(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", ".credentials.json"), "utf8")));
    const tk = rec(j.claudeAiOauth).accessToken;
    return typeof tk === "string" && tk ? tk : null;
  } catch {
    return null;
  }
}