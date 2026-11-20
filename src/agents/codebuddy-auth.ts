import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { requestUrl } from "obsidian";
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

/** 异步查询守护进程 endpoint（不阻塞渲染线程） */
function daemonStatus(): Promise<string | null> {
  return new Promise((resolve) => {
    const cli = cliPath();
    const resolved = cli ? resolveCli(cli) : null;
    if (!resolved) return resolve(null);
    let out = "";
    let settled = false;
    const finish = (v: string | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const child = spawn(resolved.exe, [...resolved.prefixArgs, "daemon", "status"], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...resolved.env },
      });
      const timer = window.setTimeout(() => {
        child.kill();
        finish(null);
      }, 10000);
      child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
      child.on("error", () => {
        window.clearTimeout(timer);
        finish(null);
      });
      child.on("close", () => {
        window.clearTimeout(timer);
        try {
          const j = rec(JSON.parse(out.slice(out.indexOf("{"))));
          finish(j.status === "running" && j.endpoint ? str(j.endpoint) : null);
        } catch {
          finish(null);
        }
      });
    } catch {
      finish(null);
    }
  });
}

/** 直接探测本地认证服务（WorkBuddy 桌面版或守护进程均可提供） */
async function probeEndpoint(): Promise<string | null> {
  try {
    const r = await requestUrl({ url: "http://127.0.0.1:9527/api/v1/auth/status", throw: false });
    if (r.status === 200) return "http://127.0.0.1:9527";
  } catch {
    /* 未监听 */
  }
  return null;
}

/** 获取守护进程 endpoint；未运行则以 detached 方式启动并轮询等待 */
export async function ensureDaemon(): Promise<string | null> {
  const running = await daemonStatus();
  if (running) return running;
  const probed = await probeEndpoint();
  if (probed) return probed;
  const cli = cliPath();
  const resolved = cli ? resolveCli(cli) : null;
  if (!resolved) return null;
  try {
    const child = spawn(resolved.exe, [...resolved.prefixArgs, "daemon", "start"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, ...resolved.env },
    });
    child.unref();
  } catch {
    return null;
  }
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => window.setTimeout(r, 1000));
    const ep = (await daemonStatus()) ?? (await probeEndpoint());
    if (ep) return ep;
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
  const endpoint = (await daemonStatus()) ?? (await probeEndpoint());
  if (!endpoint) return false;
  try {
    const r = await requestUrl({ url: endpoint + "/api/v1/auth/account/status", headers: headers(pw), throw: false });
    const j = rec(r.json);
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
  const endpoint = await ensureDaemon();
  if (!endpoint) throw new Error("无法启动 codebuddy 守护进程 / cannot start codebuddy daemon");
  const pw = gatewayPassword();
  if (!pw) throw new Error("缺少守护进程凭据（settings.json gateway.password）/ missing daemon gateway password");
  const r = await requestUrl({
    url: endpoint + "/api/v1/auth/account/login",
    method: "POST",
    headers: headers(pw),
    body: JSON.stringify({ method }),
    throw: false,
  });
  let j: Record<string, unknown> = {};
  try {
    j = rec(JSON.parse(r.text));
  } catch {
    /* 非 JSON 响应 */
  }
  const d = rec(j.data ?? j);
  if (r.status < 200 || r.status >= 300 || d.success === false) throw new Error(`登录发起失败 / login start failed: ${JSON.stringify(j).slice(0, 200)}`);
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
  const endpoint = await ensureDaemon();
  if (!endpoint) throw new Error("无法启动 codebuddy 守护进程 / cannot start codebuddy daemon");
  const pw = gatewayPassword();
  if (!pw) throw new Error("缺少守护进程凭据（settings.json gateway.password）/ missing daemon gateway password");
  const r = await requestUrl({
    url: endpoint + "/api/v1/auth/account/login",
    method: "POST",
    headers: headers(pw),
    body: JSON.stringify({ method }),
    throw: false,
  });
  let j: Record<string, unknown> = {};
  try {
    j = rec(JSON.parse(r.text));
  } catch {
    /* 非 JSON 响应 */
  }
  const d = rec(j.data ?? j);
  if (r.status < 200 || r.status >= 300 || d.success === false) throw new Error(`登录发起失败 / login start failed: ${JSON.stringify(j).slice(0, 200)}`);
  if (d.authUrl) onUrl(str(d.authUrl));
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (isCancelled()) throw new Error("cancelled");
    await new Promise((res) => window.setTimeout(res, 2000));
    try {
      const s = await requestUrl({ url: endpoint + "/api/v1/auth/account/status", headers: headers(pw), throw: false });
      const sj = rec(s.json);
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