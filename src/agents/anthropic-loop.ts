import { RunContext } from "../types";
import { TOOL_DEFS } from "../bridge/tools";
import { t } from "../i18n";

type ExecFn = (name: string, args: Record<string, unknown>) => Promise<string>;

export interface AnthropicAuth {
  baseUrl: string;
  apiKey?: string;
  oauthToken?: string;
}

function authHeaders(auth: AnthropicAuth): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (auth.oauthToken) {
    h.Authorization = `Bearer ${auth.oauthToken}`;
    h["anthropic-beta"] = "oauth-2025-04-20";
  } else {
    h["x-api-key"] = auth.apiKey ?? "";
  }
  return h;
}

/** Anthropic Messages agent 循环（Claude Code 模型）：不限工具迭代轮数 */
export async function runAnthropicLoop(
  auth: AnthropicAuth,
  ctx: RunContext,
  execute: ExecFn,
  networkEnabled = true
): Promise<void> {
  if (!auth.apiKey && !auth.oauthToken) {
    ctx.onEvent({ type: "error", text: t("fillAnthropic") });
    return;
  }
  const tools = TOOL_DEFS.filter((t) => !t.network || networkEnabled).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
  const messages: any[] = [{ role: "user", content: ctx.prompt }];
  const endpoint = auth.baseUrl.replace(/\/+$/, "") + "/v1/messages";

  for (let iter = 1; ; iter++) {
    if (ctx.signal.aborted) return;
    ctx.onEvent({ type: "status", text: t("statusRequestClaude", { n: iter }) });
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: authHeaders(auth),
        body: JSON.stringify({
          model: ctx.model,
          max_tokens: 16000,
          system: ctx.systemPrompt,
          messages,
          tools,
          stream: true,
        }),
        signal: ctx.signal,
      });
    } catch (e: any) {
      if (ctx.signal.aborted) return;
      ctx.onEvent({ type: "error", text: `网络请求失败：${e?.message ?? e}` });
      return;
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      ctx.onEvent({ type: "error", text: `Anthropic API 错误 ${res.status}：${text.slice(0, 500)}` });
      return;
    }

    let content = "";
    let stopReason = "";
    const blocks: { type: string; id?: string; name?: string; args: string }[] = [];
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
          let obj: any;
          try {
            obj = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (obj.type === "content_block_start") {
            const cb = obj.content_block ?? {};
            blocks[obj.index] = { type: cb.type, id: cb.id, name: cb.name, args: "" };
          } else if (obj.type === "content_block_delta") {
            const d = obj.delta ?? {};
            const b = blocks[obj.index];
            if (!b) continue;
            if (d.type === "text_delta") {
              content += d.text ?? "";
              ctx.onEvent({ type: "text", text: d.text ?? "" });
            } else if (d.type === "input_json_delta") {
              b.args += d.partial_json ?? "";
            }
          } else if (obj.type === "message_delta") {
            stopReason = obj.delta?.stop_reason ?? stopReason;
          } else if (obj.type === "error") {
            ctx.onEvent({ type: "error", text: String(obj.error?.message ?? "Anthropic 流错误") });
            return;
          }
        }
      }
    } catch (e: any) {
      if (ctx.signal.aborted) return;
      ctx.onEvent({ type: "error", text: `流读取中断：${e?.message ?? e}` });
      return;
    }

    const toolBlocks = blocks.filter((b) => b?.type === "tool_use" && b.name);
    if (stopReason === "tool_use" && toolBlocks.length) {
      const assistantContent: any[] = [];
      if (content) assistantContent.push({ type: "text", text: content });
      for (const b of toolBlocks) assistantContent.push({ type: "tool_use", id: b.id, name: b.name, input: safeParse(b.args) });
      messages.push({ role: "assistant", content: assistantContent });
      const results: any[] = [];
      for (const b of toolBlocks) {
        if (ctx.signal.aborted) return;
        const args = safeParse(b.args);
        ctx.onEvent({ type: "tool_use", name: b.name!, args });
        try {
          const result = await execute(b.name!, args);
          ctx.onEvent({ type: "tool_result", text: result.slice(0, 600) });
          results.push({ type: "tool_result", tool_use_id: b.id, content: result });
        } catch (e: any) {
          const msg = String(e?.message ?? e);
          ctx.onEvent({ type: "tool_result", text: msg, isError: true });
          results.push({ type: "tool_result", tool_use_id: b.id, content: `错误：${msg}`, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
      continue;
    }
    ctx.onEvent({ type: "done", text: content });
    return;
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}