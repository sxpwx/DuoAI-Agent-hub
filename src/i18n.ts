import { moment } from "obsidian";

export type Lang = "zh" | "en";
let override: Lang | "auto" = "auto";

export function setLangOverride(v: Lang | "auto") {
  override = v;
}

export function getLang(): Lang {
  if (override === "zh" || override === "en") return override;
  const loc = (moment.locale?.() ?? "en").toLowerCase();
  return loc.startsWith("zh") ? "zh" : "en";
}

const D: Record<string, { zh: string; en: string }> = {
  // common
  send: { zh: "发送", en: "Send" },
  stop: { zh: "停止", en: "Stop" },
  copy: { zh: "复制", en: "Copy" },
  resend: { zh: "重新发送", en: "Resend" },
  cancel: { zh: "取消", en: "Cancel" },
  retry: { zh: "重试", en: "Retry" },
  allow: { zh: "允许", en: "Allow" },
  deny: { zh: "拒绝", en: "Deny" },
  allowSession: { zh: "允许本次会话全部操作", en: "Allow all for this session" },
  confirmExecute: { zh: "确认执行", en: "Confirm" },
  history: { zh: "历史", en: "History" },
  newSession: { zh: "新会话", en: "New session" },
  login: { zh: "登录", en: "Sign in" },
  refreshModels: { zh: "刷新模型列表", en: "Refresh model list" },
  permConfirm: { zh: "权限：需确认", en: "Perms: confirm" },
  permFull: { zh: "权限：最高", en: "Perms: full" },
  permConfirmTip: { zh: "当前重要操作需确认，点击切换最高权限", en: "Important actions need confirmation; click for full access" },
  permFullTip: { zh: "当前为最高权限，点击恢复确认模式", en: "Full access enabled; click to restore confirmation" },
  copied: { zh: "已复制到剪贴板", en: "Copied to clipboard" },
  copyFail: { zh: "复制失败", en: "Copy failed" },
  // chat view
  chatEmpty: {
    zh: "选择 Agent 与模型后输入任务，例如：\n「总结 projects 文件夹下的所有笔记，生成一篇周报」\n\nAgent 只能操作当前 vault；写入/删除默认需要你确认。\n顶栏「历史」可查看和继续过去的会话。",
    en: "Pick an agent and model, then type a task, e.g.:\n\"Summarize all notes under projects and write a weekly report\"\n\nAgents can only operate on this vault; writes/deletes need your confirmation by default.\nUse \"History\" in the header to review and continue past sessions.",
  },
  chatPlaceholder: {
    zh: "描述你想让 Agent 对笔记库做什么…（Enter 发送，Shift+Enter 换行）",
    en: "Describe what the agent should do with your vault… (Enter to send, Shift+Enter for newline)",
  },
  roleMe: { zh: "我", en: "Me" },
  roleAgent: { zh: "Agent", en: "Agent" },
  roleError: { zh: "错误", en: "Error" },
  tierRead: { zh: "读取", en: "read" },
  tierWrite: { zh: "写入", en: "write" },
  tierDanger: { zh: "危险", en: "danger" },
  toolRunning: { zh: "执行中…", en: "running…" },
  toolDone: { zh: "完成", en: "done" },
  toolFailed: { zh: "失败/被拒绝", en: "failed/denied" },
  params: { zh: "参数", en: "Arguments" },
  statusReady: { zh: "就绪", en: "Ready" },
  statusRunning: { zh: "Agent 运行中…", en: "Agent running…" },
  statusStopping: { zh: "正在停止…", en: "Stopping…" },
  statusStopped: { zh: "已停止", en: "Stopped" },
  statusDone: { zh: "完成", en: "Done" },
  statusError: { zh: "出错", en: "Error" },
  statusBuiltin: { zh: "内置协议 · 无需 CLI", en: "Built-in protocol · no CLI needed" },
  statusNotLogged: { zh: "未登录/未配置凭据 · 自动弹出配置窗口", en: "Not signed in / no credentials · opening setup" },
  statusNewSession: { zh: "新会话已开始", en: "New session started" },
  statusLoadedHistory: { zh: "已加载历史会话「{title}」，可直接继续对话", en: "Loaded session \"{title}\" — continue chatting directly" },
  statusFetchingModels: { zh: "正在获取模型列表…", en: "Fetching model list…" },
  statusCliMissing: { zh: "未检测到 CLI · {hint}", en: "CLI not found · {hint}" },
  statusRequestRound: { zh: "请求模型（第 {n} 轮）…", en: "Model request (round {n})…" },
  statusRequestClaude: { zh: "请求 Claude（第 {n} 轮）…", en: "Claude request (round {n})…" },
  runException: { zh: "运行异常：{err}", en: "Run exception: {err}" },
  runningStopFirst: { zh: "Agent 运行中，请先停止", en: "Agent is running; stop it first" },
  bridgeNotStarted: { zh: "本地桥未启动，无法运行 Agent。请重启插件。", en: "Local bridge not started; cannot run agents. Reload the plugin." },
  notLoggedInAgent: { zh: "{agent}尚未登录。请点击顶栏「登录」完成授权。", en: "{agent} is not signed in. Click \"Sign in\" in the header." },
  cliMissing: { zh: "未检测到 {agent} CLI。\n安装方式：{hint}", en: "{agent} CLI not found.\nInstall: {hint}" },
  fillApiCfg: { zh: "请先在设置中配置 Base URL、API Key 和模型 ID。", en: "Configure Base URL, API Key and model ID in settings first." },
  fillAnthropic: { zh: "请先在设置中填入 Anthropic API Key，或读取本机 Claude Code 登录态。", en: "Set an Anthropic API Key in settings, or read the local Claude Code sign-in." },
  // confirm modal
  confirmWriteTitle: { zh: "写入操作确认：{tool}", en: "Write confirmation: {tool}" },
  confirmDangerTitle: { zh: "危险操作确认：{tool}", en: "Danger confirmation: {tool}" },
  confirmWriteHint: { zh: "Agent 请求修改你的笔记库，请核对以下内容。", en: "The agent requests a vault modification. Review below." },
  confirmDangerHint: {
    zh: "Agent 请求执行删除类操作，请仔细核对目标路径。删除会移入回收站，可恢复。",
    en: "The agent requests a deletion. Check the target path carefully. Deletions go to the trash and are recoverable.",
  },
  fullArgs: { zh: "完整参数 JSON", en: "Full arguments JSON" },
  timeoutHint: { zh: "{s} 秒内未响应将自动拒绝", en: "Auto-denies if no response within {s}s" },
  refusedByUser: { zh: "用户拒绝了此操作。请调整方案或跳过该步骤。", en: "The user denied this action. Adjust your plan or skip this step." },
  networkDisabled: { zh: "联网工具已在插件设置中禁用。", en: "Web tools are disabled in plugin settings." },
  // history
  historyTitle: { zh: "历史会话", en: "Session history" },
  historyEmpty: { zh: "暂无历史会话。发送第一条消息后会自动保存。", en: "No sessions yet. Sessions are saved automatically after your first message." },
  historyEmptyAfterDelete: { zh: "暂无历史会话。", en: "No sessions left." },
  open: { zh: "打开", en: "Open" },
  delete: { zh: "删除", en: "Delete" },
  deleted: { zh: "已删除该会话", en: "Session deleted" },
  untitled: { zh: "（无标题）", en: "(untitled)" },
  historyMeta: { zh: "{agent} · {model} · {date} · {n} 条消息", en: "{agent} · {model} · {date} · {n} messages" },
  defaultModel: { zh: "默认模型", en: "default model" },
  // login modal
  loginTitle: { zh: "登录授权 · {agent}", en: "Sign-in · {agent}" },
  deviceHint: {
    zh: "点击开始后浏览器打开{agent}登录页（与桌面端同账号），授权完成自动回到这里。",
    en: "Starting opens the {agent} sign-in page in your browser (same account as the desktop app); returns here automatically once authorized.",
  },
  openBrowser: { zh: "打开浏览器授权", en: "Open browser authorization" },
  browserOpened: { zh: "浏览器已打开授权页，请完成登录授权…", en: "Browser opened; complete the sign-in there…" },
  openingLogin: { zh: "正在打开登录页…", en: "Opening sign-in page…" },
  patHint: { zh: "或粘贴 Personal Access Token（qoder.com.cn 账号页生成）：", en: "Or paste a Personal Access Token (from your qoder.com.cn account page):" },
  verifySave: { zh: "验证并保存", en: "Verify & save" },
  verifying: { zh: "验证中…", en: "Verifying…" },
  pastePatFirst: { zh: "请先粘贴 PAT", en: "Paste a PAT first" },
  credHintDefault: { zh: "填写凭据后验证保存。", en: "Enter credentials, then verify & save." },
  oauthHint: {
    zh: "推荐：一键浏览器授权（与官方 CLI 同账号体系），授权完成自动回到这里。",
    en: "Recommended: one-click browser authorization (same account system as the official CLI); returns here automatically.",
  },
  browserLogin: { zh: "浏览器一键授权", en: "Authorize in browser" },
  consoleHint: {
    zh: "豆包无官方 OAuth：点击打开火山方舟控制台创建 API Key，然后粘贴到下方。",
    en: "Doubao has no official OAuth: open the Volcano Ark console to create an API Key, then paste it below.",
  },
  openConsole: { zh: "打开控制台创建 Key", en: "Open console to create key" },
  ctxCopySelection: { zh: "复制选中文字", en: "Copy selection" },
  ctxCopyMessage: { zh: "复制本条消息", en: "Copy this message" },
  ctxCopyAll: { zh: "复制全部会话", en: "Copy whole session" },
  apiKey: { zh: "API Key", en: "API Key" },
  baseUrl: { zh: "Base URL", en: "Base URL" },
  readLocalClaude: { zh: "读取本机 Claude Code 登录态", en: "Read local Claude Code sign-in" },
  noLocalClaude: {
    zh: "本机无 Claude Code 登录态（~/.claude/.credentials.json 不存在）。请填 API Key。",
    en: "No local Claude Code sign-in (~/.claude/.credentials.json missing). Enter an API Key.",
  },
  oauthReadOk: { zh: "已读取本机 OAuth 登录态，验证中…", en: "Local OAuth sign-in read; verifying…" },
  fillKeyOrOauth: { zh: "请填写 API Key 或读取本机登录态", en: "Enter an API Key or read the local sign-in" },
  verifyFail: { zh: "验证未通过：请检查凭据/网络（模型目录为空）。", en: "Verification failed: check credentials/network (empty model catalog)." },
  loginSuccess: { zh: "{agent} 登录/凭据配置成功", en: "{agent} sign-in / credentials configured" },
  replHint: {
    zh: "正在打开浏览器授权页，请在浏览器中完成登录授权，然后回到这里等待结果。无需操作终端。",
    en: "Opening the browser authorization page; complete sign-in there and return here. No terminal needed.",
  },
  loginCmdExit: { zh: "登录命令退出（code={code}）。可重试。", en: "Sign-in command exited (code={code}). Retry available." },
  cannotStartLogin: { zh: "无法启动登录命令，请在设置中检查 CLI 路径或先安装。", en: "Cannot start sign-in command; check the CLI path in settings or install it first." },
  loginTimeout: { zh: "登录超时（5 分钟）或已取消，请重试", en: "Sign-in timed out (5 min) or cancelled; retry" },
  loginCancelled: { zh: "登录已取消", en: "Sign-in cancelled" },
  loginNoUid: { zh: "登录成功但未获取到用户身份，请重试", en: "Signed in but no user identity returned; retry" },
  patExchangeFail: { zh: "{agent} PAT 交换失败 HTTP {status}：请确认令牌有效", en: "{agent} PAT exchange failed HTTP {status}: check the token" },
  patEmpty: { zh: "PAT 交换返回空令牌", en: "PAT exchange returned an empty token" },
  patNoUid: { zh: "PAT 登录成功但无法确定用户 id", en: "PAT sign-in succeeded but user id unknown" },
  // settings
  settingsTitle: { zh: "DuoAI-Agent-hub 设置", en: "DuoAI-Agent-hub settings" },
  permMode: { zh: "权限模式", en: "Permission mode" },
  permModeDesc: {
    zh: "默认：读取免确认，写入需确认，删除强确认。最高权限：所有操作直接执行（仍仅限 vault 内）。",
    en: "Default: reads free, writes confirm, deletes strong-confirm. Full: everything runs directly (still vault-only).",
  },
  permConfirmOpt: { zh: "重要操作需确认（默认）", en: "Confirm important actions (default)" },
  permFullOpt: { zh: "最高权限（免确认）", en: "Full access (no confirmation)" },
  networkTools: { zh: "联网工具", en: "Web tools" },
  networkToolsDesc: {
    zh: "允许 Agent 使用 web_search / fetch_webpage / add_image_to_note。搜索/读网页免确认；下载图片写入 vault 需确认。",
    en: "Allow web_search / fetch_webpage / add_image_to_note. Search/fetch are free; downloading images into the vault needs confirmation.",
  },
  confirmTimeout: { zh: "确认超时（秒）", en: "Confirmation timeout (seconds)" },
  confirmTimeoutDesc: { zh: "确认弹窗超时未响应将自动拒绝。", en: "Unanswered confirmation dialogs auto-deny after this timeout." },
  language: { zh: "界面语言", en: "UI language" },
  languageDesc: { zh: "自动跟随 Obsidian 语言设置。", en: "Auto follows Obsidian's language setting." },
  langAuto: { zh: "自动", en: "Auto" },
  langZh: { zh: "中文", en: "Chinese" },
  langEn: { zh: "English", en: "English" },
  loginCredSetup: { zh: "登录 / 凭据配置", en: "Sign-in / credentials" },
  loginAuthBtn: { zh: "登录授权", en: "Authorize" },
  configCredBtn: { zh: "配置凭据", en: "Configure" },
  patOptional: { zh: "PAT（可选）", en: "PAT (optional)" },
  patDesc: { zh: "qoder.com.cn 账号页生成的 Personal Access Token", en: "Personal Access Token from your qoder.com.cn account page" },
  patOk: { zh: "PAT 验证成功", en: "PAT verified" },
  localClaude: { zh: "本机 Claude Code 登录态", en: "Local Claude Code sign-in" },
  localClaudeDesc: { zh: "读取 ~/.claude/.credentials.json 中的 OAuth 令牌（若已登录过 Claude Code）", en: "Reads the OAuth token from ~/.claude/.credentials.json (if Claude Code was signed in)" },
  readBtn: { zh: "读取", en: "Read" },
  readOk: { zh: "已读取本机 OAuth 登录态", en: "Local OAuth sign-in read" },
  readNone: { zh: "本机无 Claude Code 登录态", en: "No local Claude Code sign-in" },
  cliPath: { zh: "CLI 路径（可选覆盖）", en: "CLI path (optional override)" },
  cliPathDesc: { zh: "留空则自动检测。可指定 .exe 或 cli.js 的绝对路径。", en: "Leave empty for auto-detection, or set an absolute .exe / cli.js path." },
  autodetect: { zh: "自动检测", en: "Auto-detect" },
  redetect: { zh: "重新检测", en: "Re-detect" },
  detected: { zh: "检测完成", en: "Detection done" },
  statusDetected: { zh: "已检测到：{path}", en: "Detected: {path}" },
  statusNotDetected: { zh: "未检测到。安装方式：{hint}", en: "Not found. Install: {hint}" },
  statusNativeOk: { zh: "内置协议，无需安装 CLI。", en: "Built-in protocol; no CLI install needed." },
  statusLoggedIn: { zh: "已登录：{name}", en: "Signed in: {name}" },
  statusNotLoggedIn: { zh: "未登录。选择该 Agent 或点下方按钮完成授权。", en: "Not signed in. Select the agent or use the button below." },
  statusCredOk: { zh: "凭据已配置。", en: "Credentials configured." },
  statusCredMissing: { zh: "未配置凭据。", en: "No credentials configured." },
  installCli: { zh: "一键安装 CLI", en: "One-click CLI install" },
  installCliDesc: { zh: "在应用内执行 npm install -g {pkg}（无需打开终端，可能需要几分钟）", en: "Runs npm install -g {pkg} in-app (no terminal; may take minutes)" },
  install: { zh: "安装", en: "Install" },
  installing: { zh: "安装中…", en: "Installing…" },
  installProgress: { zh: "正在安装…", en: "Installing…" },
  installOk: { zh: "安装完成。", en: "Install complete." },
  installOkNotice: { zh: "{pkg} 安装完成", en: "{pkg} installed" },
  installFail: { zh: "安装失败：{tail}", en: "Install failed: {tail}" },
  installFailNotice: { zh: "{pkg} 安装失败，详情见设置页", en: "{pkg} install failed; see settings for details" },
  loginHintPrefix: { zh: "登录提示：{hint}", en: "Sign-in hint: {hint}" },
  securityTitle: { zh: "安全说明", en: "Security notes" },
  securityDesc: {
    zh: "所有 Agent 的工具执行发生在插件内，受三级权限网关约束；vault 工具路径校验拒绝绝对路径、上级目录与隐藏目录；写入仅限 .md / .canvas；删除移入系统回收站。联网工具仅允许公网 http/https（阻断内网/回环地址），图片下载校验类型与 10MB 上限。凭据仅保存于本机。",
    en: "All agent tool execution happens inside the plugin behind a 3-tier permission gateway. Vault paths reject absolute paths, parent dirs and hidden dirs; writes are limited to .md/.canvas; deletions go to the system trash. Web tools allow public http/https only (loopback/private ranges blocked); image downloads validate type and a 10MB cap. Credentials stay on this machine.",
  },
  permFullNotice: { zh: "已切换为最高权限：所有操作不再确认", en: "Full access enabled: no more confirmations" },
  permConfirmNotice: { zh: "已恢复默认：重要操作需要确认", en: "Default restored: important actions need confirmation" },
  bridgeFail: { zh: "Agent Hub：本地桥启动失败 {err}", en: "Agent Hub: local bridge failed to start {err}" },
  guiOverrideIgnored: { zh: "设置中的路径 {path} 是桌面 GUI，不能用作 CLI，已忽略。{hint}", en: "Configured path {path} is a desktop GUI, not a CLI; ignored. {hint}" },
  manualPath: { zh: "手动指定", en: "manual" },
  cannotSafeStart: { zh: "无法安全启动 CLI（{path}）。请在设置中直接指定 .exe 或 cli.js 路径。", en: "Cannot safely start CLI ({path}). Set a direct .exe or cli.js path in settings." },
  cliNoResult: { zh: "CLI 退出（code={code}）且无结果。", en: "CLI exited (code={code}) with no result." },
  cliLoginHint: { zh: "\n提示：该 CLI 可能尚未登录，请先在终端完成登录。", en: "\nHint: the CLI may not be signed in yet." },
  cliGuiHint: { zh: "\n提示：请确认设置中的 CLI 路径指向命令行工具而非桌面 GUI（如 WorkBuddy.exe 是 GUI）。", en: "\nHint: ensure the CLI path points to a command-line tool, not a desktop GUI (e.g. WorkBuddy.exe)." },
  fallbackRetry: { zh: "主参数不被支持，使用兼容参数重试…", en: "Primary flags unsupported; retrying with compatible flags…" },
  sessionInit: { zh: "会话已建立", en: "Session established" },
  sessionModel: { zh: " · 模型 {model}", en: " · model {model}" },
  userRequestPrefix: { zh: "用户请求：", en: "User request:" },
  execFailed: { zh: "执行失败", en: "Execution failed" },
  cliNotLoggedHint: { zh: "\n提示：该 CLI 尚未登录，请先完成登录（设置页有登录指引）。", en: "\nHint: this CLI is not signed in yet (see settings for sign-in guidance)." },
  // tool summaries
  sumCreate: { zh: "创建笔记 {path}\n内容预览：\n{preview}", en: "Create note {path}\nPreview:\n{preview}" },
  sumUpdate: { zh: "完整替换笔记 {path}\n新内容预览：\n{preview}", en: "Replace note {path}\nNew content preview:\n{preview}" },
  sumAppend: { zh: "向笔记 {path} 追加内容：\n{preview}", en: "Append to note {path}:\n{preview}" },
  sumEdit: { zh: "修改笔记 {path}\n原文：\n{old}\n替换为：\n{new}", en: "Edit note {path}\nOriginal:\n{old}\nReplacement:\n{new}" },
  sumRename: { zh: "重命名/移动笔记：{path} → {new}", en: "Rename/move note: {path} → {new}" },
  sumFolder: { zh: "创建文件夹 {path}", en: "Create folder {path}" },
  sumDelete: { zh: "删除笔记 {path}（移入回收站）", en: "Delete note {path} (to trash)" },
  sumSearch: { zh: "联网搜索：{q}", en: "Web search: {q}" },
  sumFetch: { zh: "抓取网页：{url}", en: "Fetch webpage: {url}" },
  sumImage: {
    zh: "向笔记 {path} 插入网络图片\n图片 URL：{url}\n位置：{pos}\n图片将下载到 vault 附件文件夹后以本地链接插入。",
    en: "Insert web image into note {path}\nImage URL: {url}\nPosition: {pos}\nThe image is downloaded into the vault attachments folder and linked locally.",
  },
  posAppend: { zh: "末尾（默认）", en: "end (default)" },
  posPrepend: { zh: "开头", en: "beginning" },
  // agent descriptions / hints
  "agent.qwenwork.desc": {
    zh: "千问办公账号（gateway.qwenwork.cn 设备流登录，与桌面端一致），内置协议，无需 CLI",
    en: "QwenWork account (gateway.qwenwork.cn device-flow sign-in, same as desktop); built-in protocol, no CLI",
  },
  "agent.qwenwork.hint": {
    zh: "选择后自动弹出登录授权：浏览器打开千问办公登录页（手机号/邮箱，与桌面端同账号）。",
    en: "Selecting opens sign-in automatically: browser shows the QwenWork login page (phone/email, same account as desktop).",
  },
  "agent.qoder.desc": {
    zh: "Qoder CN 账号（独立于千问办公，积分不互通），内置协议，设备流或 PAT 登录",
    en: "Qoder CN account (separate from QwenWork; credits not shared); built-in protocol, device-flow or PAT sign-in",
  },
  "agent.qoder.hint": {
    zh: "选择后自动弹出登录授权（Qoder CN 账号）；也可在设置中粘贴 PAT。",
    en: "Selecting opens sign-in (Qoder CN account); a PAT can also be pasted in settings.",
  },
  "agent.claude.desc": {
    zh: "Anthropic 官方模型，内置 Messages 协议；API Key 或读取本机 Claude Code 登录态",
    en: "Official Anthropic models via built-in Messages protocol; API Key or local Claude Code sign-in",
  },
  "agent.claude.hint": {
    zh: "在设置中填入 Anthropic API Key，或点击「读取本机 Claude Code 登录态」。",
    en: "Enter an Anthropic API Key in settings, or click \"Read local Claude Code sign-in\".",
  },
  "agent.codex.desc": {
    zh: "OpenAI 官方模型（GPT-5 / Codex 系列），内置 OpenAI 协议，API Key 鉴权",
    en: "Official OpenAI models (GPT-5 / Codex family) via built-in OpenAI protocol; API Key auth",
  },
  "agent.codex.hint": { zh: "在设置中填入 OpenAI API Key。", en: "Enter an OpenAI API Key in settings." },
  "agent.workbuddy.desc": {
    zh: "腾讯 WorkBuddy 官方 CLI（codebuddy），应用内自动安装与登录",
    en: "Tencent WorkBuddy official CLI (codebuddy); in-app auto install & sign-in",
  },
  "agent.workbuddy.hint": {
    zh: "选择后自动启动官方守护进程并弹出浏览器授权（与 WorkBuddy 桌面端同账号），无需手动终端。",
    en: "Selecting auto-starts the official daemon and opens browser authorization (same account as WorkBuddy desktop); no manual terminal.",
  },
  "agent.doubao.desc": {
    zh: "火山方舟 API（OpenAI 兼容），内置 agent 循环",
    en: "Volcano Ark API (OpenAI-compatible) with built-in agent loop",
  },
  "agent.doubao.hint": {
    zh: "在设置中填入火山方舟 API Key 与模型 ID（或推理接入点 ep-xxx）。",
    en: "Enter a Volcano Ark API Key and model ID (or endpoint ep-xxx) in settings.",
  },
  "agent.custom.desc": {
    zh: "任意 OpenAI 兼容 API（DeepSeek / Kimi / GLM / Ollama 等）",
    en: "Any OpenAI-compatible API (DeepSeek / Kimi / GLM / Ollama …)",
  },
  "agent.custom.hint": {
    zh: "在设置中填入 Base URL、API Key 与模型 ID。",
    en: "Enter Base URL, API Key and model ID in settings.",
  },
  modelPlaceholder: { zh: "（在设置中填写模型 ID）", en: "(set model ID in settings)" },
};

export function t(key: string, vars?: Record<string, string | number>): string {
  const entry = D[key];
  let s = entry ? entry[getLang()] : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** 中英并列（设置页等需要同时展示两种语言的场景） */
export function t2(key: string, vars?: Record<string, string | number>, sep = " / "): string {
  const entry = D[key];
  if (!entry) return key;
  const fill = (s: string) => {
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
  return fill(entry.zh) + sep + fill(entry.en);
}