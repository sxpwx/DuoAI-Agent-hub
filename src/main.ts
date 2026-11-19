import { FileSystemAdapter, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import * as path from "path";
import { AgentEvent, AgentHubSettings, Conversation, DEFAULT_SETTINGS, RunContext } from "./types";
import { VaultTools } from "./bridge/tools";
import { BridgeServer } from "./bridge/server";
import { AGENTS, buildSystemPrompt, detectCli, getAgent } from "./agents/registry";
import { nodeForBridge } from "./agents/detect";
import { runCliAgent } from "./agents/cli-runner";
import { runApiLoop, runCosyLoop } from "./agents/api-loop";
import { runAnthropicLoop } from "./agents/anthropic-loop";
import { runCodexOAuthLoop } from "./agents/codex-loop";
import { oauthRefresh } from "./agents/oauth";
import { repairLegacyCreds, readCosyCred, readClaudeLocalOAuth } from "./agents/qwenwork-auth";
import { ChatView, VIEW_TYPE } from "./ui/chat-view";
import { ConfirmModal } from "./ui/confirm-modal";
import { AgentHubSettingTab } from "./settings";
import { setLangOverride, t } from "./i18n";

export default class AgentHubPlugin extends Plugin {
  declare settings: AgentHubSettings;
  bridge!: BridgeServer;
  private tools!: VaultTools;
  private pendingConfirm: ConfirmModal | null = null;

  async onload() {
    await this.loadSettings();

    this.tools = new VaultTools(this.app);
    this.bridge = new BridgeServer(
      this.tools,
      () => this.settings.permissionMode,
      (req) =>
        new Promise((resolve) => {
          const modal = new ConfirmModal(this.app, req, this.settings.confirmTimeoutSec, (d) => {
            this.pendingConfirm = null;
            resolve(d);
          });
          this.pendingConfirm = modal;
          modal.open();
        }),
      () => this.settings.networkTools
    );
    try {
      await this.bridge.start();
    } catch (e: any) {
      new Notice(t("bridgeFail", { err: String(e?.message ?? e) }));
    }

    // 旧版凭据形态自动修复（兼容历史写入）
    try {
      repairLegacyCreds();
    } catch {
      /* ignore */
    }

    this.registerView(VIEW_TYPE, (leaf) => new ChatView(leaf, this));
    this.addRibbonIcon("bot", "打开 Agent Hub", () => this.activateView());
    this.addCommand({
      id: "open-chat",
      name: "打开 Agent 对话",
      callback: () => this.activateView(),
    });
    this.addSettingTab(new AgentHubSettingTab(this.app, this));
  }

  onunload() {
    this.bridge?.stop();
  }

  /** 停止运行时关闭尚未处理的确认弹窗（按拒绝处理） */
  cancelPendingConfirm() {
    this.pendingConfirm?.forceDeny();
    this.pendingConfirm = null;
  }

  /** CLI 子进程环境变量（预留） */
  cliEnvFor(_agentId: string): Record<string, string> {
    return {};
  }

  async loadSettings() {
    const loaded = (await this.loadData()) ?? {};
    const credentials = { ...(loaded.credentials ?? {}) };
    // 迁移旧版 api / pat 配置
    for (const [id, cfg] of Object.entries(loaded.api ?? {})) {
      const c = cfg as { baseUrl?: string; apiKey?: string };
      if (c?.apiKey || c?.baseUrl) credentials[id] = { ...credentials[id], apiKey: c.apiKey, baseUrl: c.baseUrl };
    }
    for (const [id, pat] of Object.entries(loaded.pat ?? {})) {
      if (pat) credentials[id] = { ...credentials[id], pat: pat as string };
    }
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      credentials,
      selectedModels: { ...(loaded.selectedModels ?? {}) },
      cliPaths: { ...(loaded.cliPaths ?? {}) },
    };
    delete (this.settings as any).api;
    delete (this.settings as any).pat;
    delete (this.settings as any).maxApiIterations;
    setLangOverride(this.settings.language);
  }

  async saveSettings() {
    setLangOverride(this.settings.language);
    await this.saveData(this.settings);
  }

  async activateView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    let leaf: WorkspaceLeaf | null = leaves[0] ?? null;
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: VIEW_TYPE, active: true });
    }
    if (leaf) this.app.workspace.revealLeaf(leaf);
  }

  getVaultPath(): string {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) return adapter.getBasePath();
    throw new Error("仅支持本地文件系统 vault");
  }

  private bridgeScriptPath(): string {
    const dir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
    return path.join(this.getVaultPath(), dir, "mcp-bridge.js");
  }

  private buildMcpConfigJson(): string {
    const node = nodeForBridge();
    return JSON.stringify({
      mcpServers: {
        obsidian: {
          command: node.exe,
          args: [this.bridgeScriptPath()],
          env: {
            ...(node.electronRunAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
            OBSIDIAN_BRIDGE_URL: this.bridge.url,
            OBSIDIAN_BRIDGE_TOKEN: this.bridge.authToken,
          },
        },
      },
    });
  }

  private historyFile(): string {
    const dir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
    return path.join(dir, "history.json").replace(/\\/g, "/");
  }

  async loadHistory(): Promise<Conversation[]> {
    try {
      const raw = await this.app.vault.adapter.read(this.historyFile());
      const data = JSON.parse(raw);
      return Array.isArray(data.conversations) ? data.conversations : [];
    } catch {
      return [];
    }
  }

  async saveConversation(conv: Conversation) {
    const all = await this.loadHistory();
    const idx = all.findIndex((c) => c.id === conv.id);
    if (idx >= 0) all[idx] = conv;
    else all.push(conv);
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    const capped = all.slice(0, 50);
    await this.app.vault.adapter.write(this.historyFile(), JSON.stringify({ conversations: capped }));
  }

  async deleteConversation(id: string) {
    const all = (await this.loadHistory()).filter((c) => c.id !== id);
    await this.app.vault.adapter.write(this.historyFile(), JSON.stringify({ conversations: all }));
  }

  async runAgent(
    agentId: string,
    model: string,
    prompt: string,
    onEvent: (e: AgentEvent) => void,
    signal: AbortSignal
  ): Promise<void> {
    const spec = getAgent(agentId) ?? AGENTS[0];
    if (!this.bridge.port) {
      onEvent({ type: "error", text: t("bridgeNotStarted") });
      return;
    }
    const vaultPath = this.getVaultPath();
    const node = nodeForBridge();
    const ctx: RunContext = {
      prompt,
      model,
      vaultPath,
      vaultName: this.app.vault.getName(),
      mcpConfigJson: this.buildMcpConfigJson(),
      bridge: {
        nodeExe: node.exe,
        scriptPath: this.bridgeScriptPath(),
        url: this.bridge.url,
        token: this.bridge.authToken,
        electronRunAsNode: node.electronRunAsNode,
      },
      systemPrompt: buildSystemPrompt(this.app.vault.getName()),
      signal,
      onEvent,
      cliEnv: this.cliEnvFor(agentId),
    };

    const exec = (n: string, a: Record<string, unknown>) => this.bridge.executeGated(n, a);

    if (spec.kind === "native") {
      const cred = this.settings.credentials[spec.id] ?? {};
      if (spec.protocol === "cosy") {
        const cosy = readCosyCred(spec.site!);
        if (!cosy) {
          onEvent({ type: "error", text: t("notLoggedInAgent", { agent: spec.label }) });
          return;
        }
        await runCosyLoop(cosy, spec.site!, ctx, exec, this.settings.networkTools);
        return;
      }
      if (spec.protocol === "anthropic") {
        let oauth = cred.oauthToken || readClaudeLocalOAuth() || undefined;
        const refresh = async () => {
          const c = this.settings.credentials[spec.id];
          if (!c?.refreshToken) return null;
          try {
            const tk = await oauthRefresh("anthropic", c.refreshToken);
            this.settings.credentials[spec.id] = { ...c, oauthToken: tk.accessToken, refreshToken: tk.refreshToken, expiresAt: tk.expiresAt };
            await this.saveSettings();
            return tk.accessToken;
          } catch {
            return null;
          }
        };
        if (oauth && cred.expiresAt && Date.now() > cred.expiresAt - 60000 && cred.refreshToken) {
          oauth = (await refresh()) ?? oauth;
        }
        await runAnthropicLoop(
          { baseUrl: cred.baseUrl || spec.baseUrl || "https://api.anthropic.com", apiKey: cred.apiKey, oauthToken: oauth },
          ctx,
          exec,
          this.settings.networkTools,
          refresh
        );
        return;
      }
      if (spec.protocol === "openai" && cred.oauthToken) {
        const refresh = async () => {
          const c = this.settings.credentials[spec.id];
          if (!c?.refreshToken) return null;
          try {
            const tk = await oauthRefresh("openai", c.refreshToken);
            this.settings.credentials[spec.id] = { ...c, oauthToken: tk.accessToken, refreshToken: tk.refreshToken, expiresAt: tk.expiresAt };
            await this.saveSettings();
            return tk.accessToken;
          } catch {
            return null;
          }
        };
        let token = cred.oauthToken;
        if (cred.expiresAt && Date.now() > cred.expiresAt - 60000 && cred.refreshToken) token = (await refresh()) ?? token;
        await runCodexOAuthLoop(token, ctx, exec, this.settings.networkTools, refresh);
        return;
      }
      await runApiLoop(
        { baseUrl: cred.baseUrl || spec.baseUrl || "", apiKey: cred.apiKey ?? "", model: ctx.model },
        ctx,
        exec,
        this.settings.networkTools
      );
      return;
    }

    if (spec.kind === "cli") {
      const det = detectCli(spec, this.settings.cliPaths[spec.id]);
      if (!det.available || !det.path) {
        onEvent({
          type: "error",
          text: t("cliMissing", { agent: spec.label, hint: spec.installHint }) + "\n" + t(`agent.${spec.id}.hint`),
        });
        return;
      }
      await runCliAgent(spec, det.path, ctx);
    }
  }
}