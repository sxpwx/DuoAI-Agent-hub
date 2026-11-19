import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AgentSpec, CliAgentSpec, NativeAgentSpec, RunContext } from "../types";
import { detectQwenworkCli, isGuiExe, whichSync } from "./detect";
import { COSY_SITES } from "./qwenwork-chat";

const MODEL_RE = /^[\w.\-\/]+$/;

function modelArgs(flag: string, model: string): string[] {
  return model && model !== "default" && MODEL_RE.test(model) ? [flag, model] : [];
}

/** 千问办公：内置 COSY 协议 + 设备流登录（与桌面端同账号） */
const qwenwork: NativeAgentSpec = {
  kind: "native",
  id: "qwenwork",
  label: "千问办公",
  description: "千问办公账号（gateway.qwenwork.cn 设备流登录，与桌面端一致），内置协议，无需 CLI",
  protocol: "cosy",
  site: "qwenwork",
  cred: "device",
  models: COSY_SITES.qwenwork.modelsFallback.map((m) => m.key),
  dynamic: "cosy",
  loginHint: "选择后自动弹出登录授权：浏览器打开千问办公登录页（手机号/邮箱，与桌面端同账号）。",
};

/** Qoder CN：内置 COSY 协议 + 设备流/PAT 登录（独立账号体系） */
const qoder: NativeAgentSpec = {
  kind: "native",
  id: "qoder",
  label: "Qoder CN",
  description: "Qoder CN 账号（独立于千问办公，积分不互通），内置协议，设备流或 PAT 登录",
  protocol: "cosy",
  site: "qoder-cn",
  cred: "device+pat",
  models: COSY_SITES["qoder-cn"].modelsFallback.map((m) => m.key),
  dynamic: "cosy",
  loginHint: "选择后自动弹出登录授权（Qoder CN 账号）；也可在设置中粘贴 PAT。",
};

/** Claude Code：内置 Anthropic Messages 协议（API Key 或本机 OAuth 登录态） */
const claude: NativeAgentSpec = {
  kind: "native",
  id: "claude",
  label: "Claude Code",
  description: "Anthropic 官方模型，内置 Messages 协议；API Key 或读取本机 Claude Code 登录态",
  protocol: "anthropic",
  cred: "key+oauth",
  baseUrl: "https://api.anthropic.com",
  models: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5", "claude-opus-4-1", "claude-sonnet-4-0"],
  dynamic: "anthropic",
  loginHint: "在设置中填入 Anthropic API Key，或点击「读取本机 Claude Code 登录态」。",
};

/** Codex：内置 OpenAI 协议（API Key） */
const codex: NativeAgentSpec = {
  kind: "native",
  id: "codex",
  label: "Codex",
  description: "OpenAI 官方模型（GPT-5 / Codex 系列），内置 OpenAI 协议，API Key 鉴权",
  protocol: "openai",
  cred: "key",
  baseUrl: "https://api.openai.com/v1",
  models: ["gpt-5-codex", "gpt-5", "gpt-5-mini", "o4-mini"],
  dynamic: "openai",
  loginHint: "在设置中填入 OpenAI API Key。",
};

/** WorkBuddy：应用内自动管理官方 CLI（自动安装 + 自动登录弹窗） */
const workbuddy: CliAgentSpec = {
  kind: "cli",
  id: "workbuddy",
  label: "WorkBuddy",
  description: "腾讯 WorkBuddy 官方 CLI（codebuddy），应用内自动安装与登录",
  protocol: "claude",
  commands: ["codebuddy", "workbuddy"],
  detectExtra: () => {
    const appdata = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    const candidates = [
      path.join(appdata, "npm", "node_modules", "@tencent-ai", "codebuddy-code", "bin", "codebuddy"),
      path.join(os.homedir(), ".workbuddy", "bin", "codebuddy"),
    ];
    return candidates.find((p) => fs.existsSync(p)) ?? null;
  },
  models: ["auto", "hy3", "hy3-x", "glm-5.3", "glm-5.2", "glm-5.1", "glm-5v-turbo", "minimax-m3", "kimi-k3-1", "kimi-k2.7", "kimi-k2.6", "deepseek-v4-flash", "deepseek-v4-pro"],
  installHint: "npm install -g @tencent-ai/codebuddy-code",
  loginHint: "选择该 Agent 后自动弹出登录授权（浏览器完成）。",
  login: {
    loginArgs: [],
    stdinLine: "/login",
    statusArgs: ["-p", "--output-format", "json", "--tools", "", "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}", "ping"],
    parse: (out) => {
      if (/authentication required|not logged in|please use \/login|login required/i.test(out)) return false;
      try {
        const j = JSON.parse(out);
        if (j && (j.result !== undefined || j.type === "result")) return !j.is_error;
        return null;
      } catch {
        return null;
      }
    },
    custom: "codebuddy-repl",
  },
  stdinJson: true,
  buildArgs: (_exe, ctx) => [
    "-p",
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--verbose",
    "--permission-mode", "bypassPermissions",
    "--strict-mcp-config",
    "--mcp-config", ctx.mcpConfigJson,
    "--tools", "",
    ...modelArgs("--model", ctx.model),
  ],
  fallbackArgs: (_exe, ctx) => [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", "bypassPermissions",
    "--strict-mcp-config",
    "--mcp-config", ctx.mcpConfigJson,
    "--allowedTools", "mcp__obsidian",
    ...modelArgs("--model", ctx.model),
  ],
};

/** 豆包办公：火山方舟 OpenAI 兼容协议 */
const doubao: NativeAgentSpec = {
  kind: "native",
  id: "doubao",
  label: "豆包办公",
  description: "火山方舟 API（OpenAI 兼容），内置 agent 循环",
  protocol: "openai-compat",
  cred: "key",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  models: ["doubao-seed-1-6-250615", "doubao-seed-1-6-flash-250615", "doubao-1-5-pro-32k-250115"],
  loginHint: "在设置中填入火山方舟 API Key 与模型 ID（或推理接入点 ep-xxx）。",
};

/** 自定义：任意 OpenAI 兼容 API */
const custom: NativeAgentSpec = {
  kind: "native",
  id: "custom",
  label: "自定义 API",
  description: "任意 OpenAI 兼容 API（DeepSeek / Kimi / GLM / Ollama 等）",
  protocol: "openai-compat",
  cred: "key",
  models: [],
  loginHint: "在设置中填入 Base URL、API Key 与模型 ID。",
};

export const AGENTS: AgentSpec[] = [qwenwork, qoder, workbuddy, claude, codex, doubao, custom];

export function getAgent(id: string): AgentSpec | undefined {
  return AGENTS.find((a) => a.id === id);
}

export function detectCli(spec: CliAgentSpec, override?: string): { available: boolean; path?: string; detail?: string } {
  const guiOverride = override && isGuiExe(override) ? override : null;
  if (override && !guiOverride) {
    return { available: true, path: override, detail: "手动指定" };
  }
  for (const cmd of spec.commands) {
    const p = whichSync(cmd);
    if (p && !isGuiExe(p)) return { available: true, path: p };
  }
  const extra = spec.detectExtra?.();
  if (extra && !isGuiExe(extra)) return { available: true, path: extra };
  return {
    available: false,
    detail: guiOverride
      ? `设置中的路径 ${guiOverride} 是桌面 GUI，不能用作 CLI，已忽略。${spec.installHint}`
      : spec.installHint,
  };
}

export function buildSystemPrompt(vaultName: string): string {
  return [
    `你是 Obsidian 笔记库「${vaultName}」的操作助手。`,
    "你只能通过 obsidian 工具读取和修改这个笔记库，没有任何其他工具（无 shell、无直接文件系统访问）。",
    "规则：",
    "1. 所有路径使用 vault 相对路径（如 notes/idea.md），不要使用绝对路径，不要访问 .obsidian 等隐藏目录。",
    "2. 修改前先 read_note 了解现状；精确修改优先用 edit_note，避免整篇覆盖。",
    "3. 写入/删除操作会弹出确认框由用户批准；被拒绝时调整方案或询问用户，不要反复重试同一操作。",
    "4. 不要尝试执行命令或操作笔记库以外的本地内容。",
    "5. 你可以联网：用 web_search 搜索资料、fetch_webpage 阅读网页原文、add_image_to_note 下载图片并插入笔记。引用信息时注明来源链接；图片必须先落盘再引用，不要直接贴外部图链。",
    "6. 回答使用中文，简洁说明你做了什么、改动了哪些笔记。",
  ].join("\n");
}