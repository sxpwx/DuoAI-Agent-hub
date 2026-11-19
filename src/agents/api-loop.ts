import { ApiConfig, RunContext } from "../types";
import { TOOL_DEFS } from "../bridge/tools";
import { cosyChat, CosyCred } from "./qwenwork-chat";
import { t } from "../i18n";
import { arr, num, rec, str } from "./guards";

type ExecFn = (name: string, args: Record<string, unknown>) => Promise<string>;

interface ChatMessage {
  role: string;
  content?: unknown;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

function toolDefs(networkEnabled: boolean) {
  return TOOL_DEFS.filter((t) => !t.network || networkEnabled).map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

async function execCalls(
  calls: { id: string; name: string; args: string }[],
  messages: ChatMessage[],
  content: string,
  ctx: RunContext,
  execute: ExecFn
): Promise<boolean> {
  const valid = calls.filter((c) => c && c.name);
  if (!valid.length) return false;
  messages.push({
    role: "assistant",
    content: content || "",
    tool_calls: valid.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args || "{}" } })),
  });
  for (const c of valid) {
    if (ctx.signal.aborted) return true;
    let args: Record<string, unknown> = {};
    try {
      args = rec(JSON.parse(c.args || "{}"));
    } catch {
      /* 工具侧报错 */
    }
    ctx.onEvent({ type: "tool_use", name: c.name, args });
    try {
      const result = await execute(c.name, args);
      ctx.onEvent({ type: "tool_result", text: result.slice(0, 600) });
      messages.push({ role: "tool", tool_call_id: c.id, content: result });
    } catch (e) {
      const msg = String(rec(e).message ?? e);
      ctx.onEvent({ type: "tool_result", text: msg, isError: true });
      messages.push({ role: "tool", tool_call_id: c.id, content: `错误：${msg}` });
    }
  }
  return true;
}

/** COSY 站点（千问办公 / Qoder CN）agent 循环：不限工具迭代轮数 */
export async function runCosyLoop(
  cred: CosyCred,
  siteId: string,
  ctx: RunContext,
  execute: ExecFn,
  networkEnabled = true
): Promise<void> {
  const tools = toolDefs(networkEnabled);
  const messages: ChatMessage[] = [
    { role: "system", content: ctx.systemPrompt },
    { role: "user", content: ctx.prompt },
  ];
  for (let iter = 1; ; iter++) {
    if (ctx.signal.aborted) return;
    ctx.onEvent({ type: "status", text: t("statusRequestRound", { n: iter }) });
    let content = "";
    let stop = "";
    const calls: { id: string; name: string; args: string }[] = [];
    try {
      for await (const ev of cosyChat(cred, { messages, tools, model: ctx.model }, siteId, ctx.signal)) {
        if (ctx.signal.aborted) return;
        if (ev.kind === "text") {
          content += ev.text;
          ctx.onEvent({ type: "text", text: ev.text });
        } else if (ev.kind === "tool") {
          calls[ev.index] = { id: ev.id, name: ev.name, args: ev.args };
        } else if (ev.kind === "args") {
          if (calls[ev.index]) calls[ev.index].args += ev.text;
        } else if (ev.kind === "stop") {
          stop = ev.stop;
        } else if (ev.kind === "error") {
          ctx.onEvent({ type: "error", text: ev.message });
          return;
        }
      }
    } catch (e) {
      if (ctx.signal.aborted) return;
      ctx.onEvent({ type: "error", text: String(rec(e).message ?? e) });
      return;
    }
    if (stop !== "stop" && (await execCalls(calls, messages, content, ctx, execute))) continue;
    ctx.onEvent({ type: "done", text: content });
    return;
  }
}

/** OpenAI 兼容 agent 循环（Codex / 豆包 / 自定义）：不限工具迭代轮数 */
export async function runApiLoop(
  cfg: ApiConfig,
  ctx: RunContext,
  execute: ExecFn,
  networkEnabled = true
): Promise<void> {
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    ctx.onEvent({ type: "error", text: t("fillApiCfg") });
    return;
  }
  const tools = toolDefs(networkEnabled);
  const messages: ChatMessage[] = [
    { role: "system", content: ctx.systemPrompt },
    { role: "user", content: ctx.prompt },
  ];
  const endpoint = cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";

  for (let iter = 1; ; iter++) {
    if (ctx.signal.aborted) return;
    ctx.onEvent({ type: "status", text: t("statusRequestRound", { n: iter }) });
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: cfg.model, messages, tools, stream: true }),
        signal: ctx.signal,
      });
    } catch (e) {
      if (ctx.signal.aborted) return;
      ctx.onEvent({ type: "error", text: `网络请求失败：${rec(e).message ?? e}` });
      return;
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      ctx.onEvent({ type: "error", text: `API 错误 ${res.status}：${text.slice(0, 500)}` });
      return;
    }

    let content = "";
    const calls: { id: string; name: string; args: string }[] = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          let obj: unknown;
          try {
            obj = JSON.parse(payload);
          } catch {
            continue;
          }
          const choiceRaw = arr(rec(obj).choices)[0];
          if (!choiceRaw) continue;
          const delta = rec(rec(choiceRaw).delta);
          if (delta.content) {
            content += str(delta.content);
            ctx.onEvent({ type: "text", text: str(delta.content) });
          }
          for (const tcRaw of arr(delta.tool_calls)) {
            const tc = rec(tcRaw);
            const fn = rec(tc.function);
            const i = num(tc.index);
            if (!calls[i]) calls[i] = { id: typeof tc.id === "string" ? tc.id : `call_${i}`, name: "", args: "" };
            if (tc.id) calls[i].id = str(tc.id);
            if (fn.name) calls[i].name += str(fn.name);
            if (fn.arguments) calls[i].args += str(fn.arguments);
          }
        }
      }
    } catch (e) {
      if (ctx.signal.aborted) return;
      ctx.onEvent({ type: "error", text: `流读取中断：${rec(e).message ?? e}` });
      return;
    }
    if (await execCalls(calls, messages, content, ctx, execute)) continue;
    ctx.onEvent({ type: "done", text: content });
    return;
  }
}