import * as crypto from "crypto";
import * as https from "https";
import * as os from "os";

/**
 * 千问办公 / Qoder CN 公有云聊天协议内置实现（COSY 签名 + 请求体编解码 + SSE）。
 * 协议移植自 MIT 社区实现 @magpie-community/opencode-qoder-auth / CLIProxyAPI。
 * 不依赖任何外部 CLI/引擎。
 */
const CHAT_PATH = "/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1";
const MODELS_PATH = "/algo/api/v2/model/list?Encode=1";
const COSY_VERSION = "1.1.59";
const RSA_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;

export interface CosySite {
  id: string;
  name: string;
  openapi: string;
  api: string;
  clientId: string;
  redirect: string;
  businessProduct: string;
  sessionType: string;
  scene: string;
  clientType: string;
  rsaKey: string;
  systemPrompt: string;
  modelScene?: string;
  deviceOnly?: boolean;
  userInfoPath: string;
  modelsFallback: { key: string; display_name: string }[];
}

export const COSY_SITES: Record<string, CosySite> = {
  qwenwork: {
    id: "qwenwork",
    name: "千问办公",
    openapi: "https://gateway.qwenwork.cn",
    api: "https://gateway.qwenwork.cn",
    clientId: "e883ade2-e6e3-4d6d-adf7-f92ceff5fdcb",
    redirect: "qwenwork-cn://",
    businessProduct: "qoder_work",
    sessionType: "qoder_work",
    scene: "qwork",
    clientType: "6",
    rsaKey: RSA_KEY,
    systemPrompt: "You are QwenWork (qw), a helpful assistant. Use the instructions below and the tools available to you to assist the user.",
    modelScene: "qwork",
    deviceOnly: true,
    userInfoPath: "/api/v1/adapter/user/account-context?include=user,plan,quota,page,data_sharing",
    modelsFallback: [
      { key: "flash", display_name: "标准" },
      { key: "pro", display_name: "高级" },
      { key: "qwen3.8-max-preview", display_name: "Qwen3.8-Max" },
    ],
  },
  "qoder-cn": {
    id: "qoder-cn",
    name: "Qoder CN",
    openapi: "https://openapi.qoder.com.cn",
    api: "https://gateway.qoder.com.cn",
    clientId: "e883ade2-e6e3-4d6d-adf7-f92ceff5fdcb",
    redirect: "",
    businessProduct: "app",
    sessionType: "app",
    scene: "app",
    clientType: "10",
    rsaKey: RSA_KEY,
    systemPrompt: "You are Qoder, a helpful assistant. Use the instructions below and the tools available to you to assist the user.",
    userInfoPath: "/api/v1/userinfo",
    modelsFallback: [
      { key: "ultimate", display_name: "Ultimate" },
      { key: "performance", display_name: "Performance" },
      { key: "efficient", display_name: "Efficient" },
      { key: "lite", display_name: "Lite" },
    ],
  },
};

const ALPHABET = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!";

function segmentEncode(bytes: Buffer): string {
  let s = "";
  let acc = 0;
  let nb = 0;
  for (const b of bytes) {
    acc = ((acc << 8) | b) & 0xffffff;
    nb += 8;
    while (nb >= 6) {
      nb -= 6;
      s += ALPHABET[(acc >> nb) & 63];
    }
  }
  if (nb > 0) s += ALPHABET[(acc << (6 - nb)) & 63];
  while (s.length % 4) s += "$";
  return s;
}
function swapThirds(s: string): string {
  const t = Math.floor(s.length / 3);
  return t ? s.slice(s.length - t) + s.slice(t, s.length - t) + s.slice(0, t) : s;
}
const encodeBody = (text: string) => swapThirds(segmentEncode(Buffer.from(text, "utf8")));
const hexID = () => crypto.randomUUID().replace(/-/g, "");

export interface CosyCred {
  access: string;
  uid: string;
  name?: string;
  email?: string;
  machineId: string;
  refresh?: string;
  expires?: number;
  [k: string]: unknown;
}

function clientHeaders(site: CosySite): Record<string, string> {
  if (site.id !== "qwenwork") return { Accept: "application/json" };
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

function machineOS(): string {
  return (({ x64: "x86_64", arm64: "aarch64" } as Record<string, string>)[process.arch] ?? process.arch) + "_" + process.platform;
}

function userBlob(u: CosyCred, site: CosySite) {
  const raw = JSON.stringify({ uid: u.uid, aid: "", name: u.name ?? "", email: u.email ?? "", security_oauth_token: u.access });
  const key = Buffer.from(hexID().slice(0, 16));
  const c = crypto.createCipheriv("aes-128-cbc", key, key);
  const info = Buffer.concat([c.update(raw, "utf8"), c.final()]).toString("base64");
  const wrapped = crypto.publicEncrypt({ key: site.rsaKey, padding: crypto.constants.RSA_PKCS1_PADDING }, key).toString("base64");
  return { info, key: wrapped };
}

function cosyHeaders(url: string, u: CosyCred, body: string, site: CosySite): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000);
  const blob = userBlob(u, site);
  const payload = Buffer.from(
    JSON.stringify({ version: "v1", requestId: crypto.randomUUID(), info: blob.info, cosyVersion: COSY_VERSION, ideVersion: "" })
  ).toString("base64");
  let path = new URL(url).pathname;
  if (path.startsWith("/algo")) path = path.slice(5);
  const sig = crypto.createHash("md5").update(`${payload}\n${blob.key}\n${ts}\n${body}\n${path}`).digest("hex");
  const m = u.machineId;
  const host = os.hostname();
  const h: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "identity",
    "Content-Type": "application/json",
    Authorization: `Bearer COSY.${payload}.${sig}`,
    "Cosy-Business-Product": site.businessProduct,
    "Cosy-Business-Type": "agent",
    "Cosy-ClientType": site.clientType,
    "Cosy-Data-Policy": "disagree",
    "Cosy-Date": String(ts),
    "Cosy-Key": blob.key,
    "Cosy-MachineId": m,
    "Cosy-MachineOS": machineOS(),
    "Cosy-Scene": site.scene,
    "Cosy-User": u.uid,
    "Cosy-Version": COSY_VERSION,
    "Login-Version": "v2",
    ...clientHeaders(site),
  };
  if (/^[\x21-\x7e][\x20-\x7e]*$/.test(host) && host.length <= 96) h["Cosy-MachineHostname"] = host;
  return h;
}

function chatHeaders(url: string, u: CosyCred, body: string, modelKey: string, site: CosySite): Record<string, string> {
  const h = cosyHeaders(url, u, body, site);
  delete h["Cosy-ClientIp"];
  delete h["Cosy-MachineToken"];
  delete h["Cosy-MachineType"];
  h.Accept = "text/event-stream";
  h["Cache-Control"] = "no-cache";
  h["X-Model-Key"] = modelKey;
  h["X-Model-Source"] = "system";
  return h;
}

// ---- 消息转换（OpenAI → Qoder content blocks） ----
type Msg = { role: string; content?: unknown; tool_calls?: any[]; tool_call_id?: string; reasoning_content?: string };

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p: any) => (p?.type === "text" ? p.text ?? "" : "")).join("");
  return "";
}
function blocksOf(content: unknown): any[] {
  if (typeof content === "string") return content.trim() ? [{ type: "text", text: content }] : [];
  if (Array.isArray(content)) return content.filter((p: any) => p?.type === "text" && (p.text ?? "").trim());
  return [];
}

function qoderMessages(msgs: Msg[]): any[] {
  const out: any[] = [];
  let seen: any[] = [];
  const showSeen = () => {
    if (seen.length) out.push({ role: "user", content: seen });
    seen = [];
  };
  let turn: { open: string[]; kept: Set<string> } | null = null;
  const asText = (txt: string) => {
    const said = txt.trim();
    if (!said) return;
    if (seen.length) seen.push({ type: "text", text: "\n\n" });
    seen.push({ type: "text", text: said });
  };
  for (const [i, m] of msgs.entries()) {
    if (m.role === "system" || m.role === "developer") continue;
    if (m.role === "user") turn = null;
    if (m.role !== "user" && m.role !== "tool") showSeen();
    if (m.role === "tool") {
      const txt = textOf(m.content);
      const named = String(m.tool_call_id ?? "").trim();
      const at = named && turn ? turn.open.findIndex((id) => id === named) : -1;
      const pick = at >= 0 ? at : turn ? turn.open.findIndex((id) => !turn!.kept.has(id)) : -1;
      if (pick < 0) {
        asText(txt);
        continue;
      }
      const answered = turn!.open.splice(pick, 1)[0];
      out.push({ role: "tool", tool_call_id: answered, content: txt });
      continue;
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      const calls = m.tool_calls.map((c, k) => {
        const id = String(c.id ?? "").trim() || `call_${i}_${k}`;
        const args = c.function?.arguments;
        return { id, type: "function", function: { name: c.function?.name, arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}) } };
      });
      out.push({
        role: "assistant",
        content: textOf(m.content) || "",
        ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}),
        tool_calls: calls,
      });
      const open = calls.map((c) => c.id);
      const kept = new Set<string>();
      for (let j = i + 1; j < msgs.length && msgs[j].role === "tool"; j++) {
        const id = String(msgs[j].tool_call_id ?? "").trim();
        if (open.includes(id)) kept.add(id);
      }
      turn = { open, kept };
      continue;
    }
    let blocks = blocksOf(m.content);
    if (m.role === "assistant") blocks = blocks.filter((b) => b.type === "text");
    if (!blocks.length) continue;
    if (m.role === "user" && seen.length) {
      blocks = [...seen, ...blocks];
      seen = [];
    }
    out.push({ role: m.role, content: blocks, ...(m.role === "assistant" && m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}) });
    turn = null;
  }
  showSeen();
  return out;
}

function cacheMarked(msgs: any[]): any[] {
  const out = msgs.map((m) => (m.role === "user" && Array.isArray(m.content) ? { ...m, contents: m.content } : m));
  const last = out[out.length - 1];
  if (last?.role !== "user" || !Array.isArray(last.content) || !last.content.length) return out;
  const blocks = last.content.slice();
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: "ephemeral" } };
  out[out.length - 1] = { ...last, content: blocks, contents: blocks };
  return out;
}

function sessionOf(msgs: Msg[]): string {
  const sys = msgs.filter((x) => x.role === "system" || x.role === "developer").map((x) => textOf(x.content));
  const first = msgs.find((x) => x.role === "user");
  const seed = "chat\0" + JSON.stringify([sys, first?.content ?? ""]);
  const h = crypto.createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export interface CosyChatRequest {
  messages: Msg[];
  tools?: { type: string; function: { name: string; description?: string; parameters?: unknown } }[];
  model: string;
}

export type CosyEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; index: number; id: string; name: string; args: string }
  | { kind: "args"; index: number; text: string }
  | { kind: "stop"; stop: string; usage?: unknown }
  | { kind: "error"; message: string };

function buildBody(req: CosyChatRequest, site: CosySite): string {
  const m = site.modelsFallback.find((x) => x.key === req.model) ?? { key: req.model, display_name: req.model };
  const system = req.messages.filter((x) => x.role === "system" || x.role === "developer").map((x) => textOf(x.content)).filter(Boolean).join("\n\n");
  const sysText = system ? site.systemPrompt + "\n\n" + system : site.systemPrompt;
  const sys = { type: "text", text: sysText };
  const tools = (req.tools ?? []).filter((t) => t?.type === "function" && t.function?.name);
  const request = crypto.randomUUID();
  const session = sessionOf(req.messages);
  const taskId = crypto.randomUUID();
  const lastUser = [...req.messages].reverse().find((x) => x.role === "user");
  const body: Record<string, unknown> = {
    request_id: request,
    request_set_id: taskId,
    chat_record_id: request,
    session_id: session,
    parameters: { enable_thinking: false, max_tokens: 32000, context_length: 131072 },
    business: { product: site.businessProduct, version: COSY_VERSION, type: "agent", id: taskId, name: textOf(lastUser?.content).slice(0, 60), begin_at: Date.now(), stage: "start" },
    agent_id: "agent_common",
    task_id: "common",
    session_type: site.sessionType,
    model_config: {
      key: m.key,
      display_name: m.display_name,
      model: "",
      format: "openai",
      is_vl: false,
      is_reasoning: false,
      api_key: "",
      url: "",
      source: "system",
      max_input_tokens: 131072,
    },
    system: [sys],
    messages: [{ role: "system", content: [sys] }, ...cacheMarked(qoderMessages(req.messages))],
  };
  if (tools.length) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: { name: t.function.name, description: t.function.description ?? "", parameters: t.function.parameters ?? { type: "object", properties: {} } },
    }));
  }
  return JSON.stringify(body);
}

function httpsRequest(url: string, method: string, headers: Record<string, string>, body?: string, signal?: AbortSignal): Promise<import("http").IncomingMessage> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: body !== undefined ? { ...headers, "Content-Length": Buffer.byteLength(body) } : headers,
      },
      resolve
    );
    r.on("error", reject);
    if (signal) {
      if (signal.aborted) {
        r.destroy();
        reject(new Error("已停止"));
        return;
      }
      signal.addEventListener("abort", () => r.destroy(), { once: true });
    }
    if (body !== undefined) r.end(body);
    else r.end();
  });
}

function readAll(res: import("http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = "";
    res.on("data", (d) => (s += d.toString()));
    res.on("end", () => resolve(s));
    res.on("error", reject);
  });
}

/** 拉取账号可用模型目录（与各产品客户端一致） */
export async function fetchCosyModels(cred: CosyCred, siteId: string): Promise<{ key: string; display_name: string }[]> {
  const site = COSY_SITES[siteId];
  if (!site) return [];
  const url = site.api + MODELS_PATH;
  try {
    const res = await httpsRequest(url, "GET", cosyHeaders(url, cred, "", site));
    if (res.statusCode !== 200) return [];
    const json = JSON.parse(await readAll(res));
    const arr = site.modelScene ? json?.[site.modelScene] : Object.values(json ?? {}).find((v) => Array.isArray(v));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((m: any) => m?.key && m.enable !== false)
      .map((m: any) => ({ key: String(m.key), display_name: String(m.display_name ?? m.name ?? m.key) }));
  } catch {
    return [];
  }
}

/** 发起一次 COSY 聊天请求，产出归一化事件流 */
export async function* cosyChat(cred: CosyCred, req: CosyChatRequest, siteId: string, signal?: AbortSignal): AsyncGenerator<CosyEvent> {
  const site = COSY_SITES[siteId];
  const url = site.api + CHAT_PATH;
  const wire = encodeBody(buildBody(req, site));
  const headers = chatHeaders(url, cred, wire, req.model, site);
  const res = await httpsRequest(url, "POST", headers, wire, signal);
  if (res.statusCode !== 200) {
    const text = await readAll(res);
    throw new Error(`${site.name}网关 HTTP ${res.statusCode}：${text.slice(0, 300)}`);
  }
  yield* parseEvents(res, signal);
}

async function* parseEvents(res: import("http").IncomingMessage, signal?: AbortSignal): AsyncGenerator<CosyEvent> {
  const native = new Map<number, { id: string; args: string; index?: number; emitted?: boolean }>();
  let index = -1;
  let fr = "";
  let usage: unknown;
  let buf = "";
  const dec = new TextDecoder();
  const lines: string[] = [];
  let done = false;
  const push = (chunk: Buffer) => {
    buf += dec.decode(chunk, { stream: true });
    let n: number;
    while ((n = buf.indexOf("\n")) >= 0) {
      lines.push(buf.slice(0, n).trim());
      buf = buf.slice(n + 1);
    }
  };
  res.on("data", push);
  const ended = new Promise<void>((resolve) => {
    res.on("end", () => {
      if (buf.trim()) lines.push(buf.trim());
      done = true;
      resolve();
    });
    res.on("error", () => {
      done = true;
      resolve();
    });
  });
  while (!done || lines.length) {
    if (signal?.aborted) return;
    if (!lines.length) {
      await new Promise((r) => setTimeout(r, 20));
      continue;
    }
    const line = lines.shift()!;
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    let env: any;
    try {
      env = JSON.parse(payload);
    } catch {
      continue;
    }
    const inner = typeof env?.body === "string" ? env.body : "";
    if (env?.statusCodeValue != null && env.statusCodeValue !== 200) {
      yield { kind: "error", message: `网关错误 ${env.statusCodeValue}：${inner.slice(0, 300)}` };
      return;
    }
    if (inner.trim() === "[DONE]") break;
    let chunk: any;
    try {
      chunk = JSON.parse(inner.trim());
    } catch {
      continue;
    }
    if (!Array.isArray(chunk?.choices) && (chunk?.error || (chunk?.code != null && chunk?.message))) {
      yield { kind: "error", message: String(chunk?.error?.message ?? chunk?.message ?? inner).slice(0, 300) };
      return;
    }
    const delta = chunk?.choices?.[0]?.delta ?? {};
    if (typeof delta.content === "string" && delta.content) {
      yield { kind: "text", text: delta.content };
    }
    for (const tc of delta.tool_calls ?? []) {
      const i = Number(tc.index ?? 0);
      const name = typeof tc.function?.name === "string" ? tc.function.name.trim() : "";
      const args = tc.function?.arguments ?? "";
      if (!tc.id && !name && !args) continue;
      let call = native.get(i);
      if (!call || (tc.id && call.id && tc.id !== call.id)) {
        call = { id: "", args: "" };
        native.set(i, call);
      }
      if (tc.id) call.id = tc.id;
      if (call.index === undefined) {
        call.args += args;
        if (!name) continue;
        call.index = ++index;
        call.emitted = true;
        yield { kind: "tool", index: call.index, id: call.id || "call_" + hexID(), name, args: call.args };
      } else if (args) {
        yield { kind: "args", index: call.index, text: args };
      }
    }
    fr = chunk?.choices?.[0]?.finish_reason || fr;
    if (chunk?.usage) usage = chunk.usage;
  }
  await ended;
  yield { kind: "stop", stop: fr === "tool_calls" || [...native.values()].some((c) => c.emitted) ? "tool_calls" : fr === "length" ? "length" : "stop", usage };
}