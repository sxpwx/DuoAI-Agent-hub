import { AgentCredential, NativeAgentSpec } from "../types";
import { fetchCosyModels, CosyCred } from "./qwenwork-chat";
import { arr, rec } from "./guards";

/** 拉取与各产品客户端一致的模型目录；失败回退内置清单 */
export async function fetchDynamicModels(
  spec: NativeAgentSpec,
  cred: AgentCredential | undefined,
  cosyCred: CosyCred | null
): Promise<string[]> {
  try {
    if (spec.dynamic === "cosy" && cosyCred && spec.site) {
      const list = await fetchCosyModels(cosyCred, spec.site);
      if (list.length) return list.map((m) => m.key);
      return [];
    }
    const base = (cred?.baseUrl || spec.baseUrl || "").replace(/\/+$/, "");
    const key = cred?.apiKey || cred?.oauthToken;
    if (!base || !key) return [];
    const headers: Record<string, string> =
      spec.dynamic === "anthropic"
        ? cred?.oauthToken
          ? { Authorization: `Bearer ${cred.oauthToken}`, "anthropic-version": "2023-06-01", "anthropic-beta": "oauth-2025-04-20" }
          : { "x-api-key": key, "anthropic-version": "2023-06-01" }
        : { Authorization: `Bearer ${key}` };
    const res = await fetch(base + "/v1/models", { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const json = rec(await res.json());
    const ids: string[] = arr(json.data).map((m) => String(rec(m).id ?? "")).filter(Boolean);
    if (spec.dynamic === "openai") return ids.filter((id) => /^(gpt-|o1|o3|o4|chatgpt)/.test(id));
    return ids;
  } catch {
    return [];
  }
}