/** 联网工具纯逻辑：URL 安全校验、搜索结果解析、网页正文提取（无 Obsidian 依赖，可独立测试） */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** 仅允许公网 http/https，阻断内网/回环/链路本地地址（SSRF 防护） */
export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`无效 URL：${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("仅支持 http/https 协议");
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h === "::1" || h === "0.0.0.0") {
    throw new Error("禁止访问本地/内网地址");
  }
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    if (
      a === 10 || a === 127 || a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      throw new Error("禁止访问本地/内网地址");
    }
  }
  return u;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ensp;/g, " ")
    .replace(/&emsp;/g, " ")
    .replace(/&thinsp;/g, " ")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** 解析 Bing 搜索结果页 */
export function parseBing(html: string, limit: number): SearchHit[] {
  const hits: SearchHit[] = [];
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ?? [];
  for (const b of blocks) {
    const a = b.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const url = decodeEntities(a[1]);
    if (!/^https?:\/\//.test(url)) continue;
    const sn = b.match(/<p[^>]*>([\s\S]*?)<\/p>/) ?? b.match(/<div class="b_caption"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
    hits.push({ title: stripTags(a[2]), url, snippet: sn ? stripTags(sn[1]).slice(0, 300) : "" });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** 解析百度搜索结果页（Bing 不可用时的回退） */
export function parseBaidu(html: string, limit: number): SearchHit[] {
  const hits: SearchHit[] = [];
  const blocks = html.match(/<div class="result[\s\S]*?(?=<div class="result|<div id="page|<\/div>\s*<\/div>\s*<\/div>)/g) ?? [];
  for (const b of blocks) {
    const a = b.match(/<h3[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const url = decodeEntities(a[1]);
    if (!/^https?:\/\//.test(url)) continue;
    const sn = b.match(/<span class="content-right_[^"]*">([\s\S]*?)<\/span>/) ?? b.match(/<div class="c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    hits.push({ title: stripTags(a[2]), url, snippet: sn ? stripTags(sn[1]).slice(0, 300) : "" });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** HTML → 可读正文 */
export function htmlToText(html: string, maxLen = 8000): { title: string; text: string } {
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n");
  const text = decodeEntities(body.replace(/<[^>]*>/g, " "))
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { title, text: text.length > maxLen ? text.slice(0, maxLen) + `\n…（正文已截断，共 ${text.length} 字符）` : text };
}

export function imageExtFromContentType(ct: string, url: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/x-icon": "ico",
    "image/vnd.microsoft.icon": "ico",
    "image/avif": "avif",
  };
  const base = ct.split(";")[0].trim().toLowerCase();
  if (map[base]) return map[base];
  const m = url.match(/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)(?:[?#]|$)/i);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "png";
}

export function sanitizeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image";
}