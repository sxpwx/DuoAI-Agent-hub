import { RunContext } from "../types";
import { TOOL_DEFS } from "../bridge/tools";
import { t } from "../i18n";

type ExecFn = (name: string, args: Record<string, unknown>) => Promise<string>;

const ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";

/** OpenAI 消息 → Responses API input items */
function toInput(messages: any[]): any[] {
  const out: any[] = [];
  for (const m of messages) {
    if (m.role === "system" || m.role === "developer") continue;
    if (m.role === "user") {
      out.push({ role: "user", content: [{ type: "input_text", text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }] });
    } else if (m.role === "assistant") {
      if (m.content) out.push({ role: "assistant", content: [{ type: "output_text", text: String(m.content) }] });
      for (const tc of m.tool_calls ?? []) {
        out.push({ type: "function_call", call_id: tc.id, name: tc.function?.name, arguments: tc.function?.arguments ?? "{}" });
      }
    } else if (m.role === "tool") {
      out.push({ type: "function_call_output", call_id: m.tool_call_id, output: String(m.content ?? "") });
    }
  }
  return out;
}

/** Codex（ChatGPT 订阅 OAuth）agent 循环：不限轮数 */
export async function runCodexOAuthLoop(
  accessToken: string,
  ctx: RunContext,
  execute: ExecFn,
  networkEnabled = true,
  onRefresh?: () => Promise<string | null>
): Promise<void> {
  const tools = TOOL_DEFS.filter((tl) => !tl.network || networkEnabled).map((tl) => ({
    type: "function",
    name: tl.name,
    description: tl.description,
    parameters: tl.inputSchema,
    strict: false,
  }));
  const messages: any[] = [
    { role: "system", content: ctx.systemPrompt },
    { role: "user", content: ctx.prompt },
  ];
  let token = accessToken;
  const sessionId = crypto.randomUUID();

  for (let iter = 1; ; iter++) {
    if (ctx.signal.aborted) return;
    ctx.onEvent({ type: "status", text: t("statusRequestRound", { n: iter }) });
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "OpenAI-Beta": "responses=experimental",
          originator: "codex_cli_rs",
          session_id: sessionId,
        },
        body: JSON.stringify({
          model: ctx.model,
          instructions: ctx.systemPrompt,
          input: toInput(messages),
          tools,
          stream: true,
          store: false,
        }),
        signal: ctx.signal,
      });
    } catch (e: any) {
      if (ctx.signal.aborted) return;
      ctx.onEvent({ type: "error", text: `Network / 网络: ${e?.message ?? e}` });
      return;
    }
    if (res.status === 401 && onRefresh) {
      const nt = await onRefresh();
      if (nt) {
        token = nt;
        continue;
      }
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      ctx.onEvent({ type: "error", text: `Codex API ${res.status}: ${text.slice(0, 400)}` });
      return;
    }

    let content = "";
    let completed = false;
    const calls = new Map<string, { call_id: string; name: string; args: string }>();
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
          let ev: any;
          try {
            ev = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          const et = ev.type ?? "";
          if (et === "response.output_text.delta") {
            content += ev.delta ?? "";
            ctx.onEvent({ type: "text", text: ev.delta ?? "" });
          } else if (et === "response.output_item.added" && ev.item?.type === "function_call") {
            calls.set(ev.item.id ?? ev.item.call_id, { call_id: ev.item.call_id, name: ev.item.name, args: "" });
          } else if (et === "response.function_call_arguments.delta") {
            const c = calls.get(ev.item_id);
            if (c) c.args += ev.delta ?? "";
          } else if (et === "response.output_item.done" && ev.item?.type === "function_call") {
            const c = calls.get(ev.item.id ?? ev.item.call_id);
            if (c && ev.item.arguments) c.args = ev.item.arguments;
          } else if (et === "response.completed") {
            completed = true;
          } else if (et === "response.failed" || et === "error") {
            ctx.onEvent({ type: "error", text: String(ev.error?.message ?? ev.message ?? "Codex stream error") });
            return;
          }
        }
      }
    } catch (e: any) {
      if (ctx.signal.aborted) return;
      ctx.onEvent({ type: "error", text: `Stream / 流: ${e?.message ?? e}` });
      return;
    }

    const list = [...calls.values()].filter((c) => c.name);
    if (completed && list.length) {
      const assistantContent: any[] = [];
      if (content) assistantContent.push({ type: "output_text", text: content });
      messages.push({
        role: "assistant",
        content: content || "",
        tool_calls: list.map((c) => ({ id: c.call_id, type: "function", function: { name: c.name, arguments: c.args || "{}" } })),
      });
      for (const c of list) {
        if (ctx.signal.aborted) return;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(c.args || "{}");
        } catch {
          /* tool-side error */
        }
        ctx.onEvent({ type: "tool_use", name: c.name, args });
        try {
          const result = await execute(c.name, args);
          ctx.onEvent({ type: "tool_result", text: result.slice(0, 600) });
          messages.push({ role: "tool", tool_call_id: c.call_id, content: result });
        } catch (e: any) {
          const msg = String(e?.message ?? e);
          ctx.onEvent({ type: "tool_result", text: msg, isError: true });
          messages.push({ role: "tool", tool_call_id: c.call_id, content: `Error / 错误: ${msg}` });
        }
      }
      continue;
    }
    ctx.onEvent({ type: "done", text: content });
    return;
  }
}