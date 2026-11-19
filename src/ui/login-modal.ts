import { App, Modal, Notice } from "obsidian";
import { AgentCredential, AgentSpec, CliAgentSpec, NativeAgentSpec } from "../types";
import { checkLogin, startLogin, LoginProcess } from "../agents/auth";
import { cosyDeviceLogin, cosyPatLogin, readClaudeLocalOAuth, readCosyCred } from "../agents/qwenwork-auth";
import { fetchDynamicModels } from "../agents/models";

export interface LoginDeps {
  credentials: Record<string, AgentCredential>;
  saveCredential: (id: string, cred: AgentCredential) => Promise<void>;
}

/**
 * 应用内登录授权弹窗：
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
    contentEl.createEl("h3", { text: `登录授权 · ${this.spec.label}` });
    this.statusEl = contentEl.createEl("p", { cls: "ah-login-status", text: "准备中…" });
    this.logEl = contentEl.createEl("pre", { cls: "ah-login-log" });

    if (this.spec.kind === "native" && this.spec.protocol === "cosy") {
      this.buildDeviceFlow(contentEl);
    } else if (this.spec.kind === "native") {
      this.buildCredForm(contentEl);
    } else {
      contentEl.createEl("p", {
        cls: "ah-confirm-hint",
        text: "正在打开浏览器授权页，请在浏览器中完成登录授权，然后回到这里等待结果。无需操作终端。",
      });
      this.beginRepl();
    }

    const btns = contentEl.createDiv({ cls: "ah-confirm-buttons" });
    this.retryBtn = btns.createEl("button", { text: "重试" });
    this.retryBtn.hide();
    this.retryBtn.addEventListener("click", () => {
      if (this.spec.kind === "native" && this.spec.protocol === "cosy") this.beginDevice();
      else if (this.spec.kind === "cli") this.beginRepl();
    });
    const cancel = btns.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.close());
  }

  private log(line: string) {
    this.logEl.appendText(line + "\n");
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  // ---- cosy 设备流 ----
  private buildDeviceFlow(contentEl: HTMLElement) {
    const spec = this.spec as NativeAgentSpec;
    contentEl.createEl("p", {
      cls: "ah-confirm-hint",
      text: `点击开始后浏览器打开${spec.label}登录页（与桌面端同账号），授权完成自动回到这里。`,
    });
    const start = contentEl.createEl("button", { text: "打开浏览器授权", cls: "mod-cta" });
    start.addEventListener("click", () => this.beginDevice());
    if (spec.cred === "device+pat") {
      const box = contentEl.createDiv({ cls: "ah-login-pat" });
      box.createEl("p", { cls: "ah-confirm-hint", text: "或粘贴 Personal Access Token（qoder.com.cn 账号页生成）：" });
      const row = box.createDiv({ cls: "ah-login-pat-row" });
      const input = row.createEl("input", { type: "password", placeholder: "pt-…" });
      const save = row.createEl("button", { text: "验证并保存" });
      save.addEventListener("click", async () => {
        const pat = input.value.trim();
        if (!pat) return new Notice("请先粘贴 PAT");
        save.setText("验证中…");
        try {
          await cosyPatLogin(spec.site!, pat);
          this.succeed();
        } catch (e: any) {
          this.statusEl.setText(String(e?.message ?? e));
          save.setText("验证并保存");
        }
      });
    }
    this.beginDevice();
  }

  private async beginDevice() {
    const spec = this.spec as NativeAgentSpec;
    this.settled = false;
    this.retryBtn.hide();
    this.statusEl.setText("正在打开登录页…");
    try {
      await cosyDeviceLogin(
        spec.site!,
        (url) => {
          this.log(url);
          window.open(url, "_blank");
          this.statusEl.setText("浏览器已打开授权页，请完成登录授权…");
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
    contentEl.createEl("p", { cls: "ah-confirm-hint", text: spec.loginHint ?? "填写凭据后验证保存。" });
    const form = contentEl.createDiv({ cls: "ah-login-pat" });
    let baseInput: HTMLInputElement | null = null;
    if (spec.protocol === "openai-compat") {
      const r = form.createDiv({ cls: "ah-login-pat-row" });
      r.createSpan({ text: "Base URL" });
      baseInput = r.createEl("input", { type: "text", placeholder: spec.baseUrl ?? "https://…/v1" });
      baseInput.value = cur.baseUrl ?? spec.baseUrl ?? "";
    }
    const r1 = form.createDiv({ cls: "ah-login-pat-row" });
    r1.createSpan({ text: "API Key" });
    const keyInput = r1.createEl("input", { type: "password", placeholder: "sk-…" });
    keyInput.value = cur.apiKey ?? "";
    let oauthBtn: HTMLButtonElement | null = null;
    if (spec.cred === "key+oauth") {
      const r2 = form.createDiv({ cls: "ah-login-pat-row" });
      oauthBtn = r2.createEl("button", { text: "读取本机 Claude Code 登录态" });
      oauthBtn.addEventListener("click", async () => {
        const t = readClaudeLocalOAuth();
        if (!t) {
          this.statusEl.setText("本机无 Claude Code 登录态（~/.claude/.credentials.json 不存在）。请填 API Key。");
          return;
        }
        await this.deps.saveCredential(spec.id, { ...cur, oauthToken: t });
        this.statusEl.setText("已读取本机 OAuth 登录态，验证中…");
        await this.verify(spec, { ...cur, oauthToken: t });
      });
    }
    const save = form.createEl("button", { text: "验证并保存", cls: "mod-cta" });
    save.addEventListener("click", async () => {
      const cred: AgentCredential = {
        ...cur,
        apiKey: keyInput.value.trim(),
        ...(baseInput ? { baseUrl: baseInput.value.trim() } : {}),
      };
      if (!cred.apiKey && !cred.oauthToken) return new Notice("请填写 API Key 或读取本机登录态");
      save.setText("验证中…");
      await this.deps.saveCredential(spec.id, cred);
      await this.verify(spec, cred);
      save.setText("验证并保存");
    });
    this.statusEl.setText("填写凭据后点击验证。");
  }

  private async verify(spec: NativeAgentSpec, cred: AgentCredential) {
    const cosy = spec.protocol === "cosy" ? readCosyCred(spec.site!) : null;
    const models = await fetchDynamicModels(spec, cred, cosy);
    if (models.length || spec.protocol === "openai-compat") {
      this.succeed();
    } else {
      this.statusEl.setText("验证未通过：请检查凭据/网络（模型目录为空）。");
    }
  }

  // ---- cli REPL ----
  private beginRepl() {
    const spec = this.spec as CliAgentSpec;
    this.proc?.kill();
    this.settled = false;
    this.retryBtn.hide();
    this.statusEl.setText("正在启动登录流程…");
    this.proc = startLogin(spec, this.exe!, (line) => {
      this.log(line);
      if (/https?:\/\//.test(line)) this.statusEl.setText("浏览器授权页已打开，等待授权完成…");
    });
    if (!this.proc) {
      this.statusEl.setText("无法启动登录命令，请在设置中检查 CLI 路径或先安装。");
      return;
    }
    this.proc.done.then(async ({ code, output }) => {
      if (this.settled) return;
      const ok = await checkLogin(spec, this.exe!);
      if (ok === true) return this.succeed();
      if (code !== 0 && code !== null) {
        this.statusEl.setText(`登录命令退出（code=${code}）。可重试。`);
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
    new Notice(`${this.spec.label} 登录/凭据配置成功`);
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