import * as http from "http";
import * as https from "https";

export async function* streamSSE(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  signal?: AbortSignal
): AsyncGenerator<string> {
  const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "http:" ? http : https;
    const body = init.body;
    const headers = init.headers ?? {};
    const r = mod.request(
      {
        hostname: u.hostname,
        port: u.port || undefined,
        path: u.pathname + u.search,
        method: init.method ?? "GET",
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
  if (res.statusCode !== 200) {
    const text = await new Promise<string>((resolve) => {
      let s = "";
      res.on("data", (d: Buffer) => (s += d.toString()));
      res.on("end", () => resolve(s));
      res.on("error", () => resolve(s));
    });
    throw new Error(`HTTP ${res.statusCode}：${text.slice(0, 300)}`);
  }
  const dec = new TextDecoder();
  let buf = "";
  try {
    for await (const chunk of res) {
      if (signal?.aborted) return;
      buf += dec.decode(chunk as Buffer, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line.startsWith("data:")) yield line.slice(5).trim();
      }
    }
    const tail = (buf + dec.decode()).trim();
    if (tail.startsWith("data:")) yield tail.slice(5).trim();
  } finally {
    res.destroy();
  }
}