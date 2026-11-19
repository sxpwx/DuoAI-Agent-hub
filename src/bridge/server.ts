import * as http from "http";
import * as crypto from "crypto";
import { ConfirmHandler, PermissionMode } from "../types";
import { TOOL_DEFS, VaultTools, summarize } from "./tools";
import { t } from "../i18n";
import { rec } from "../agents/guards";

/**
 * 本地安全桥：仅监听 127.0.0.1，随机端口 + 会话令牌。
 * agent CLI 通过 MCP stdio 子进程（mcp-bridge.js）转发工具调用到这里，
 * 由插件在 Obsidian 内执行 vault 操作，并实施三级权限确认。
 */
export class BridgeServer {
  private server: http.Server | null = null;
  private token = crypto.randomBytes(24).toString("hex");
  private sessionAllowAll = false;
  port = 0;

  constructor(
    private tools: VaultTools,
    private getMode: () => PermissionMode,
    private confirm: ConfirmHandler,
    private getNetwork: () => boolean = () => true,
    private onActivity?: (tool: string, tier: string, decision: string) => void
  ) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }
  get authToken(): string {
    return this.token;
  }

  resetSession() {
    this.sessionAllowAll = false;
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = this.server.address();
    this.port = addr && typeof addr === "object" ? addr.port : 0;
  }

  stop() {
    this.server?.close();
    this.server = null;
  }

  /** 供内置 API agent 循环直接调用（同样经过权限网关） */
  async executeGated(name: string, args: Record<string, unknown>): Promise<string> {
    const def = TOOL_DEFS.find((t) => t.name === name);
    if (!def) throw new Error(`未知工具：${name}`);
    if (def.network && !this.getNetwork()) throw new Error(t("networkDisabled"));
    const tier = def.tier;
    const mode = this.getMode();
    let decision = "auto";
    if (mode === "confirm" && tier !== "read" && !this.sessionAllowAll) {
      const d = await this.confirm({ tool: name, tier, args, summary: summarize(name, args) });
      decision = d;
      if (d === "allow-session") this.sessionAllowAll = true;
      if (d === "deny") throw new Error(t("refusedByUser"));
    }
    this.onActivity?.(name, tier, decision);
    return await this.tools.execute(name, args);
  }

  private send(res: http.ServerResponse, code: number, body: unknown) {
    const data = JSON.stringify(body);
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(data);
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      if (req.headers.authorization !== `Bearer ${this.token}`) {
        return this.send(res, 401, { ok: false, error: "unauthorized" });
      }
      const url = (req.url ?? "").split("?")[0];
      if (req.method === "GET" && url === "/health") {
        return this.send(res, 200, { ok: true });
      }
      if (req.method === "GET" && url === "/tools") {
        const defs = TOOL_DEFS.filter((t) => !t.network || this.getNetwork());
        return this.send(res, 200, {
          ok: true,
          tools: defs.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        });
      }
      if (req.method === "POST" && url === "/call") {
        const body = await readBody(req, 2 * 1024 * 1024);
        const parsed = rec(JSON.parse(body));
        const name = parsed.name;
        const args = parsed.arguments;
        if (typeof name !== "string") return this.send(res, 400, { ok: false, error: "missing name" });
        try {
          const result = await this.executeGated(name, (args ?? {}) as Record<string, unknown>);
          return this.send(res, 200, { ok: true, result });
        } catch (e) {
          return this.send(res, 200, { ok: false, error: String(rec(e).message ?? e) });
        }
      }
      this.send(res, 404, { ok: false, error: "not found" });
    } catch (e) {
      this.send(res, 500, { ok: false, error: String(rec(e).message ?? e) });
    }
  }
}

function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}