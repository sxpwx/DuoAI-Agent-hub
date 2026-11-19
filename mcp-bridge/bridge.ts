/**
 * MCP stdio 桥接脚本（由 agent CLI 作为子进程启动）。
 * 实现最小 MCP 协议：initialize / tools/list / tools/call / ping。
 * 所有工具调用通过 HTTP 转发给 Obsidian 插件内的安全桥执行，
 * 权限确认由插件侧完成。纯 Node 内置模块，无第三方依赖。
 *
 * 环境变量：OBSIDIAN_BRIDGE_URL / OBSIDIAN_BRIDGE_TOKEN
 */
import * as readline from "readline";

const BASE = process.env.OBSIDIAN_BRIDGE_URL ?? "";
const TOKEN = process.env.OBSIDIAN_BRIDGE_TOKEN ?? "";

let cachedTools: any[] | null = null;

function send(msg: unknown) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function bridgeFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(10 * 60 * 1000), // 等待用户确认可能较久
  });
  if (!res.ok) throw new Error(`bridge HTTP ${res.status}`);
  return await res.json();
}

async function getTools(): Promise<any[]> {
  if (!cachedTools) {
    const data = await bridgeFetch("/tools");
    cachedTools = data.tools ?? [];
  }
  return cachedTools!;
}

async function handle(msg: any) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
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
    } catch (e: any) {
      send({ jsonrpc: "2.0", id, error: { code: -32000, message: String(e?.message ?? e) } });
    }
    return;
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    try {
      const data = await bridgeFetch("/call", {
        method: "POST",
        body: JSON.stringify({ name, arguments: args }),
      });
      if (data.ok) {
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(data.result) }] } });
      } else {
        send({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: `错误：${data.error}` }], isError: true },
        });
      }
    } catch (e: any) {
      send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: `桥接失败：${e?.message ?? e}` }], isError: true },
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
  let msg: any;
  try {
    msg = JSON.parse(s);
  } catch {
    return;
  }
  handle(msg).catch((e) => {
    if (msg?.id !== undefined) {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: String(e?.message ?? e) } });
    }
  });
});