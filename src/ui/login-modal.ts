import { App, Modal, Notice } from "obsidian";
import { AgentCredential, AgentSpec, CliAgentSpec, NativeAgentSpec } from "../types";
import { checkLogin, startLogin, LoginProcess } from "../agents/auth";
import { cosyDeviceLogin, cosyPatLogin, readClaudeLocalOAuth, readCosyCred } from "../agents/qwenwork-auth";
import { fetchDynamicModels } from "../agents/models";
import { t } from "../i18n";

export interface LoginDeps {
  credentials: Record<string, AgentCredential>;
  saveCredential: (id: string, cred: AgentCredential) => Promise<void>;
}

/**
 * 应用内登录授权弹窗（双语）：
 * - cosy 站点：设备流（浏览器授权 + 轮询），Qoder CN 另支持 PAT
 * - key/oauth：应用内填写凭据并验证
 * - cli（WorkBuddy）：自动启动 REPL /login 浏览器授权
 */
export class LoginModal extends Modal {
  private proc: LoginProcess | null = null;
  private pollTimer: number | null = null;
  private settled = false;
  private statusEl!: HTMLElement;
  private logEl!: HTMLElement;
  private retryBtn!: HTMLButtonElement;

  constructor(
    app: App,
    private spec: AgentSpec,
    private exe: string | null,
    private onSuccess: () => void,
    private deps: LoginDeps
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("ah-login-modal");
    contentEl.createEl("h3", { text: t("loginTitle", { agent: this.spec.label }) });
    this.statusEl = contentEl.createEl("p", { cls: "ah-login-status", text: "…" });
    this.logEl = contentEl.createEl("pre", { cls: "ah-login-log" });

    if (this.spec.kind === "native" && this.spec.protocol === "cosy") {
      this.buildDeviceFlow(contentEl);
    } else if (this.spec.kind === "native") {
      this.buildCredForm(contentEl);
    } else {
      contentEl.createEl("p", { cls: "ah-confirm-hint", text: t("replHint") });
      this.beginRepl();
    }

    const btns = contentEl.createDiv({ cls: "ah-confirm-buttons" });
    this.retryBtn = btns.createEl("button", { text: t("retry") });
    this.retryBtn.hide();
    this.retryBtn.addEventListener("click", () => {
      if (this.spec.kind === "native" && this.spec.protocol === "cosy") this.beginDevice();
      else if (this.spec.kind === "cli") this.beginRepl();
    });
    const cancel = btns.createEl("button", { text: t("cancel") });
    cancel.addEventListener("click", () => this.close());
  }

  private log(line: string) {
    this.logEl.appendText(line + "\n");
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  // ---- cosy 设备流 ----
  private buildDeviceFlow(contentEl: HTMLElement) {
    const spec = this.spec as NativeAgentSpec;
    contentEl.createEl("p", { cls: "ah-confirm-hint", text: t("deviceHint", { agent: spec.label }) });
    const start = contentEl.createEl("button", { text: t("openBrowser"), cls: "mod-cta" });
    start.addEventListener("click", () => this.beginDevice());
    if (spec.cred === "device+pat") {
      const box = contentEl.createDiv({ cls: "ah-login-pat" });
      box.createEl("p", { cls: "ah-confirm-hint", text: t("patHint") });
      const row = box.createDiv({ cls: "ah-login-pat-row" });
      const input = row.createEl("input", { type: "password", placeholder: "pt-…" });
      const save = row.createEl("button", { text: t("verifySave") });
      save.addEventListener("click", async () => {
        const pat = input.value.trim();
        if (!pat) return new Notice(t("pastePatFirst"));
        save.setText(t("verifying"));
        try {
          await cosyPatLogin(spec.site!, pat);
          this.succeed();
        } catch (e: any) {
          this.statusEl.setText(String(e?.message ?? e));
          save.setText(t("verifySave"));
        }
      });
    }
    this.beginDevice();
  }

  private async beginDevice() {
    const spec = this.spec as NativeAgentSpec;
    this.settled = false;
    this.retryBtn.hide();
    this.statusEl.setText(t("openingLogin"));
    try {
      await cosyDeviceLogin(
        spec.site!,
        (url) => {
          this.log(url);
          window.open(url, "_blank");
          this.statusEl.setText(t("browserOpened"));
        },
        () => this.settled
      );
      if (!this.settled) this.succeed();
    } catch (e: any) {
      if (this.settled) return;
      this.statusEl.setText(String(e?.message ?? e));
      this.retryBtn.show();
    }
  }

  // ---- key / oauth 凭据表单 ----
  private buildCredForm(contentEl: HTMLElement) {
    const spec = this.spec as NativeAgentSpec;
    const cur = this.deps.credentials[spec.id] ?? {};
    contentEl.createEl("p", { cls: "ah-confirm-hint", text: t(`agent.${spec.id}.hint`) || t("credHintDefault") });
    const form = contentEl.createDiv({ cls: "ah-login-pat" });
    let baseInput: HTMLInputElement | null = null;
    if (spec.protocol === "openai-compat") {
      const r = form.createDiv({ cls: "ah-login-pat-row" });
      r.createSpan({ text: t("baseUrl") });
      baseInput = r.createEl("input", { type: "text", placeholder: spec.baseUrl ?? "https://…/v1" });
      baseInput.value = cur.baseUrl ?? spec.baseUrl ?? "";
    }
    const r1 = form.createDiv({ cls: "ah-login-pat-row" });
    r1.createSpan({ text: t("apiKey") });
    const keyInput = r1.createEl("input", { type: "password", placeholder: "sk-…" });
    keyInput.value = cur.apiKey ?? "";
    if (spec.cred === "key+oauth") {
      const r2 = form.createDiv({ cls: "ah-login-pat-row" });
      const oauthBtn = r2.createEl("button", { text: t("readLocalClaude") });
      oauthBtn.addEventListener("click", async () => {
        const tk = readClaudeLocalOAuth();
        if (!tk) {
          this.statusEl.setText(t("noLocalClaude"));
          return;
        }
        await this.deps.saveCredential(spec.id, { ...cur, oauthToken: tk });
        this.statusEl.setText(t("oauthReadOk"));
        await this.verify(spec, { ...cur, oauthToken: tk });
      });
    }
    const save = form.createEl("button", { text: t("verifySave"), cls: "mod-cta" });
    save.addEventListener("click", async () => {
      const cred: AgentCredential = {
        ...cur,
        apiKey: keyInput.value.trim(),
        ...(baseInput ? { baseUrl: baseInput.value.trim() } : {}),
      };
      if (!cred.apiKey && !cred.oauthToken) return new Notice(t("fillKeyOrOauth"));
      save.setText(t("verifying"));
      await this.deps.saveCredential(spec.id, cred);
      await this.verify(spec, cred);
      save.setText(t("verifySave"));
    });
    this.statusEl.setText(t("credHintDefault"));
  }

  private async verify(spec: NativeAgentSpec, cred: AgentCredential) {
    const cosy = spec.protocol === "cosy" ? readCosyCred(spec.site!) : null;
    const models = await fetchDynamicModels(spec, cred, cosy);
    if (models.length || spec.protocol === "openai-compat") {
      this.succeed();
    } else {
      this.statusEl.setText(t("verifyFail"));
    }
  }

  // ---- cli REPL ----
  private beginRepl() {
    const spec = this.spec as CliAgentSpec;
    this.proc?.kill();
    this.settled = false;
    this.retryBtn.hide();
    this.statusEl.setText(t("openingLogin"));
    this.proc = startLogin(spec, this.exe!, (line) => {
      this.log(line);
      if (/https?:\/\//.test(line)) this.statusEl.setText(t("browserOpened"));
    });
    if (!this.proc) {
      this.statusEl.setText(t("cannotStartLogin"));
      return;
    }
    this.proc.done.then(async ({ code, output }) => {
      if (this.settled) return;
      const ok = await checkLogin(spec, this.exe!);
      if (ok === true) return this.succeed();
      if (code !== 0 && code !== null) {
        this.statusEl.setText(t("loginCmdExit", { code }));
        this.log(output.split(/\r?\n/).slice(-4).join("\n"));
        this.retryBtn.show();
      }
    });
    this.pollRepl();
  }

  private pollRepl() {
    const spec = this.spec as CliAgentSpec;
    if (this.pollTimer !== null) window.clearTimeout(this.pollTimer);
    this.pollTimer = window.setTimeout(async () => {
      if (this.settled) return;
      const ok = await checkLogin(spec, this.exe!);
      if (this.settled) return;
      if (ok === true) return this.succeed();
      this.pollRepl();
    }, 3000);
  }

  private succeed() {
    if (this.settled) return;
    this.settled = true;
    this.proc?.kill();
    new Notice(t("loginSuccess", { agent: this.spec.label }));
    this.onSuccess();
    this.close();
  }

  onClose() {
    this.settled = true;
    this.proc?.kill();
    if (this.pollTimer !== null) window.clearTimeout(this.pollTimer);
    this.contentEl.empty();
  }
}