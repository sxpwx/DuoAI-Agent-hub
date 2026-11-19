import { App, TFile, TFolder, normalizePath, requestUrl } from "obsidian";
import { ToolDef, ToolTier } from "../types";
import {
  assertPublicUrl,
  htmlToText,
  imageExtFromContentType,
  parseBaidu,
  parseBing,
  sanitizeFileName,
} from "./net";

const S = (type: string, description: string) => ({ type, description });

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "vault_info",
    description: "获取当前 Obsidian vault 的名称、根路径、笔记数量和顶层文件夹列表。",
    tier: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_notes",
    description: "列出 vault 中的笔记文件路径（vault 相对路径）。可选按文件夹过滤。",
    tier: "read",
    inputSchema: {
      type: "object",
      properties: {
        folder: S("string", "可选，文件夹相对路径，如 'projects'。留空列出全部。"),
        limit: S("number", "最多返回条数，默认 200。"),
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_files",
    description: "列出 vault 中的所有文件（含图片、PDF 等附件，不只是笔记），返回路径与大小。用于确认附件是否存在、实际文件名是什么。",
    tier: "read",
    inputSchema: {
      type: "object",
      properties: {
        folder: S("string", "可选，文件夹相对路径。留空列出全部。"),
        extensions: S("string", "可选，按扩展名过滤，逗号分隔，如 'jpg,png,webp'。"),
        limit: S("number", "最多返回条数，默认 300。"),
      },
      additionalProperties: false,
    },
  },
  {
    name: "read_note",
    description: "读取一篇笔记的完整 Markdown 内容。",
    tier: "read",
    inputSchema: {
      type: "object",
      properties: { path: S("string", "笔记的 vault 相对路径，如 'notes/idea.md'。") },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "search_notes",
    description: "在所有笔记中搜索文本（不区分大小写的子串匹配），返回命中路径、行号和上下文片段。",
    tier: "read",
    inputSchema: {
      type: "object",
      properties: {
        query: S("string", "搜索关键词。"),
        limit: S("number", "最多返回命中数，默认 30。"),
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_active_note",
    description: "获取用户当前在 Obsidian 中打开的笔记路径与内容。",
    tier: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "create_note",
    description: "创建新笔记。路径已存在时会失败（不会覆盖）。需要用户确认。",
    tier: "write",
    inputSchema: {
      type: "object",
      properties: {
        path: S("string", "新笔记的 vault 相对路径，自动补 .md 后缀。"),
        content: S("string", "Markdown 内容。"),
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "update_note",
    description: "用新内容完整替换一篇已有笔记。需要用户确认。",
    tier: "write",
    inputSchema: {
      type: "object",
      properties: {
        path: S("string", "笔记相对路径。"),
        content: S("string", "替换后的完整 Markdown 内容。"),
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "append_note",
    description: "在一篇已有笔记末尾追加内容。需要用户确认。",
    tier: "write",
    inputSchema: {
      type: "object",
      properties: {
        path: S("string", "笔记相对路径。"),
        content: S("string", "要追加的 Markdown 内容。"),
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "edit_note",
    description: "精确替换笔记中的一段文本（old_text 必须在笔记中唯一存在）。需要用户确认。",
    tier: "write",
    inputSchema: {
      type: "object",
      properties: {
        path: S("string", "笔记相对路径。"),
        old_text: S("string", "要被替换的原文（需精确匹配且唯一）。"),
        new_text: S("string", "替换后的文本。"),
      },
      required: ["path", "old_text", "new_text"],
      additionalProperties: false,
    },
  },
  {
    name: "rename_note",
    description: "重命名或移动一篇笔记（Obsidian 会自动更新双链）。需要用户确认。",
    tier: "write",
    inputSchema: {
      type: "object",
      properties: {
        path: S("string", "原路径。"),
        new_path: S("string", "新路径。"),
      },
      required: ["path", "new_path"],
      additionalProperties: false,
    },
  },
  {
    name: "create_folder",
    description: "创建文件夹（含中间层级）。需要用户确认。",
    tier: "write",
    inputSchema: {
      type: "object",
      properties: { path: S("string", "文件夹相对路径。") },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_note",
    description: "删除一篇笔记（移入 Obsidian 回收站，可恢复）。危险操作，需要用户强确认。",
    tier: "danger",
    inputSchema: {
      type: "object",
      properties: { path: S("string", "要删除的笔记相对路径。") },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "web_search",
    description: "联网搜索（Bing，回退百度），返回标题、链接、摘要。用于查找资料、核实信息。读取级，免确认。",
    tier: "read",
    network: true,
    inputSchema: {
      type: "object",
      properties: {
        query: S("string", "搜索关键词。"),
        limit: S("number", "最多返回结果数，默认 8。"),
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "fetch_webpage",
    description: "抓取一个公网网页并提取正文文本（去除脚本/样式/标签），用于阅读搜索结果中的文章。读取级，免确认。禁止内网地址。",
    tier: "read",
    network: true,
    inputSchema: {
      type: "object",
      properties: { url: S("string", "http/https 网页地址。") },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "add_image_to_note",
    description: "从公网 URL 下载图片，保存到 vault 附件文件夹，并在指定笔记中插入 Markdown 图片链接。写入级，需要用户确认。禁止内网地址，单张不超过 10MB。",
    tier: "write",
    network: true,
    inputSchema: {
      type: "object",
      properties: {
        note_path: S("string", "要插入图片的笔记相对路径。"),
        image_url: S("string", "图片的 http/https 直链。"),
        alt: S("string", "图片替代文本/文件名提示，可选。"),
        position: S("string", "插入位置：append（末尾，默认）或 prepend（开头）。"),
      },
      required: ["note_path", "image_url"],
      additionalProperties: false,
    },
  },
];

export function toolTier(name: string): ToolTier | null {
  return TOOL_DEFS.find((t) => t.name === name)?.tier ?? null;
}

/** 校验 vault 相对路径，拒绝越界与隐藏目录 */
export function safePath(raw: unknown, opts: { write?: boolean } = {}): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("路径不能为空");
  let p = raw.trim().replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(p) || p.startsWith("/")) throw new Error("只允许 vault 相对路径");
  p = normalizePath(p);
  if (p.split("/").some((seg) => seg === ".." || seg.startsWith("."))) {
    throw new Error("禁止访问隐藏目录或上级目录（.obsidian / .trash / .. 等）");
  }
  if (opts.write && !/\.(md|canvas)$/i.test(p)) {
    throw new Error("写入仅支持 .md / .canvas 文件");
  }
  return p;
}

function clip(s: string, n = 400): string {
  return s.length > n ? s.slice(0, n) + `…（共 ${s.length} 字符）` : s;
}

/** 生成给用户看的操作摘要 */
export function summarize(tool: string, args: Record<string, unknown>): string {
  const a = args as Record<string, string>;
  switch (tool) {
    case "create_note": return `创建笔记 ${a.path}\n内容预览：\n${clip(a.content ?? "")}`;
    case "update_note": return `完整替换笔记 ${a.path}\n新内容预览：\n${clip(a.content ?? "")}`;
    case "append_note": return `向笔记 ${a.path} 追加内容：\n${clip(a.content ?? "")}`;
    case "edit_note": return `修改笔记 ${a.path}\n原文：\n${clip(a.old_text ?? "", 200)}\n替换为：\n${clip(a.new_text ?? "", 200)}`;
    case "rename_note": return `重命名/移动笔记：${a.path} → ${a.new_path}`;
    case "create_folder": return `创建文件夹 ${a.path}`;
    case "delete_note": return `删除笔记 ${a.path}（移入回收站）`;
    case "web_search": return `联网搜索：${a.query}`;
    case "fetch_webpage": return `抓取网页：${a.url}`;
    case "add_image_to_note": return `向笔记 ${a.note_path} 插入网络图片\n图片 URL：${a.image_url}\n位置：${a.position === "prepend" ? "开头" : "末尾（默认）"}\n图片将下载到 vault 附件文件夹后以本地链接插入。`;
    default: return `${tool} ${JSON.stringify(args)}`;
  }
}

export class VaultTools {
  constructor(private app: App) {}

  private getFile(path: string): TFile {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error(`笔记不存在：${path}`);
    return f;
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const v = this.app.vault;
    switch (name) {
      case "vault_info": {
        const files = v.getMarkdownFiles();
        const tops = v.getRoot().children.filter((c) => c instanceof TFolder).map((c) => c.path);
        return JSON.stringify({ name: v.getName(), noteCount: files.length, topFolders: tops });
      }
      case "list_notes": {
        const folder = args.folder ? safePath(args.folder) : "";
        const limit = Math.min(Number(args.limit) || 200, 1000);
        let files = v.getMarkdownFiles();
        if (folder) files = files.filter((f) => f.path === folder || f.path.startsWith(folder + "/"));
        return JSON.stringify(files.slice(0, limit).map((f) => f.path));
      }
      case "list_files": {
        const folder = args.folder ? safePath(args.folder) : "";
        const limit = Math.min(Number(args.limit) || 300, 2000);
        const exts = args.extensions
          ? String(args.extensions).split(",").map((s) => s.trim().toLowerCase().replace(/^\./, "")).filter(Boolean)
          : null;
        let files = v.getFiles().filter((f) => !f.path.split("/").some((seg) => seg.startsWith(".")));
        if (folder) files = files.filter((f) => f.path.startsWith(folder + "/"));
        if (exts) files = files.filter((f) => exts.includes(f.extension.toLowerCase()));
        return JSON.stringify(files.slice(0, limit).map((f) => ({ path: f.path, size: f.stat.size })));
      }
      case "read_note": {
        const f = this.getFile(safePath(args.path));
        return await v.cachedRead(f);
      }
      case "search_notes": {
        const q = String(args.query ?? "").toLowerCase();
        if (!q) throw new Error("query 不能为空");
        const limit = Math.min(Number(args.limit) || 30, 100);
        const hits: { path: string; line: number; snippet: string }[] = [];
        for (const f of v.getMarkdownFiles()) {
          const text = await v.cachedRead(f);
          const lines = text.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(q)) {
              hits.push({ path: f.path, line: i + 1, snippet: clip(lines[i], 200) });
              if (hits.length >= limit) return JSON.stringify(hits);
            }
          }
        }
        return JSON.stringify(hits);
      }
      case "get_active_note": {
        const f = this.app.workspace.getActiveFile();
        if (!f) return JSON.stringify({ active: null });
        return JSON.stringify({ path: f.path, content: await v.cachedRead(f) });
      }
      case "create_note": {
        let p = safePath(args.path, { write: true });
        if (!/\.(md|canvas)$/i.test(p)) p += ".md";
        if (v.getAbstractFileByPath(p)) throw new Error(`已存在：${p}（如需覆盖请用 update_note）`);
        await this.ensureParent(p);
        const f = await v.create(p, String(args.content ?? ""));
        return `已创建 ${f.path}`;
      }
      case "update_note": {
        const f = this.getFile(safePath(args.path, { write: true }));
        await v.modify(f, String(args.content ?? ""));
        return `已更新 ${f.path}`;
      }
      case "append_note": {
        const f = this.getFile(safePath(args.path, { write: true }));
        const old = await v.cachedRead(f);
        const add = String(args.content ?? "");
        await v.modify(f, old + (old.endsWith("\n") || !old ? "" : "\n") + add);
        return `已追加到 ${f.path}`;
      }
      case "edit_note": {
        const f = this.getFile(safePath(args.path, { write: true }));
        const old = await v.cachedRead(f);
        const ot = String(args.old_text ?? "");
        const first = old.indexOf(ot);
        if (first < 0) throw new Error("old_text 未在笔记中找到（需精确匹配）");
        if (old.indexOf(ot, first + 1) >= 0) throw new Error("old_text 在笔记中出现多次，请提供更长的唯一片段");
        await v.modify(f, old.slice(0, first) + String(args.new_text ?? "") + old.slice(first + ot.length));
        return `已修改 ${f.path}`;
      }
      case "rename_note": {
        const f = this.getFile(safePath(args.path));
        let np = safePath(args.new_path, { write: true });
        if (!/\.(md|canvas)$/i.test(np)) np += ".md";
        if (v.getAbstractFileByPath(np)) throw new Error(`目标已存在：${np}`);
        await this.ensureParent(np);
        await this.app.fileManager.renameFile(f, np);
        return `已重命名 ${f.path} → ${np}`;
      }
      case "create_folder": {
        const p = safePath(args.path);
        if (v.getAbstractFileByPath(p)) throw new Error(`已存在：${p}`);
        await v.createFolder(p);
        return `已创建文件夹 ${p}`;
      }
      case "delete_note": {
        const f = this.getFile(safePath(args.path));
        await this.app.vault.trash(f, true);
        return `已删除 ${f.path}（移入系统回收站，可恢复）`;
      }
      case "web_search": {
        const q = String(args.query ?? "").trim();
        if (!q) throw new Error("query 不能为空");
        const limit = Math.min(Number(args.limit) || 8, 15);
        let hits = await this.searchEngine(`https://cn.bing.com/search?q=${encodeURIComponent(q)}&count=${limit}`, parseBing, limit);
        let engine = "bing";
        if (!hits.length) {
          hits = await this.searchEngine(`https://www.baidu.com/s?wd=${encodeURIComponent(q)}&rn=${limit}`, parseBaidu, limit);
          engine = "baidu";
        }
        if (!hits.length) throw new Error("搜索无结果或搜索引擎不可达，可换关键词重试");
        return JSON.stringify({ engine, results: hits });
      }
      case "fetch_webpage": {
        const u = assertPublicUrl(String(args.url ?? ""));
        const r = await requestUrl({ url: u.toString(), headers: { "User-Agent": UA } });
        if (r.status >= 400) throw new Error(`网页请求失败 HTTP ${r.status}`);
        const { title, text } = htmlToText(r.text);
        if (!text.trim()) throw new Error("网页无可提取正文（可能是纯脚本页面）");
        return JSON.stringify({ url: u.toString(), title, text });
      }
      case "add_image_to_note": {
        const notePath = safePath(args.note_path, { write: true });
        const f = this.getFile(notePath);
        const u = assertPublicUrl(String(args.image_url ?? ""));
        const r = await requestUrl({ url: u.toString(), headers: { "User-Agent": UA } });
        if (r.status >= 400) throw new Error(`图片下载失败 HTTP ${r.status}`);
        const ct = (r.headers?.["content-type"] ?? r.headers?.["Content-Type"] ?? "").toLowerCase();
        if (ct && !ct.startsWith("image/")) throw new Error(`目标不是图片（content-type: ${ct}）`);
        const buf = r.arrayBuffer;
        if (!buf || buf.byteLength === 0) throw new Error("图片内容为空");
        if (buf.byteLength > 10 * 1024 * 1024) throw new Error("图片超过 10MB 限制");
        const ext = imageExtFromContentType(ct, u.toString());
        const folder = this.attachmentFolder(notePath);
        if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
          await this.app.vault.createFolder(folder);
        }
        const base = sanitizeFileName(String(args.alt ?? "image"));
        let name = `${base}-${Date.now()}.${ext}`;
        let imgPath = normalizePath(folder ? `${folder}/${name}` : name);
        let n = 1;
        while (this.app.vault.getAbstractFileByPath(imgPath)) {
          name = `${base}-${Date.now()}-${n++}.${ext}`;
          imgPath = normalizePath(folder ? `${folder}/${name}` : name);
        }
        await this.app.vault.createBinary(imgPath, buf);
        const alt = String(args.alt ?? "").replace(/[\[\]]/g, "");
        const link = `![${alt}](${encodeURI(imgPath)})`;
        const old = await this.app.vault.cachedRead(f);
        const content = args.position === "prepend" ? link + "\n\n" + old : old + (old.endsWith("\n") || !old ? "" : "\n") + "\n" + link;
        await this.app.vault.modify(f, content);
        return `已下载图片（${(buf.byteLength / 1024).toFixed(0)}KB）保存到 ${imgPath}，并插入笔记 ${notePath}`;
      }
      default:
        throw new Error(`未知工具：${name}`);
    }
  }

  private async searchEngine(
    url: string,
    parse: (html: string, limit: number) => { title: string; url: string; snippet: string }[],
    limit: number
  ) {
    try {
      const r = await requestUrl({ url, headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" } });
      if (r.status >= 400) return [];
      return parse(r.text, limit);
    } catch {
      return [];
    }
  }

  /** 依据 Obsidian 附件文件夹设置解析目标目录 */
  private attachmentFolder(notePath: string): string {
    const cfg = String((this.app.vault as any).getConfig?.("attachmentFolderPath") ?? "attachments");
    const noteDir = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
    let folder: string;
    if (cfg.startsWith("./")) folder = normalizePath([noteDir, cfg.slice(2)].filter(Boolean).join("/"));
    else if (cfg.startsWith("/")) folder = normalizePath(cfg.slice(1));
    else folder = normalizePath(cfg || "attachments");
    if (folder.split("/").some((seg) => seg === ".." || !seg)) throw new Error("附件文件夹配置无效");
    return folder;
  }

  private async ensureParent(p: string) {
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    if (dir && !this.app.vault.getAbstractFileByPath(dir)) {
      await this.app.vault.createFolder(dir);
    }
  }
}