import { ItemView, MarkdownRenderer, Menu, Notice, WorkspaceLeaf } from "obsidian";
import { AGENTS, detectCli, getAgent } from "../agents/registry";
import { checkLogin } from "../agents/auth";
import { fetchDynamicModels } from "../agents/models";
import { readCosyCred } from "../agents/qwenwork-auth";
import { AgentEvent, AgentSpec, CliAgentSpec, Conversation, StoredMessage } from "../types";
import { summarize, toolTier } from "../bridge/tools";
import { t } from "../i18n";
import { rec } from "../agents/guards";
import { HistoryModal } from "./history-modal";
import { LoginModal } from "./login-modal";
import type AgentHubPlugin from "../main";

export const VIEW_TYPE = "agent-hub-chat";

export class ChatView extends ItemView {
  private agentSelect!: HTMLSelectElement;
  private modelSelect!: HTMLSelectElement;
  private permBtn!: HTMLButtonElement;
  private statusEl!: HTMLElement;
  private messagesEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private abort: AbortController | null = null;
  private lastBubble: { el: HTMLElement; raw: string; msg?: StoredMessage } | null = null;
  private lastToolCard: HTMLElement | null = null;
  private lastToolMsg: StoredMessage | null = null;
  private renderTimer: number | null = null;
  private saveTimer: number | null = null;
  private modelCache: Record<string, string[]> = {};
  private conv: Conversation | null = null;
  private loginBtn!: HTMLButtonElement;
  private loginState: Record<string, boolean | null | undefined> = {};
  private autoLoginShown = new Set<string>();
  private checkingLogin = false;

  constructor(leaf: WorkspaceLeaf, private plugin: AgentHubPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "DuoAI-Agent-hub";
  }
  getIcon() {
    return "bot";
  }

  async onOpen() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("ah-root");

    const header = root.createDiv({ cls: "ah-header" });
    this.agentSelect = header.createEl("select", { cls: "ah-agent-select" });
    for (const a of AGENTS) {
      this.agentSelect.createEl("option", { value: a.id, text: a.label });
    }
    this.agentSelect.value = this.plugin.settings.selectedAgent;
    this.agentSelect.addEventListener("change", () => {
      void (async () => {
        this.plugin.settings.selectedAgent = this.agentSelect.value;
        await this.plugin.saveSettings();
        await this.refreshModels();
        this.updateStatus();
      })();
    });

    this.modelSelect = header.createEl("select", { cls: "ah-model-select" });
    const refreshBtn = header.createEl("button", { cls: "ah-icon-btn", text: "↻", attr: { "aria-label": t("refreshModels") } });
    refreshBtn.addEventListener("click", () => { void this.refreshModels(true); });

    this.permBtn = header.createEl("button", { cls: "ah-perm-btn" });
    this.permBtn.addEventListener("click", () => {
      void (async () => {
        const s = this.plugin.settings;
        s.permissionMode = s.permissionMode === "confirm" ? "full" : "confirm";
        await this.plugin.saveSettings();
        this.updatePermBtn();
        new Notice(s.permissionMode === "full" ? t("permFullNotice") : t("permConfirmNotice"));
      })();
    });
    this.updatePermBtn();

    this.loginBtn = header.createEl("button", { cls: "ah-login-btn", text: "登录" });
    this.loginBtn.hide();
    this.loginBtn.addEventListener("click", () => {
      const id = this.agentSelect.value;
      const spec = getAgent(id);
      if (!spec) return;
      if (spec.kind === "cli") {
        const det = detectCli(spec, this.plugin.settings.cliPaths[id]);
        this.openLogin(spec, det.available ? det.path ?? null : null);
      } else {
        this.openLogin(spec, null);
      }
    });

    const histBtn = header.createEl("button", { cls: "ah-icon-btn", text: t("history"), attr: { "aria-label": t("history") } });
    histBtn.addEventListener("click", () => {
      void (async () => {
        const all = await this.plugin.loadHistory();
        new HistoryModal(this.app, all, {
          open: (c) => {
            void this.loadConversation(c);
          },
          remove: async (id) => {
            await this.plugin.deleteConversation(id);
            if (this.conv?.id === id) this.conv = null;
          },
        }).open();
      })();
    });

    const newBtn = header.createEl("button", { cls: "ah-icon-btn", text: "＋", attr: { "aria-label": t("newSession") } });
    newBtn.addEventListener("click", () => {
      if (this.abort) return;
      this.conv = null;
      this.messagesEl.empty();
      this.showEmpty();
      this.lastBubble = null;
      this.lastToolCard = null;
      this.lastToolMsg = null;
      this.plugin.bridge.resetSession();
      this.updateStatus(t("statusNewSession"));
    });

    this.statusEl = root.createDiv({ cls: "ah-status" });
    this.messagesEl = root.createDiv({ cls: "ah-messages" });
    this.showEmpty();
    this.registerDomEvent(this.messagesEl, "contextmenu", (e: MouseEvent) => {
      e.preventDefault();
      const sel = this.containerEl.ownerDocument.getSelection()?.toString() ?? "";
      const msgEl = (e.target as HTMLElement).closest<HTMLElement>(".ah-msg, .ah-tool");
      const menu = new Menu();
      if (sel.trim()) {
        menu.addItem((i) =>
          i.setTitle(t("ctxCopySelection")).setIcon("copy").onClick(() => {
            navigator.clipboard.writeText(sel).then(() => new Notice(t("copied"))).catch(() => new Notice(t("copyFail")));
          })
        );
      }
      if (msgEl) {
        menu.addItem((i) =>
          i.setTitle(t("ctxCopyMessage")).setIcon("copy").onClick(() => {
            const clone = msgEl.cloneNode(true) as HTMLElement;
            clone.querySelectorAll(".ah-msg-actions").forEach((n) => n.remove());
            navigator.clipboard.writeText(clone.innerText).then(() => new Notice(t("copied"))).catch(() => new Notice(t("copyFail")));
          })
        );
      }
      menu.addItem((i) =>
        i.setTitle(t("ctxCopyAll")).setIcon("documents").onClick(() => {
          const all = (this.conv?.messages ?? [])
            .map((m) => (m.role === "tool" ? `[${m.tool}] ${m.result ?? ""}` : m.text ?? ""))
            .filter(Boolean)
            .join("\n\n");
          navigator.clipboard.writeText(all).then(() => new Notice(t("copied"))).catch(() => new Notice(t("copyFail")));
        })
      );
      menu.showAtMouseEvent(e);
    });

    const input = root.createDiv({ cls: "ah-input" });
    this.inputEl = input.createEl("textarea", {
      cls: "ah-textarea",
      attr: { placeholder: t("chatPlaceholder"), rows: "3" },
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void this.send();
      }
    });
    this.sendBtn = input.createEl("button", { cls: "ah-send-btn mod-cta", text: t("send") });
    this.sendBtn.addEventListener("click", () => {
      if (this.abort) this.stop();
      else void this.send();
    });

    await this.refreshModels();
    this.updateStatus();
  }

  private showEmpty() {
    this.messagesEl.createDiv({
      cls: "ah-empty",
      text: t("chatEmpty"),
    });
  }

  private updatePermBtn() {
    const full = this.plugin.settings.permissionMode === "full";
    this.permBtn.setText(full ? t("permFull") : t("permConfirm"));
    this.permBtn.toggleClass("ah-perm-full", full);
    this.permBtn.setAttribute("aria-label", full ? t("permFullTip") : t("permConfirmTip"));
  }

  private updateStatus(text?: string) {
    if (text !== undefined) {
      this.statusEl.setText(text);
      return;
    }
    const spec = getAgent(this.agentSelect.value);
    if (spec?.kind === "native") {
      this.statusEl.setText(t("statusBuiltin"));
    } else if (spec?.kind === "cli") {
      const det = detectCli(spec, this.plugin.settings.cliPaths[spec.id]);
      this.statusEl.setText(det.available ? `${t("statusReady")} · ${det.path}` : t("statusCliMissing", { hint: spec.installHint }));
    }
  }

  private async refreshModels(force = false) {
    const id = this.agentSelect.value;
    const spec = getAgent(id);
    if (!spec) return;
    let models: string[] = [];
    if (spec.kind === "native") {
      models = [...spec.models];
      const cred = this.plugin.settings.credentials[id];
      const cosy = spec.protocol === "cosy" ? readCosyCred(spec.site!) : null;
      if (spec.dynamic && (cosy || cred?.apiKey || cred?.oauthToken)) {
        const dyn = await fetchDynamicModels(spec, cred, cosy);
        if (dyn.length) models = Array.from(new Set([...dyn, ...spec.models]));
      }
      if (!models.length) models = [t("modelPlaceholder")];
    } else {
      models = this.modelCache[id] && !force ? this.modelCache[id] : [...spec.models];
      if (force || !this.modelCache[id]) {
        const cli: CliAgentSpec = spec;
        if (cli.dynamicModels) {
          const det = detectCli(cli, this.plugin.settings.cliPaths[id]);
          if (det.available && det.path) {
            this.updateStatus(t("statusFetchingModels"));
            const dyn = await cli.dynamicModels(det.path).catch(() => []);
            if (dyn.length) models = Array.from(new Set([...dyn, ...spec.models]));
          }
        }
        this.modelCache[id] = models;
      }
    }
    this.modelSelect.empty();
    for (const m of models) this.modelSelect.createEl("option", { value: m, text: m });
    const saved = this.plugin.settings.selectedModels[id];
    this.modelSelect.value = saved && models.includes(saved) ? saved : models[0] ?? "";
    this.modelSelect.onchange = () => {
      void (async () => {
        this.plugin.settings.selectedModels[id] = this.modelSelect.value;
        await this.plugin.saveSettings();
      })();
    };
    this.updateStatus();
    await this.maybePromptLogin();
  }

  // ---------- 登录授权 ----------

  private async maybePromptLogin() {
    if (this.checkingLogin) return;
    const id = this.agentSelect.value;
    const spec = getAgent(id);
    if (!spec) return;
    if (spec.kind === "native") {
      const ready =
        spec.protocol === "cosy"
          ? !!readCosyCred(spec.site!)
          : !!(this.plugin.settings.credentials[id]?.apiKey || this.plugin.settings.credentials[id]?.oauthToken);
      if (!ready) {
        this.loginBtn.show();
        this.updateStatus(t("statusNotLogged"));
        if (!this.autoLoginShown.has(id)) {
          this.autoLoginShown.add(id);
          this.openLogin(spec, null);
        }
      } else {
        this.loginBtn.hide();
      }
      return;
    }
    if (spec.kind !== "cli" || !spec.login) {
      this.loginBtn.hide();
      return;
    }
    const det = detectCli(spec, this.plugin.settings.cliPaths[id]);
    if (!det.available || !det.path) {
      this.loginBtn.hide();
      return;
    }
    this.checkingLogin = true;
    try {
      if (this.loginState[id] === undefined) {
        this.loginState[id] = await checkLogin(spec, det.path, this.plugin.cliEnvFor(id));
      }
      if (this.loginState[id] === false) {
        this.loginBtn.show();
        this.updateStatus("未登录 · 自动弹出授权窗口，或点击顶栏「登录」");
        if (!this.autoLoginShown.has(id)) {
          this.autoLoginShown.add(id);
          this.openLogin(spec, det.path);
        }
      } else {
        this.loginBtn.hide();
      }
    } finally {
      this.checkingLogin = false;
    }
  }

  private openLogin(spec: AgentSpec, exe: string | null) {
    new LoginModal(
      this.app,
      spec,
      exe,
      () => {
        void (async () => {
          this.loginState[spec.id] = true;
          this.loginBtn.hide();
          await this.refreshModels(true);
          this.updateStatus();
        })();
      },
      {
        credentials: this.plugin.settings.credentials,
        saveCredential: async (id, cred) => {
          this.plugin.settings.credentials[id] = cred;
          await this.plugin.saveSettings();
        },
      }
    ).open();
  }

  // ---------- 会话与历史 ----------

  private ensureConv(prompt: string): Conversation {
    if (!this.conv) {
      this.conv = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: prompt.slice(0, 40),
        agentId: this.agentSelect.value,
        model: this.modelSelect.value,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
    }
    return this.conv;
  }

  private pushMsg(m: StoredMessage) {
    if (!this.conv) return;
    this.conv.messages.push(m);
    this.conv.updatedAt = Date.now();
    this.scheduleSave();
  }

  private scheduleSave() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      if (this.conv) this.plugin.saveConversation(this.conv).catch(() => {});
    }, 400);
  }

  private flushSave() {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.conv) this.plugin.saveConversation(this.conv).catch(() => {});
  }

  private buildContextPrompt(prompt: string): string {
    const prior = this.conv?.messages ?? [];
    if (!prior.length) return prompt;
    const lines = prior
      .slice(-12)
      .map((m) => {
        if (m.role === "user") return `用户: ${m.text ?? ""}`;
        if (m.role === "assistant") return `助手: ${(m.text ?? "").slice(0, 800)}`;
        if (m.role === "tool") return `[工具 ${m.tool} 已执行${m.isError ? "（失败）" : ""}]`;
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .slice(0, 4000);
    return `【本会话之前的对话记录（供上下文参考）】\n${lines}\n\n【本次请求】\n${prompt}`;
  }

  async loadConversation(c: Conversation) {
    if (this.abort) {
      new Notice(t("runningStopFirst"));
      return;
    }
    this.conv = c;
    this.messagesEl.empty();
    this.lastBubble = null;
    this.lastToolCard = null;
    this.lastToolMsg = null;
    this.agentSelect.value = c.agentId;
    this.plugin.settings.selectedAgent = c.agentId;
    await this.plugin.saveSettings();
    await this.refreshModels();
    if (c.model && Array.from(this.modelSelect.options).some((o) => o.value === c.model)) {
      this.modelSelect.value = c.model;
    }
    for (const m of c.messages) this.renderStored(m);
    this.updateStatus(t("statusLoadedHistory", { title: c.title }));
    this.scrollDown();
  }

  private renderStored(m: StoredMessage) {
    if (m.role === "user") {
      this.addUserBubble(m.text ?? "", false);
    } else if (m.role === "assistant") {
      const el = this.messagesEl.createDiv({ cls: "ah-msg ah-assistant" });
      this.addMsgActions(el, m.text ?? "", false);
      el.createDiv({ cls: "ah-role", text: t("roleAgent") });
      const content = el.createDiv({ cls: "ah-content" });
      MarkdownRenderer.render(this.app, m.text ?? "", content, "", this).catch(() => content.setText(m.text ?? ""));
    } else if (m.role === "error") {
      const el = this.messagesEl.createDiv({ cls: "ah-msg ah-error" });
      this.addMsgActions(el, m.text ?? "", false);
      el.createDiv({ cls: "ah-role", text: t("roleError") });
      el.createDiv({ cls: "ah-content", text: m.text ?? "" });
    } else if (m.role === "tool") {
      this.addToolCard(m.tool ?? "", m.args ?? {}, false);
      if (m.result !== undefined) this.updateToolCard(m.result, m.isError, false);
    }
  }

  // ---------- 发送 ----------

  private async send() {
    const prompt = this.inputEl.value.trim();
    if (!prompt || this.abort) return;
    const empty = this.messagesEl.querySelector(".ah-empty");
    empty?.remove();
    this.inputEl.value = "";

    const contextPrompt = this.buildContextPrompt(prompt);
    const conv = this.ensureConv(prompt);
    conv.agentId = this.agentSelect.value;
    conv.model = this.modelSelect.value;
    this.pushMsg({ role: "user", text: prompt, ts: Date.now() });
    this.addUserBubble(prompt, true);

    this.lastBubble = null;
    this.abort = new AbortController();
    this.sendBtn.setText(t("stop"));
    this.sendBtn.removeClass("mod-cta");
    this.sendBtn.addClass("ah-stop");
    this.updateStatus(t("statusRunning"));

    try {
      await this.plugin.runAgent(conv.agentId, conv.model, contextPrompt, (e) => this.onEvent(e), this.abort.signal);
    } catch (e) {
      this.addError(t("runException", { err: String(rec(e).message ?? e) }));
    } finally {
      this.abort = null;
      this.sendBtn.setText(t("send"));
      this.sendBtn.addClass("mod-cta");
      this.sendBtn.removeClass("ah-stop");
      this.flushRender();
      this.flushSave();
      this.updateStatus(t("statusReady"));
    }
  }

  private resend(text: string) {
    if (this.abort) {
      new Notice(t("runningStopFirst"));
      return;
    }
    this.inputEl.value = text;
    void this.send();
  }

  private stop() {
    this.plugin.cancelPendingConfirm();
    this.abort?.abort();
    this.updateStatus(t("statusStopping"));
  }

  private onEvent(e: AgentEvent) {
    switch (e.type) {
      case "status":
        this.updateStatus(e.text);
        break;
      case "text":
        this.appendText(e.text);
        break;
      case "tool_use":
        this.addToolCard(e.name, e.args, true);
        break;
      case "tool_result":
        this.updateToolCard(e.text, e.isError, true);
        break;
      case "done":
        this.flushRender();
        if (e.text && e.text.trim() && e.text.trim() !== (this.lastBubble?.raw ?? "").trim()) {
          this.appendText(e.text);
        }
        this.flushRender();
        this.flushSave();
        this.updateStatus(t("statusDone"));
        break;
      case "error":
        this.addError(e.text);
        this.flushSave();
        this.updateStatus(t("statusError"));
        break;
    }
  }

  // ---------- 渲染 ----------

  private addMsgActions(el: HTMLElement, copyText: string, canResend: boolean) {
    const bar = el.createDiv({ cls: "ah-msg-actions" });
    const copy = bar.createEl("button", { cls: "ah-mini-btn", text: "复制" });
    copy.addEventListener("click", (ev) => {
      ev.stopPropagation();
      navigator.clipboard
        .writeText(copyText)
        .then(() => new Notice(t("copied")))
        .catch(() => new Notice(t("copyFail")));
    });
    if (canResend) {
      const re = bar.createEl("button", { cls: "ah-mini-btn", text: "重新发送" });
      re.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.resend(copyText);
      });
    }
  }

  private addUserBubble(text: string, live: boolean) {
    const el = this.messagesEl.createDiv({ cls: "ah-msg ah-user" });
    this.addMsgActions(el, text, true);
    el.createDiv({ cls: "ah-role", text: t("roleMe") });
    el.createDiv({ cls: "ah-content", text });
    this.scrollDown();
  }

  private appendText(text: string) {
    if (!this.lastBubble || !this.lastBubble.el.isConnected) {
      const el = this.messagesEl.createDiv({ cls: "ah-msg ah-assistant" });
      const content = el.createDiv({ cls: "ah-content" });
      this.lastBubble = { el: content, raw: "" };
      // 复制按钮稍后绑定最终文本：用闭包引用 bubble
      const bubble = this.lastBubble;
      const bar = el.createDiv({ cls: "ah-msg-actions" });
      const copy = bar.createEl("button", { cls: "ah-mini-btn", text: "复制" });
      copy.addEventListener("click", (ev) => {
        ev.stopPropagation();
        navigator.clipboard
          .writeText(bubble.raw)
          .then(() => new Notice(t("copied")))
          .catch(() => new Notice(t("copyFail")));
      });
      el.createDiv({ cls: "ah-role", text: t("roleAgent") });
      el.insertBefore(bar, el.firstChild);
      // 记录到会话
      const msg: StoredMessage = { role: "assistant", text: "", ts: Date.now() };
      this.pushMsg(msg);
      bubble.msg = msg;
    }
    this.lastBubble.raw += text;
    const msg = this.lastBubble.msg;
    if (msg) msg.text = this.lastBubble.raw;
    this.scheduleRender();
    this.scrollDown();
  }

  private scheduleRender() {
    if (this.renderTimer !== null) return;
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      this.flushRender();
    }, 150);
  }

  private flushRender() {
    if (this.renderTimer !== null) {
      window.clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
    const b = this.lastBubble;
    if (b && b.el.isConnected) {
      b.el.empty();
      MarkdownRenderer.render(this.app, b.raw, b.el, "", this).catch(() => b.el.setText(b.raw));
    }
  }

  private addToolCard(name: string, args: Record<string, unknown>, live: boolean) {
    this.flushRender();
    this.lastBubble = null;
    const tier = toolTier(name);
    const card = this.messagesEl.createDiv({ cls: `ah-tool ah-tier-${tier ?? "read"}` });
    const head = card.createDiv({ cls: "ah-tool-head" });
    head.createSpan({ cls: "ah-tool-name", text: name });
    head.createSpan({
      cls: "ah-tool-tier",
      text: tier === "danger" ? t("tierDanger") : tier === "write" ? t("tierWrite") : t("tierRead"),
    });
    head.createSpan({ cls: "ah-tool-status", text: t("toolRunning") });
    card.createDiv({ cls: "ah-tool-summary", text: summarize(name, args).slice(0, 300) });
    const details = card.createEl("details");
    details.createEl("summary", { text: t("params") });
    details.createEl("pre", { text: JSON.stringify(args, null, 2).slice(0, 2000) });
    this.lastToolCard = card;
    if (live) {
      const msg: StoredMessage = { role: "tool", tool: name, args, ts: Date.now() };
      this.pushMsg(msg);
      this.lastToolMsg = msg;
    } else {
      this.lastToolMsg = null;
    }
    this.scrollDown();
  }

  private updateToolCard(text: string, isError?: boolean, live?: boolean) {
    const card = this.lastToolCard;
    if (!card) return;
    const status = card.querySelector(".ah-tool-status") as HTMLElement;
    if (status) {
      status.setText(isError ? t("toolFailed") : t("toolDone"));
      status.toggleClass("ah-err", !!isError);
    }
    if (text) card.createDiv({ cls: "ah-tool-result", text: text.slice(0, 300) });
    if (live && this.lastToolMsg) {
      this.lastToolMsg.result = text;
      this.lastToolMsg.isError = isError;
      this.scheduleSave();
    }
    this.scrollDown();
  }

  private addError(text: string) {
    this.flushRender();
    this.lastBubble = null;
    const el = this.messagesEl.createDiv({ cls: "ah-msg ah-error" });
    this.addMsgActions(el, text, false);
    el.createDiv({ cls: "ah-role", text: t("roleError") });
    el.createDiv({ cls: "ah-content", text });
    this.pushMsg({ role: "error", text, ts: Date.now() });
    this.scrollDown();
  }

  private scrollDown() {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  async onClose() {
    this.abort?.abort();
    this.flushSave();
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
  }
}