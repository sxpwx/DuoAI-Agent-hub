/**
 * MCP stdio 桥接脚本（由 agent CLI 作为子进程启动）。
 * 实现最小 MCP 协议：initialize / tools/list / tools/call / ping。
 * 所有工具调用通过 HTTP 转发给 Obsidian 插件内的安全桥执行，
 * 权限确认由插件侧完成。纯 Node 内置模块，无第三方依赖。
 *
 * 环境变量：OBSIDIAN_BRIDGE_URL / OBSIDIAN_BRIDGE_TOKEN
 */
import * as readline from "readline";
import * as http from "http";
import * as https from "https";

const BASE = process.env.OBSIDIAN_BRIDGE_URL ?? "";
const TOKEN = process.env.OBSIDIAN_BRIDGE_TOKEN ?? "";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function rec(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

let cachedTools: unknown[] | null = null;

function send(msg: unknown) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function bridgeFetch(path: string, init?: { method?: string; body?: string }): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const mod = u.protocol === "https:" ? https : http;
    const body = init?.body;
    const headers: Record<string, string | number> = {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    };
    if (body !== undefined) headers["Content-Length"] = Buffer.byteLength(body);
    const r = mod.request(
      {
        hostname: u.hostname,
        port: u.port || undefined,
        path: u.pathname + u.search,
        method: init?.method ?? "GET",
        headers,
        timeout: 10 * 60 * 1000, // 等待用户确认可能较久
      },
      (res) => {
        let s = "";
        res.on("data", (d: Buffer) => (s += d.toString()));
        res.on("end", () => {
          const code = res.statusCode ?? 0;
          if (code < 200 || code >= 300) {
            reject(new Error(`bridge HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(s) as unknown);
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
        res.on("error", reject);
      }
    );
    r.on("timeout", () => r.destroy(new Error("bridge request timeout")));
    r.on("error", reject);
    if (body !== undefined) r.end(body);
    else r.end();
  });
}

async function getTools(): Promise<unknown[]> {
  if (!cachedTools) {
    const data = rec(await bridgeFetch("/tools"));
    cachedTools = arr(data.tools);
  }
  return cachedTools;
}

async function handle(msg: unknown) {
  const m = rec(msg);
  const id = m.id;
  const method = str(m.method);
  const params = rec(m.params);
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: str(params.protocolVersion) || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "obsidian-agent-hub", version: "0.1.0" },
      },
    });
    return;
  }
  if (method === "notifications/initialized" || method === "initialized") return;
  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (method === "tools/list") {
    try {
      send({ jsonrpc: "2.0", id, result: { tools: await getTools() } });
    } catch (e) {
      send({ jsonrpc: "2.0", id, error: { code: -32000, message: String(rec(e).message ?? e) } });
    }
    return;
  }
  if (method === "tools/call") {
    const name = str(params.name);
    const args = params.arguments ?? {};
    try {
      const data = rec(
        await bridgeFetch("/call", {
          method: "POST",
          body: JSON.stringify({ name, arguments: args }),
        })
      );
      if (data.ok) {
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(data.result) }] } });
      } else {
        send({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: `错误：${String(data.error)}` }], isError: true },
        });
      }
    } catch (e) {
      send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: `桥接失败：${String(rec(e).message ?? e)}` }], isError: true },
      });
    }
    return;
  }
  if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const s = line.trim();
  if (!s) return;
  let msg: unknown;
  try {
    msg = JSON.parse(s);
  } catch {
    return;
  }
  handle(msg).catch((e: unknown) => {
    const id = rec(msg).id;
    if (id !== undefined) {
      send({ jsonrpc: "2.0", id, error: { code: -32000, message: String(rec(e).message ?? e) } });
    }
  });
});