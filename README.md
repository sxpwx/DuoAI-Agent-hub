# Agent Hub（Obsidian 插件）

在 Obsidian 中调用多种 AI Agent 操作你的笔记库：**千问办公、Qoder CN、WorkBuddy、Claude Code、Codex、豆包办公、自定义 API**。
除 WorkBuddy 外全部**内置协议实现，无需安装任何 CLI**；每个 Agent 的模型列表与其官方客户端一致（支持动态拉取账号可用模型）；
Agent 能力被严格限制为「只能操作当前 vault」；默认**重要操作需要用户确认**，可切换最高权限；工具迭代**不限轮数**。

## 功能

- 侧边栏聊天视图：选 Agent → 选模型 → 输入任务，流式查看回答与工具调用
- **应用内登录/凭据配置**：设备流自动弹浏览器授权（千问办公 / Qoder CN），API Key / OAuth 应用内填写验证（Claude / Codex / 豆包 / 自定义），WorkBuddy 自动安装 + 自动登录弹窗——全程无需手动开终端
- **会话管理**：消息悬停「复制」；用户消息「重新发送」；「历史」查看/打开/删除最近 50 个会话，打开后可继续对话（自动携带上下文）
- **联网能力**：`web_search`（Bing，回退百度）、`fetch_webpage`（网页正文）、`add_image_to_note`（下载图片入 vault 并插入本地链接）；设置可整体关闭
- **三级权限网关**：读取免确认；写入弹窗确认；删除红色强确认（移入回收站）；支持「本次会话全部允许」与超时自动拒绝；顶栏/设置可切最高权限
- **停止即停**：杀整棵进程树 + 关闭待确认弹窗，UI 立即恢复

## Agent 与模型

| Agent | 接入方式 | 模型 |
|---|---|---|
| 千问办公 | 内置 COSY 协议 + 设备流登录（gateway.qwenwork.cn，与桌面端同账号同积分） | 动态拉取账号目录（标准/高级/Qwen4-Max/Qwen3.8-Max/… 与客户端一致） |
| Qoder CN | 内置 COSY 协议 + 设备流/PAT 登录（**独立账号，积分与千问办公不互通**） | 动态目录（Ultimate/Performance/Efficient/Lite） |
| WorkBuddy | 应用内自动管理官方 CLI `codebuddy`（自动安装 + REPL `/login` 自动授权） | auto/hy3/hy3-x/glm-5.3/…/deepseek-v4-pro（官方列表） |
| Claude Code | 内置 Anthropic Messages 协议；API Key 或读取本机 Claude Code OAuth 登录态 | 动态 /v1/models（claude-sonnet-4-5/opus-4-5/haiku-4-5/…） |
| Codex | 内置 OpenAI 协议；API Key | 动态 /v1/models（gpt-5-codex/gpt-5/o4-mini/…） |
| 豆包办公 | 火山方舟 OpenAI 兼容协议；API Key | doubao-seed-1-6 系列等，可自填 |
| 自定义 API | 任意 OpenAI 兼容（DeepSeek/Kimi/GLM/Ollama…） | 自填 |

## 安全架构

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

## 安装

1. 下载本仓库（或 Release），将文件夹放入 vault 的 `.obsidian/plugins/`（内含构建产物 `main.js`、`mcp-bridge.js`、`manifest.json`、`styles.css`）
2. Obsidian → 设置 → 第三方插件 → 启用 **Agent Hub**
3. 点 ribbon 机器人图标打开面板；选择 Agent 后按弹窗完成登录/凭据配置

## 开发

```bash
npm install
npm run build   # 产出 main.js 与 mcp-bridge.js
npm run dev     # 监听模式
```

```
src/main.ts               插件入口、桥生命周期、runAgent 调度、历史存储
src/types.ts              类型与默认设置
src/bridge/tools.ts       16 个工具定义 + 执行器 + 路径校验
src/bridge/net.ts         联网纯逻辑（URL 安全/搜索解析/正文提取）
src/bridge/server.ts      本地 HTTP 安全桥 + 三级权限网关
src/agents/qwenwork-chat.ts  COSY 协议（签名/编解码/SSE/模型目录，千问办公+Qoder CN）
src/agents/qwenwork-auth.ts  设备流/PAT 登录、凭据读写、本机 Claude OAuth 读取
src/agents/anthropic-loop.ts Anthropic Messages agent 循环
src/agents/api-loop.ts       COSY / OpenAI 兼容 agent 循环（不限轮数）
src/agents/models.ts         各产品模型目录动态拉取
src/agents/registry.ts       Agent 规格与官方模型清单
src/agents/cli-runner.ts     受管 CLI 子进程（stream-json 解析、进程树终止）
src/agents/detect.ts         CLI 探测 / npm shim 解析 / 应用内安装
src/ui/*                     聊天视图、确认弹窗、历史弹窗、登录弹窗
mcp-bridge/bridge.ts         MCP stdio → HTTP 转发（纯 Node 内置模块）
vendor/qwenwork-auth/        移植来源参考副本（MIT，含原许可证）
```

## 许可证

MIT（见 LICENSE）。COSY 协议部分移植自 MIT 社区项目 @magpie-community/opencode-qoder-auth / CLIProxyAPI，保留其版权声明。

## 已知限制

- 仅桌面端 + 本地文件系统 vault
- WorkBuddy 依赖官方 CLI（应用内自动安装）；其凭据由腾讯 KMS 加密，无法免 CLI 内置
- 千问办公/Qoder CN 登录态约 10 天，过期重新授权
- 聊天记录存插件目录 history.json（最近 50 会话）