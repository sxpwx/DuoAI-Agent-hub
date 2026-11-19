export type PermissionMode = "confirm" | "full";
export type ToolTier = "read" | "write" | "danger";

export interface ToolDef {
  name: string;
  description: string;
  tier: ToolTier;
  /** 联网类工具，可在设置中整体禁用 */
  network?: boolean;
  inputSchema: Record<string, unknown>;
}

export interface ConfirmRequest {
  tool: string;
  tier: ToolTier;
  args: Record<string, unknown>;
  summary: string;
}

export type ConfirmDecision = "allow" | "deny" | "allow-session";

/** 由 UI 提供：弹出确认框，返回用户决定 */
export type ConfirmHandler = (req: ConfirmRequest) => Promise<ConfirmDecision>;

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; text: string; isError?: boolean }
  | { type: "done"; text: string }
  | { type: "error"; text: string };

export interface BridgeInfo {
  /** 用于启动 MCP 子进程的 Node 可执行文件 */
  nodeExe: string;
  /** mcp-bridge.js 绝对路径 */
  scriptPath: string;
  url: string;
  token: string;
  /** nodeExe 为 Electron 时需要 ELECTRON_RUN_AS_NODE=1 */
  electronRunAsNode: boolean;
}

export interface RunContext {
  prompt: string;
  model: string;
  vaultPath: string;
  vaultName: string;
  /** mcpServers 配置 JSON 字符串 */
  mcpConfigJson: string;
  bridge: BridgeInfo;
  systemPrompt: string;
  signal: AbortSignal;
  onEvent: (e: AgentEvent) => void;
  /** 注入 CLI 子进程的环境变量（如 PAT 令牌） */
  cliEnv?: Record<string, string>;
}

export interface DetectResult {
  available: boolean;
  path?: string;
  detail?: string;
}

export interface CliLoginSpec {
  /** 登录子命令（会自动打开浏览器授权页）；空数组表示启动交互式 REPL */
  loginArgs: string[];
  /** 启动后向 stdin 写入的行（如 REPL 的 /login），保持 stdin 打开 */
  stdinLine?: string;
  /** 登录状态查询子命令 */
  statusArgs: string[];
  /** 解析状态输出：true 已登录 / false 未登录 / null 无法判断 */
  parse: (stdout: string) => boolean | null;
  /** 自定义登录流程标识 */
  custom?: string;
}

export interface CliAgentSpec {
  kind: "cli";
  id: string;
  label: string;
  protocol: "claude" | "codex" | "opencode" | "qwenwork";
  /** PATH 中候选命令名 */
  commands: string[];
  /** 额外探测（如千问办公逐版本安装目录），返回绝对路径 */
  detectExtra?: () => string | null;
  models: string[];
  dynamicModels?: (exe: string) => Promise<string[]>;
  installHint: string;
  login?: CliLoginSpec;
  buildArgs: (exe: string, ctx: RunContext) => string[];
  /** stdin 发送 stream-json 消息（true）还是纯文本（false） */
  stdinJson: boolean;
  /** 保守回退参数（主参数含不被支持的选项时重试） */
  fallbackArgs?: (exe: string, ctx: RunContext) => string[];
}

/** 内置协议 agent：无需外部 CLI，插件内直接完成鉴权与模型调用 */
export interface NativeAgentSpec {
  kind: "native";
  id: string;
  label: string;
  protocol: "cosy" | "anthropic" | "openai" | "openai-compat";
  /** cosy 站点 id（qwenwork / qoder-cn） */
  site?: string;
  /** 凭据获取方式 */
  cred: "device" | "device+pat" | "key" | "key+oauth";
  /** 官方 OAuth 提供方（浏览器弹窗授权） */
  oauth?: "anthropic" | "openai";
  baseUrl?: string;
  models: string[];
  dynamic?: "cosy" | "anthropic" | "openai";
}

export type AgentSpec = CliAgentSpec | NativeAgentSpec;

export interface AgentCredential {
  apiKey?: string;
  pat?: string;
  oauthToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  baseUrl?: string;
}

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface StoredMessage {
  role: "user" | "assistant" | "error" | "tool";
  text?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  ts: number;
}

export interface Conversation {
  id: string;
  title: string;
  agentId: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
}

export interface AgentHubSettings {
  permissionMode: PermissionMode;
  networkTools: boolean;
  language: "auto" | "zh" | "en";
  confirmTimeoutSec: number;
  selectedAgent: string;
  selectedModels: Record<string, string>;
  cliPaths: Record<string, string>;
  credentials: Record<string, AgentCredential>;
}

export const DEFAULT_SETTINGS: AgentHubSettings = {
  permissionMode: "confirm",
  networkTools: true,
  language: "auto",
  confirmTimeoutSec: 180,
  selectedAgent: "qwenwork",
  selectedModels: {},
  cliPaths: {},
  credentials: {},
};