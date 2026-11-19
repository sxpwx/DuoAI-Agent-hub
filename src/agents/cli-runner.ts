import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { CliAgentSpec, RunContext } from "../types";
import { resolveCli } from "./detect";

/** Windows 下杀整棵进程树（CLI 会派生 MCP 等子进程，单杀父进程会留下占用管道的孤儿） */
function killTree(child: ChildProcess) {
  if (process.platform === "win32" && child.pid) {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } catch {
      /* ignore */
    }
  } else {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

function shortTool(name: string): string {
  return String(name ?? "").replace(/^mcp__obsidian__/, "");
}
function clip(s: string, n = 600): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export async function runCliAgent(spec: CliAgentSpec, cliPath: string, ctx: RunContext): Promise<void> {
  const resolved = resolveCli(cliPath);
  if (!resolved) {
    ctx.onEvent({
      type: "error",
      text: `无法安全启动 CLI（${cliPath}）。请在设置中直接指定 .exe 或 cli.js 路径。`,
    });
    return;
  }
  // MCP 配置写入临时文件，避免超长 JSON 进入命令行
  const tmp = path.join(os.tmpdir(), `agent-hub-mcp-${crypto.randomBytes(6).toString("hex")}.json`);
  fs.writeFileSync(tmp, ctx.mcpConfigJson, "utf8");
  const ctx2: RunContext = { ...ctx, mcpConfigJson: tmp };
  try {
    const ok = await attempt(spec, resolved.exe, resolved.prefixArgs, resolved.env, spec.buildArgs(resolved.exe, ctx2), spec.stdinJson, ctx);
    if (!ok && spec.fallbackArgs) {
      ctx.onEvent({ type: "status", text: "主参数不被支持，使用兼容参数重试…" });
      await attempt(spec, resolved.exe, resolved.prefixArgs, resolved.env, spec.fallbackArgs(resolved.exe, ctx2), false, ctx);
    }
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

interface AttemptResult {
  sawResult: boolean;
  stderr: string;
  code: number | null;
}

function attempt(
  spec: CliAgentSpec,
  exe: string,
  prefixArgs: string[],
  extraEnv: Record<string, string>,
  args: string[],
  stdinJson: boolean,
  ctx: RunContext
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let child;
    try {
      child = spawn(exe, [...prefixArgs, ...args], {
        cwd: ctx.vaultPath,
        env: { ...process.env, ...extraEnv, ...(ctx.cliEnv ?? {}) },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e: any) {
      ctx.onEvent({ type: "error", text: `启动失败：${e?.message ?? e}` });
      resolve(true);
      return;
    }

    const state: AttemptResult = { sawResult: false, stderr: "", code: null };
    let stdoutBuf = "";
    let lastCodexText = "";
    let settled = false;
    let abortGrace: number | null = null;

    const onAbort = () => {
      killTree(child);
      // 强制关闭管道，避免孙进程占用句柄导致 exit/close 不触发
      try {
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.stdin?.destroy();
      } catch {
        /* ignore */
      }
      // 兜底：2 秒内仍未结束则立即解除 UI 阻塞
      abortGrace = window.setTimeout(() => {
        if (!settled) {
          ctx.onEvent({ type: "status", text: "已停止" });
          finish(false);
        }
      }, 2000);
    };
    ctx.signal.addEventListener("abort", onAbort, { once: true });

    const finish = (retryable: boolean) => {
      if (settled) return;
      settled = true;
      if (abortGrace !== null) window.clearTimeout(abortGrace);
      ctx.signal.removeEventListener("abort", onAbort);
      resolve(retryable);
    };

    child.on("error", (e: any) => {
      ctx.onEvent({ type: "error", text: `启动失败：${e?.message ?? e}（路径：${exe}）` });
      finish(false);
    });

    child.stderr.on("data", (d: Buffer) => {
      state.stderr += d.toString();
      if (state.stderr.length > 8000) state.stderr = state.stderr.slice(-8000);
    });

    child.stdout.on("data", (d: Buffer) => {
      stdoutBuf += d.toString();
      let idx: number;
      while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (!line) continue;
        let obj: any;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        if (spec.protocol === "claude") mapClaude(obj, ctx, state);
        else lastCodexText = mapCodex(obj, ctx, state, lastCodexText);
      }
    });

    child.on("exit", (code) => {
      state.code = code;
      if (ctx.signal.aborted) {
        ctx.onEvent({ type: "status", text: "已停止" });
        finish(false);
        return;
      }
      if (state.sawResult) {
        finish(false);
        return;
      }
      const unknownOpt = /unknown option|unexpected argument|unknown argument|error: unknown/i.test(state.stderr);
      if (unknownOpt && spec.fallbackArgs) {
        finish(true); // 触发兼容参数重试
        return;
      }
      const tail = state.stderr.trim().split(/\r?\n/).slice(-6).join("\n");
      ctx.onEvent({
        type: "error",
        text: `CLI 退出（code=${code}）且无结果。${tail ? "\n" + clip(tail, 800) : ""}${
          /login|auth|unauthorized|not logged/i.test(state.stderr)
            ? "\n提示：该 CLI 可能尚未登录，请先在终端完成登录。"
            : code === 0
              ? "\n提示：请确认设置中的 CLI 路径指向命令行工具而非桌面 GUI（如 WorkBuddy.exe 是 GUI，不能用作 CLI）。"
              : ""
        }`,
      });
      finish(false);
    });

    // 通过 stdin 传入提示词（避免命令行注入）
    const fullPrompt = ctx.systemPrompt + "\n\n用户请求：\n" + ctx.prompt;
    try {
      if (stdinJson) {
        child.stdin.write(
          JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: fullPrompt }] } }) + "\n"
        );
      } else {
        child.stdin.write(fullPrompt);
      }
      child.stdin.end();
    } catch {
      /* 子进程可能已退出 */
    }
  });
}

function mapClaude(obj: any, ctx: RunContext, state: AttemptResult) {
  switch (obj?.type) {
    case "system":
      if (obj.subtype === "init") {
        ctx.onEvent({ type: "status", text: `会话已建立${obj.model ? " · 模型 " + obj.model : ""}` });
      }
      break;
    case "assistant":
      for (const c of obj.message?.content ?? []) {
        if (c.type === "text" && c.text) ctx.onEvent({ type: "text", text: c.text });
        else if (c.type === "tool_use") ctx.onEvent({ type: "tool_use", name: shortTool(c.name), args: c.input ?? {} });
      }
      break;
    case "user":
      for (const c of obj.message?.content ?? []) {
        if (c.type === "tool_result") {
          const text =
            typeof c.content === "string"
              ? c.content
              : Array.isArray(c.content)
                ? c.content.map((x: any) => x?.text ?? "").join("\n")
                : "";
          ctx.onEvent({ type: "tool_result", text: clip(text), isError: !!c.is_error });
        }
      }
      break;
    case "result": {
      state.sawResult = true;
      if (obj.subtype === "success" && !obj.is_error) {
        ctx.onEvent({ type: "done", text: obj.result ?? "" });
      } else {
        let text = obj.result ?? obj.error ?? "执行失败";
        if (/not logged in|please run \/login|login required/i.test(text)) {
          text += "\n提示：该 CLI 尚未登录，请先在终端完成登录（设置页有登录指引）。";
        }
        ctx.onEvent({ type: "error", text });
      }
      break;
    }
  }
}

function mapCodex(obj: any, ctx: RunContext, state: AttemptResult, lastText: string): string {
  const t = obj?.type;
  if (t === "item.completed" || t === "item.updated") {
    const it = obj.item ?? {};
    const kind = it.item_type ?? it.type;
    if (kind === "agent_message" && it.text && t === "item.completed") {
      ctx.onEvent({ type: "text", text: it.text });
      return it.text;
    }
    if (kind === "mcp_tool_call" || kind === "function_call") {
      if (t === "item.completed" || it.status === "in_progress") {
        ctx.onEvent({ type: "tool_use", name: shortTool(it.tool ?? it.name), args: it.arguments ?? {} });
      }
      if (it.result !== undefined && t === "item.completed") {
        ctx.onEvent({ type: "tool_result", text: clip(String(it.result)), isError: it.status === "failed" });
      }
    }
    return lastText;
  }
  if (t === "turn.completed") {
    state.sawResult = true;
    ctx.onEvent({ type: "done", text: lastText });
    return lastText;
  }
  if (t === "error" || t === "turn.failed") {
    state.sawResult = true;
    ctx.onEvent({ type: "error", text: obj.message ?? obj.error?.message ?? "执行失败" });
    return lastText;
  }
  // 旧版协议
  if (obj?.msg?.type === "agent_message" && obj.msg.message) {
    ctx.onEvent({ type: "text", text: obj.msg.message });
    return obj.msg.message;
  }
  if (obj?.msg?.type === "task_complete") {
    state.sawResult = true;
    ctx.onEvent({ type: "done", text: obj.msg.last_agent_message ?? lastText });
  }
  return lastText;
}