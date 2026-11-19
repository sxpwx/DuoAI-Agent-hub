import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/** 桌面 GUI 可执行文件不能作为 CLI 使用 */
export function isGuiExe(p: string): boolean {
  return /[\\/](WorkBuddy|QwenWorkCN|qianwen|Obsidian|Qoder CN)\.exe$/i.test(p);
}

export function whichSync(cmd: string): string | null {
  const finder = process.platform === "win32" ? "where.exe" : "which";
  const r = spawnSync(finder, [cmd], { encoding: "utf8", timeout: 8000, windowsHide: true });
  if (r.status !== 0 || !r.stdout) return null;
  const lines = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  // 优先 .exe / .cmd / 无扩展名脚本
  return lines.find((l) => /\.(exe|cmd|bat)$/i.test(l)) ?? lines[0] ?? null;
}

/** 千问办公：扫描逐版本安装目录下的 resources/bin/qoderclicn.exe */
export function detectQwenworkCli(): string | null {
  const env = process.env.QWENWORK_CLI_BIN;
  if (env && fs.existsSync(env)) return env;
  const home = os.homedir();
  const roots = [
    path.join(home, "AppData", "Local", "Programs", "QwenWorkCN"),
    path.join(home, "AppData", "Local", "QwenWorkCN"),
    "C:\\Program Files\\QwenWorkCN",
    "D:\\Program Files\\QwenWorkCN",
    "C:\\Program Files (x86)\\QwenWorkCN",
    "/Applications/QwenWorkCN.app/Contents/Resources",
    "/Applications/千问办公.app/Contents/Resources",
  ];
  const candidates: string[] = [];
  for (const root of roots) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(root, e, "resources", "bin", "qoderclicn.exe");
      if (fs.existsSync(p)) candidates.push(p);
      const p2 = path.join(root, e, "bin", "qoderclicn.exe");
      if (fs.existsSync(p2)) candidates.push(p2);
    }
    const direct = path.join(root, "bin", "qoderclicn.exe");
    if (fs.existsSync(direct)) candidates.push(direct);
  }
  if (!candidates.length) return null;
  candidates.sort();
  return candidates[candidates.length - 1];
}

export interface ResolvedCli {
  /** 实际 spawn 的可执行文件 */
  exe: string;
  /** 前置参数（如 node 运行 cli.js 时的脚本路径） */
  prefixArgs: string[];
  env: Record<string, string>;
}

/**
 * 将 CLI 解析为可直接 spawn 的形式，避免 Windows .cmd 经过 shell 带来的注入风险：
 * - .exe / 无扩展名 ELF：直接 spawn
 * - npm .cmd shim：解析出 node_modules 下的 cli.js，用系统 node 直接运行
 */
export function resolveCli(cliPath: string): ResolvedCli | null {
  const ext = path.extname(cliPath).toLowerCase();
  if (ext !== ".cmd" && ext !== ".bat") {
    // 无扩展名/其他：可能是带 shebang 的 node 脚本（如 npm 包内 bin/codebuddy）
    try {
      const fd = fs.openSync(cliPath, "r");
      const head = Buffer.alloc(2);
      fs.readSync(fd, head, 0, 2, 0);
      fs.closeSync(fd);
      if (head.toString("latin1") === "#!") {
        const node = whichSync("node") ?? process.execPath;
        const isElectron = /electron|obsidian|qwenwork/i.test(node) && !/nodejs/i.test(node);
        return { exe: node, prefixArgs: [cliPath], env: isElectron ? { ELECTRON_RUN_AS_NODE: "1" } : {} };
      }
    } catch {
      /* fallthrough */
    }
    return { exe: cliPath, prefixArgs: [], env: {} };
  }
  if (ext === ".cmd" || ext === ".bat") {
    try {
      const content = fs.readFileSync(cliPath, "utf8");
      // 收集 shim 中的 .js / .exe 引用（npm.cmd 含 npm-prefix.js 干扰项；opencode.cmd 直接指向 .exe）
      const jsMatches = [...content.matchAll(/"?%~?dp0%?[/\\]([^"\r\n]*?\.js)"?/gi)].map((m) => m[1]);
      const exeMatches = [...content.matchAll(/"?%~?dp0%?[/\\]([^"\r\n]*?\.exe)"?/gi)].map((m) => m[1]);
      const relJs =
        jsMatches.find((r) => /(^|[/\\])(npm-)?cli\.js$/i.test(r)) ??
        jsMatches[jsMatches.length - 1];
      const relExe = exeMatches.find((r) => !/uninstall|repair/i.test(r)) ?? exeMatches[0];
      const resolveRel = (rel: string) => {
        const clean = rel.replace(/%~?dp0%?[/\\]?/gi, "");
        const p = path.resolve(path.dirname(cliPath), clean.startsWith("node_modules") ? clean : path.join("node_modules", clean));
        return fs.existsSync(p) ? p : path.resolve(path.dirname(cliPath), rel);
      };
      if (relExe && (!relJs || /opencode/i.test(content))) {
        const exe = resolveRel(relExe);
        if (fs.existsSync(exe)) return { exe, prefixArgs: [], env: {} };
      }
      if (relJs) {
        const js2 = resolveRel(relJs);
        if (fs.existsSync(js2)) {
          const node = whichSync("node") ?? process.execPath;
          const isElectron = /electron|obsidian|qwenwork/i.test(node) && !/nodejs/i.test(node);
          return {
            exe: node,
            prefixArgs: [js2],
            env: isElectron ? { ELECTRON_RUN_AS_NODE: "1" } : {},
          };
        }
      }
      if (relExe) {
        const exe = resolveRel(relExe);
        if (fs.existsSync(exe)) return { exe, prefixArgs: [], env: {} };
      }
    } catch {
      /* fallthrough */
    }
    return null;
  }
  return { exe: cliPath, prefixArgs: [], env: {} };
}

/** 找到系统 node；找不到则用宿主进程（Electron）以 ELECTRON_RUN_AS_NODE 方式运行 */
export function nodeForBridge(): { exe: string; electronRunAsNode: boolean } {
  const n = whichSync("node");
  if (n && !/electron|obsidian/i.test(n)) return { exe: n, electronRunAsNode: false };
  return { exe: process.execPath, electronRunAsNode: true };
}

/** 不依赖 PATH 的 node 发现 */
export function findNodeExe(): { exe: string; env: Record<string, string> } {
  const w = whichSync("node");
  if (w && !/electron|obsidian/i.test(w)) return { exe: w, env: {} };
  const dirs = [
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs"),
    path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "nodejs"),
    path.dirname(process.execPath),
  ];
  for (const d of dirs) {
    const p = path.join(d, "node.exe");
    if (fs.existsSync(p)) return { exe: p, env: {} };
  }
  return { exe: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

/** 不依赖 PATH 的 npm 发现（直接定位 npm-cli.js，用 node 启动） */
export function findNpmCli(): { exe: string; args: string[]; env: Record<string, string> } | null {
  const w = whichSync("npm");
  if (w) {
    const r = resolveCli(w);
    if (r) return { exe: r.exe, args: r.prefixArgs, env: r.env };
  }
  const node = findNodeExe();
  const dirs = [
    path.dirname(node.exe),
    path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "npm"),
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs"),
  ];
  for (const d of dirs) {
    const cli = path.join(d, "node_modules", "npm", "bin", "npm-cli.js");
    if (fs.existsSync(cli)) return { exe: node.exe, args: [cli], env: node.env };
  }
  return null;
}

/** 应用内一键安装 npm 全局 CLI 包 */
export function installNpmPackage(pkg: string, onProgress?: (line: string) => void): Promise<{ ok: boolean; tail: string }> {
  return new Promise((resolve) => {
    const resolved = findNpmCli();
    if (!resolved) return resolve({ ok: false, tail: "未找到 npm/Node.js / npm or Node.js not found" });
    let child;
    try {
      child = spawn(resolved.exe, [...resolved.args, "install", "-g", pkg, "--no-audit", "--no-fund"], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...resolved.env },
      });
    } catch (e: any) {
      return resolve({ ok: false, tail: String(e?.message ?? e) });
    }
    let tail = "";
    // 必须消费输出，否则管道缓冲区满会导致 npm 挂起
    const drain = (d: Buffer) => {
      const s = d.toString();
      tail = (tail + s).slice(-2000);
      const lines = s.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length) onProgress?.(lines[lines.length - 1].trim().slice(0, 120));
    };
    child.stdout?.on("data", drain);
    child.stderr?.on("data", drain);
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve({ ok: false, tail: "安装超时（8 分钟）。" + tail });
    }, 8 * 60 * 1000);
    child.on("error", (e: any) => {
      clearTimeout(timer);
      resolve({ ok: false, tail: String(e?.message ?? e) });
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, tail });
    });
  });
}