# Agent Hub（Obsidian 插件 / Obsidian Plugin）

[中文](#中文) · [English](#english)

---

## 中文

在 Obsidian 中调用多种 AI Agent 操作你的笔记库：**千问办公、Qoder CN、WorkBuddy、Claude Code、Codex、豆包办公、自定义 API**。
除 WorkBuddy 外全部**内置协议实现，无需安装任何 CLI**；模型列表与各产品官方客户端一致（支持动态拉取账号可用模型）；
Agent 能力严格限制为「只能操作当前 vault」；默认**重要操作需要用户确认**，可切换最高权限；工具迭代**不限轮数**；界面**中英双语**（跟随 Obsidian 语言，可在设置中覆盖）。

### 功能

- 侧边栏聊天视图：选 Agent → 选模型 → 输入任务，流式查看回答与工具调用
- **应用内登录/凭据配置**：设备流自动弹浏览器授权（千问办公 / Qoder CN）；API Key / OAuth 应用内填写验证（Claude / Codex / 豆包 / 自定义）；WorkBuddy 自动安装 + 自动登录弹窗——全程无需手动开终端
- **会话管理**：消息悬停「复制」；用户消息「重新发送」；「历史」查看/打开/删除最近 50 个会话，打开后可继续对话（自动携带上下文）
- **联网能力**：`web_search`（Bing，回退百度）、`fetch_webpage`（网页正文）、`add_image_to_note`（下载图片入 vault 并插入本地链接）；设置可整体关闭
- **三级权限网关**：读取免确认；写入弹窗确认；删除红色强确认（移入回收站）；支持「本次会话全部允许」与超时自动拒绝；顶栏/设置可切最高权限
- **停止即停**：杀整棵进程树 + 关闭待确认弹窗，UI 立即恢复

### Agent 与模型

| Agent | 接入方式 | 模型 |
|---|---|---|
| 千问办公 | 内置 COSY 协议 + 设备流登录（gateway.qwenwork.cn，与桌面端同账号同积分） | 动态拉取账号目录（标准/高级/Qwen4-Max/Qwen3.8-Max/… 与客户端一致） |
| Qoder CN | 内置 COSY 协议 + 设备流/PAT 登录（**独立账号，积分与千问办公不互通**） | 动态目录（Ultimate/Performance/Efficient/Lite） |
| WorkBuddy | 应用内自动管理官方 CLI `codebuddy`（自动安装 + REPL `/login` 自动授权） | auto/hy3/hy3-x/glm-5.3/…/deepseek-v4-pro（官方列表） |
| Claude Code | 内置 Anthropic Messages 协议；API Key 或读取本机 Claude Code OAuth 登录态 | 动态 /v1/models（claude-sonnet-4-5/opus-4-5/haiku-4-5/…） |
| Codex | 内置 OpenAI 协议；API Key | 动态 /v1/models（gpt-5-codex/gpt-5/o4-mini/…） |
| 豆包办公 | 火山方舟 OpenAI 兼容协议；API Key | doubao-seed-1-6 系列等，可自填 |
| 自定义 API | 任意 OpenAI 兼容（DeepSeek/Kimi/GLM/Ollama…） | 自填 |

### 安全架构

```
Agent（内置协议循环 / 受管 CLI）
  └─ 唯一工具通道：obsidian 工具集（16 个）
        │ 插件内执行 + 三级权限确认（Obsidian 弹窗）
        ▼
     Vault API（路径校验：禁绝对路径/上级/隐藏目录；写入仅 .md/.canvas；删除入回收站）
```

- 内置协议 Agent 无 shell/文件系统能力；受管 CLI（WorkBuddy）以 `--tools ""` 禁用全部内置工具，仅挂载 obsidian MCP（本地回环 + 会话令牌）
- 联网工具 SSRF 防护：仅公网 http/https，阻断回环/内网/链路本地/云元数据地址；图片校验 content-type 与 10MB 上限
- 凭据仅存本机（`~/.local/share/opencode/auth.json` 与插件 data.json），不上传

### 安装

1. 下载本仓库（或 Release），将文件夹放入 vault 的 `.obsidian/plugins/`（内含构建产物 `main.js`、`mcp-bridge.js`、`manifest.json`、`styles.css`）
2. Obsidian → 设置 → 第三方插件 → 启用 **Agent Hub**
3. 点 ribbon 机器人图标打开面板；选择 Agent 后按弹窗完成登录/凭据配置

### 开发

```bash
npm install
npm run build   # 产出 main.js 与 mcp-bridge.js
npm run dev     # 监听模式
```

源码结构见仓库 `src/`（i18n 双语字典、COSY/Anthropic/OpenAI 协议循环、权限网关、MCP 桥、UI 视图）。
`vendor/qwenwork-auth/` 为移植来源参考副本（MIT，含原许可证）。

### 许可证

MIT（见 LICENSE）。COSY 协议部分移植自 MIT 社区项目 @magpie-community/opencode-qoder-auth / CLIProxyAPI，保留其版权声明。

### 已知限制

- 仅桌面端 + 本地文件系统 vault
- WorkBuddy 依赖官方 CLI（应用内自动安装）；其凭据由腾讯 KMS 加密，无法免 CLI 内置
- 千问办公/Qoder CN 登录态约 10 天，过期重新授权
- 聊天记录存插件目录 history.json（最近 50 会话）

---

## English

Run multiple AI agents inside Obsidian against your vault: **QwenWork, Qoder CN, WorkBuddy, Claude Code, Codex, Doubao, custom OpenAI-compatible APIs**.
All agents except WorkBuddy use **built-in protocol implementations — no CLI installs required**. Model lists match each product's official client (live account catalog fetching supported).
Agent capabilities are strictly limited to "operate on the current vault only". By default **important actions require user confirmation**, switchable to full access. Tool iterations are **uncapped**. The UI is **bilingual (Chinese/English)**, following Obsidian's language with a settings override.

### Features

- Sidebar chat view: pick agent → pick model → type a task; streaming answers and tool-call cards
- **In-app sign-in / credentials**: device-flow browser authorization (QwenWork / Qoder CN); in-app API Key / OAuth entry with verification (Claude / Codex / Doubao / custom); WorkBuddy auto-install + auto sign-in popup — no manual terminal work
- **Session management**: hover "Copy" on messages; "Resend" on user messages; "History" to review/open/delete the last 50 sessions and continue them with automatic context
- **Web capabilities**: `web_search` (Bing with Baidu fallback), `fetch_webpage` (article text), `add_image_to_note` (download images into the vault and insert local links); globally disableable in settings
- **3-tier permission gateway**: reads free; writes confirm via dialog; deletes strong-confirm (moved to trash); "allow all for this session" and auto-deny on timeout; full-access toggle in header/settings
- **Instant stop**: kills the whole process tree and closes pending confirmation dialogs

### Agents & models

| Agent | Integration | Models |
|---|---|---|
| QwenWork | Built-in COSY protocol + device-flow sign-in (gateway.qwenwork.cn, same account/credits as desktop) | Live account catalog (matches desktop client) |
| Qoder CN | Built-in COSY protocol + device-flow/PAT sign-in (**separate account; credits not shared with QwenWork**) | Live catalog (Ultimate/Performance/Efficient/Lite) |
| WorkBuddy | In-app managed official CLI `codebuddy` (auto install + REPL `/login` auto authorization) | Official list (auto/hy3/glm-5.3/…/deepseek-v4-pro) |
| Claude Code | Built-in Anthropic Messages protocol; API Key or local Claude Code OAuth sign-in | Live /v1/models |
| Codex | Built-in OpenAI protocol; API Key | Live /v1/models (gpt-5-codex/gpt-5/o4-mini/…) |
| Doubao | Volcano Ark OpenAI-compatible protocol; API Key | doubao-seed-1-6 family, customizable |
| Custom API | Any OpenAI-compatible endpoint (DeepSeek/Kimi/GLM/Ollama…) | Custom |

### Security model

```
Agent (built-in protocol loop / managed CLI)
  └─ only tool channel: obsidian toolset (16 tools)
        │ executed inside the plugin + 3-tier confirmation dialogs
        ▼
     Vault API (path validation: no absolute/parent/hidden paths; writes .md/.canvas only; deletes to trash)
```

- Built-in protocol agents have no shell/filesystem powers; the managed CLI (WorkBuddy) runs with `--tools ""` (all built-ins disabled) and only the obsidian MCP server (loopback + session token)
- Web tools enforce SSRF protection: public http/https only (loopback/private/link-local/cloud-metadata blocked); image downloads validate content-type and a 10MB cap
- Credentials stay on this machine (`~/.local/share/opencode/auth.json` and plugin data.json); nothing is uploaded

### Install

1. Download this repo (or a Release) into your vault's `.obsidian/plugins/` (build artifacts `main.js`, `mcp-bridge.js`, `manifest.json`, `styles.css` included)
2. Obsidian → Settings → Community plugins → enable **Agent Hub**
3. Click the bot ribbon icon; pick an agent and complete the sign-in/credential dialog

### Development

```bash
npm install
npm run build   # emits main.js and mcp-bridge.js
npm run dev     # watch mode
```

See `src/` for the bilingual i18n dictionary, COSY/Anthropic/OpenAI protocol loops, permission gateway, MCP bridge and UI views.
`vendor/qwenwork-auth/` keeps reference copies of the ported MIT sources with their licenses.

### License

MIT (see LICENSE). The COSY protocol portions are ported from the MIT community projects @magpie-community/opencode-qoder-auth / CLIProxyAPI; their copyright notices are retained.

### Known limitations

- Desktop only + local filesystem vaults
- WorkBuddy requires its official CLI (auto-installed in-app); its credentials are encrypted by Tencent KMS and cannot be read locally, hence no CLI-free built-in mode
- QwenWork/Qoder CN sign-in lasts ~10 days; re-authorize when expired
- Chat history lives in the plugin folder's history.json (last 50 sessions)