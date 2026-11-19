import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn, spawnSync } from "child_process";
import { resolveCli, whichSync } from "./detect";
import { rec, str } from "./guards";

/**
 * WorkBuddy（codebuddy）应用内一键登录：
 * 通过官方守护进程本地 HTTP 接口发起浏览器授权并轮询结果，
 * 凭据由守护进程写入官方凭据存储，CLI 推理直接复用。无需手动终端。
 */
function cliPath(): string | null {
  const p = whichSync("codebuddy");
  if (p) return p;
  const roots = [
    process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
    path.join(os.homedir(), "AppData", "Roaming"),
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
  ];
  for (const r of roots) {
    const bin = path.join(r, "npm", "node_modules", "@tencent-ai", "codebuddy-code", "bin", "codebuddy");
    if (fs.existsSync(bin)) return bin;
  }
  const wb = path.join(os.homedir(), ".workbuddy", "bin", "codebuddy");
  return fs.existsSync(wb) ? wb : null;
}

function gatewayPassword(): string | null {
  try {
    const j = rec(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".codebuddy", "settings.json"), "utf8")));
    const pw = rec(j.gateway).password;
    return typeof pw === "string" && pw ? pw : null;
  } catch {
    return null;
  }
}

function runCli(args: string[], timeoutMs = 30000): string {
  const cli = cliPath();
  if (!cli) return "";
  const resolved = resolveCli(cli);
  if (!resolved) return "";
  const r = spawnSync(resolved.exe, [...resolved.prefixArgs, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    env: { ...process.env, ...resolved.env },
  });
  return (r.stdout ?? "") + (r.stderr ?? "");
}

/** 获取守护进程 endpoint；未运行则启动 */
export function ensureDaemon(): string | null {
  const status = runCli(["daemon", "status"]);
  try {
    const j = rec(JSON.parse(status.slice(status.indexOf("{"))));
    if (j.status === "running" && j.endpoint) return str(j.endpoint);
  } catch {
    /* fallthrough */
  }
  const out = runCli(["daemon", "start"], 60000);
  const m = out.match(/https?:\/\/127\.0\.0\.1:\d+/);
  if (m) return m[0];
  try {
    const j = rec(JSON.parse(runCli(["daemon", "status"]).slice(status.indexOf("{"))));
    if (j.status === "running" && j.endpoint) return str(j.endpoint);
  } catch {
    /* ignore */
  }
  return null;
}

function headers(pw: string): Record<string, string> {
  return { Authorization: `Bearer ${pw}`, "x-codebuddy-request": "1", "Content-Type": "application/json" };
}

/** 登录态：true 已登录 / false 未登录 / null 无法判断 */
export async function codebuddyAuthStatus(): Promise<boolean | null> {
  const pw = gatewayPassword();
  if (!pw) return null;
  const status = runCli(["daemon", "status"]);
  let endpoint: string | null = null;
  try {
    const j = rec(JSON.parse(status.slice(status.indexOf("{"))));
    if (j.status === "running" && j.endpoint) endpoint = str(j.endpoint);
  } catch {
    /* ignore */
  }
  if (!endpoint) return false;
  try {
    const r = await fetch(endpoint + "/api/v1/auth/account/status", { headers: headers(pw), signal: AbortSignal.timeout(8000) });
    const j = rec(await r.json());
    const d = rec(j.data);
    if (d.authenticated === true) return true;
    if (d.authenticated === false) return false;
    return null;
  } catch {
    return null;
  }
}

/** 仅发起授权，返回浏览器授权 URL（不轮询）。method: internal=国内站 / external=国际站 */
export async function codebuddyStartLogin(method = "internal"): Promise<string> {
  const endpoint = ensureDaemon();
  if (!endpoint) throw new Error("无法启动 codebuddy 守护进程 / cannot start codebuddy daemon");
  const pw = gatewayPassword();
  if (!pw) throw new Error("缺少守护进程凭据（settings.json gateway.password）/ missing daemon gateway password");
  const r = await fetch(endpoint + "/api/v1/auth/account/login", {
    method: "POST",
    headers: headers(pw),
    body: JSON.stringify({ method }),
    signal: AbortSignal.timeout(30000),
  });
  const j = rec(await r.json().catch(() => ({})));
  const d = rec(j.data ?? j);
  if (!r.ok || d.success === false) throw new Error(`登录发起失败 / login start failed: ${JSON.stringify(j).slice(0, 200)}`);
  if (!d.authUrl) throw new Error("守护进程未返回授权 URL / daemon returned no authUrl");
  return str(d.authUrl);
}

/** 一键登录：发起授权 → 回调 URL（调用方打开浏览器）→ 轮询直至完成 */
export async function codebuddyLogin(
  onUrl: (url: string) => void,
  isCancelled: () => boolean,
  timeoutMs = 5 * 60 * 1000,
  method = "internal"
): Promise<void> {
  const endpoint = ensureDaemon();
  if (!endpoint) throw new Error("无法启动 codebuddy 守护进程 / cannot start codebuddy daemon");
  const pw = gatewayPassword();
  if (!pw) throw new Error("缺少守护进程凭据（settings.json gateway.password）/ missing daemon gateway password");
  const r = await fetch(endpoint + "/api/v1/auth/account/login", {
    method: "POST",
    headers: headers(pw),
    body: JSON.stringify({ method }),
    signal: AbortSignal.timeout(30000),
  });
  const j = rec(await r.json().catch(() => ({})));
  const d = rec(j.data ?? j);
  if (!r.ok || d.success === false) throw new Error(`登录发起失败 / login start failed: ${JSON.stringify(j).slice(0, 200)}`);
  if (d.authUrl) onUrl(str(d.authUrl));
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (isCancelled()) throw new Error("cancelled");
    await new Promise((res) => window.setTimeout(res, 2000));
    try {
      const s = await fetch(endpoint + "/api/v1/auth/account/status", { headers: headers(pw), signal: AbortSignal.timeout(8000) });
      const sj = rec(await s.json());
      const sd = rec(sj.data);
      if (sd.authenticated === true) return;
      if (typeof sd.loginError === "string" && sd.loginError) throw new Error(sd.loginError);
    } catch (e) {
      const em = rec(e).message;
      if (em && !/fetch|network|timeout|aborted/i.test(String(em))) throw e;
    }
  }
  throw new Error("登录超时（5 分钟）/ login timeout (5 min)");
}