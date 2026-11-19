import { spawn, ChildProcess } from "child_process";
import { CliAgentSpec } from "../types";
import { resolveCli } from "./detect";

/** 查询 CLI 登录状态：true 已登录 / false 未登录 / null 无法判断 */
export function checkLogin(spec: CliAgentSpec, cliPath: string, env?: Record<string, string>): Promise<boolean | null> {
  return new Promise((resolve) => {
    if (!spec.login) return resolve(null);
    if (spec.login.custom === "codebuddy-daemon") {
      import("./codebuddy-auth").then((m) => m.codebuddyAuthStatus()).then(resolve).catch(() => resolve(null));
      return;
    }
    const resolved = resolveCli(cliPath);
    if (!resolved) return resolve(null);
    let child: ChildProcess;
    try {
      child = spawn(resolved.exe, [...resolved.prefixArgs, ...spec.login.statusArgs], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...resolved.env, ...(env ?? {}) },
      });
    } catch {
      return resolve(null);
    }
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 20000);
    child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(spec.login!.parse(out));
    });
  });
}

export interface LoginProcess {
  child: ChildProcess;
  /** 进程结束（code + 输出尾部） */
  done: Promise<{ code: number | null; output: string }>;
  kill: () => void;
}

/** 启动 CLI 登录子命令（CLI 会自动打开浏览器授权页） */
export function startLogin(
  spec: CliAgentSpec,
  cliPath: string,
  onLine: (line: string) => void,
  env?: Record<string, string>
): LoginProcess | null {
  if (!spec.login) return null;
  const resolved = resolveCli(cliPath);
  if (!resolved) return null;
  let child: ChildProcess;
  try {
    child = spawn(resolved.exe, [...resolved.prefixArgs, ...spec.login.loginArgs], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...resolved.env, ...(env ?? {}) },
    });
  } catch {
    return null;
  }
  let output = "";
  const feed = (d: Buffer) => {
    const s = d.toString();
    output += s;
    if (output.length > 6000) output = output.slice(-6000);
    for (const line of s.split(/\r?\n/)) {
      if (line.trim()) onLine(line.trim());
    }
  };
  child.stdout?.on("data", feed);
  child.stderr?.on("data", feed);
  if (spec.login.stdinLine) {
    try {
      child.stdin?.write(spec.login.stdinLine + "\n");
      // 保持 stdin 打开，REPL 需要持续会话
    } catch {
      /* ignore */
    }
  } else {
    try {
      child.stdin?.end();
    } catch {
      /* ignore */
    }
  }
  const done = new Promise<{ code: number | null; output: string }>((resolve) => {
    child.on("error", (e: any) => resolve({ code: -1, output: String(e?.message ?? e) }));
    child.on("close", (code) => resolve({ code, output }));
  });
  return {
    child,
    done,
    kill: () => {
      if (process.platform === "win32" && child.pid) {
        try {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        } catch {
          /* ignore */
        }
      } else {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      }
    },
  };
}