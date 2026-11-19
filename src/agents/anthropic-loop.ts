import { RunContext } from "../types";
import { TOOL_DEFS } from "../bridge/tools";
import { t } from "../i18n";
import { num, rec, str } from "./guards";
import { streamSSE } from "./http-stream";

type ExecFn = (name: string, args: Record<string, unknown>) => Promise<string>;

export interface AnthropicAuth {
  baseUrl: string;
  apiKey?: string;
  oauthToken?: string;
}

interface ChatMessage {
  role: string;
  content?: unknown;
}

interface AssistantBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface ToolResultBlock {
  type: string;
  tool_use_id?: string;
  content: string;
  is_error?: boolean;
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
  networkEnabled = true,
  onRefresh?: () => Promise<string | null>
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
  const messages: ChatMessage[] = [{ role: "user", content: ctx.prompt }];
  const endpoint = auth.baseUrl.replace(/\/+$/, "") + "/v1/messages";

  let refreshed = false;
  for (let iter = 1; ; iter++) {
    if (ctx.signal.aborted) return;
    ctx.onEvent({ type: "status", text: t("statusRequestClaude", { n: iter }) });

    let content = "";
    let stopReason = "";
    const blocks: { type: string; id?: string; name?: string; args: string }[] = [];
    try {
      const stream = streamSSE(
        endpoint,
        {
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
        },
        ctx.signal
      );
      for await (const payload of stream) {
        if (ctx.signal.aborted) return;
        let obj: unknown;
        try {
          obj = JSON.parse(payload);
        } catch {
          continue;
        }
        const o = rec(obj);
        if (o.type === "content_block_start") {
          const cb = rec(o.content_block);
          blocks[num(o.index)] = {
            type: str(cb.type),
            id: typeof cb.id === "string" ? cb.id : undefined,
            name: typeof cb.name === "string" ? cb.name : undefined,
            args: "",
          };
        } else if (o.type === "content_block_delta") {
          const d = rec(o.delta);
          const b = blocks[num(o.index)];
          if (!b) continue;
          if (d.type === "text_delta") {
            content += str(d.text);
            ctx.onEvent({ type: "text", text: str(d.text) });
          } else if (d.type === "input_json_delta") {
            b.args += str(d.partial_json);
          }
        } else if (o.type === "message_delta") {
          const sr = rec(o.delta).stop_reason;
          stopReason = typeof sr === "string" ? sr : stopReason;
        } else if (o.type === "error") {
          ctx.onEvent({ type: "error", text: String(rec(o.error).message ?? "Anthropic 流错误") });
          return;
        }
      }
    } catch (e) {
      if (ctx.signal.aborted) return;
      const msg = String(rec(e).message ?? e);
      if (msg.includes("401") && onRefresh && auth.oauthToken && !refreshed) {
        const nt = await onRefresh();
        if (nt) {
          auth.oauthToken = nt;
          refreshed = true;
          continue;
        }
      }
      ctx.onEvent({ type: "error", text: msg.startsWith("HTTP") ? `Anthropic API 错误 ${msg}` : `网络请求失败：${msg}` });
      return;
    }

    const toolBlocks = blocks.filter((b) => b?.type === "tool_use" && b.name);
    if (stopReason === "tool_use" && toolBlocks.length) {
      const assistantContent: AssistantBlock[] = [];
      if (content) assistantContent.push({ type: "text", text: content });
      for (const b of toolBlocks) assistantContent.push({ type: "tool_use", id: b.id, name: b.name, input: safeParse(b.args) });
      messages.push({ role: "assistant", content: assistantContent });
      const results: ToolResultBlock[] = [];
      for (const b of toolBlocks) {
        if (ctx.signal.aborted) return;
        const args = safeParse(b.args);
        ctx.onEvent({ type: "tool_use", name: b.name!, args });
        try {
          const result = await execute(b.name!, args);
          ctx.onEvent({ type: "tool_result", text: result.slice(0, 600) });
          results.push({ type: "tool_result", tool_use_id: b.id, content: result });
        } catch (e) {
          const msg = String(rec(e).message ?? e);
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
    return rec(JSON.parse(s || "{}"));
  } catch {
    return {};
  }
}