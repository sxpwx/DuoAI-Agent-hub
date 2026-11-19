import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { AGENTS, detectCli } from "./agents/registry";
import { installNpmPackage } from "./agents/detect";
import { readCosyCred, cosyPatLogin, readClaudeLocalOAuth } from "./agents/qwenwork-auth";
import { CliAgentSpec, NativeAgentSpec } from "./types";
import { LoginModal } from "./ui/login-modal";
import type AgentHubPlugin from "./main";

export class AgentHubSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: AgentHubPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Agent Hub 设置" });

    new Setting(containerEl)
      .setName("权限模式")
      .setDesc("默认：读取免确认，写入需确认，删除强确认。最高权限：所有操作直接执行（仍仅限 vault 内）。")
      .addDropdown((d) =>
        d
          .addOption("confirm", "重要操作需确认（默认）")
          .addOption("full", "最高权限（免确认）")
          .setValue(this.plugin.settings.permissionMode)
          .onChange(async (v) => {
            this.plugin.settings.permissionMode = v as "confirm" | "full";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("联网工具")
      .setDesc("允许 Agent 使用 web_search / fetch_webpage / add_image_to_note。搜索/读网页免确认；下载图片写入 vault 需确认。")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.networkTools).onChange(async (v) => {
          this.plugin.settings.networkTools = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("确认超时（秒）")
      .setDesc("确认弹窗超时未响应将自动拒绝。")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.confirmTimeoutSec)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (n >= 10 && n <= 3600) {
            this.plugin.settings.confirmTimeoutSec = n;
            await this.plugin.saveSettings();
          }
        })
      );

    for (const spec of AGENTS) {
      containerEl.createEl("h3", { text: spec.label });
      containerEl.createEl("p", { cls: "ah-setting-desc", text: spec.description });

      if (spec.kind === "native") {
        this.nativeSection(containerEl, spec);
      } else if (spec.kind === "cli") {
        this.cliSection(containerEl, spec);
      }
    }

    containerEl.createEl("h3", { text: "安全说明" });
    containerEl.createEl("p", {
      cls: "ah-setting-desc",
      text:
        "所有 Agent 的工具执行发生在插件内，受三级权限网关约束；vault 工具路径校验拒绝绝对路径、上级目录与隐藏目录；写入仅限 .md / .canvas；删除移入系统回收站。" +
        "联网工具仅允许公网 http/https（阻断内网/回环地址），图片下载校验类型与 10MB 上限。凭据仅保存于本机。",
    });
  }

  private nativeSection(containerEl: HTMLElement, spec: NativeAgentSpec) {
    const statusEl = containerEl.createEl("p", { cls: "ah-setting-status" });
    const renderStatus = () => {
      if (spec.protocol === "cosy") {
        const cred = readCosyCred(spec.site!);
        statusEl.setText(cred ? `已登录：${cred.name || cred.email || cred.uid}` : "未登录。选择该 Agent 或点下方按钮完成授权。");
        statusEl.toggleClass("ah-ok", !!cred);
        statusEl.toggleClass("ah-missing", !cred);
      } else {
        const c = this.plugin.settings.credentials[spec.id];
        const ok = !!(c?.apiKey || c?.oauthToken);
        statusEl.setText(ok ? "凭据已配置。" : "未配置凭据。");
        statusEl.toggleClass("ah-ok", ok);
        statusEl.toggleClass("ah-missing", !ok);
      }
    };
    renderStatus();

    new Setting(containerEl)
      .setName("登录 / 凭据配置")
      .setDesc(spec.loginHint ?? "")
      .addButton((b) =>
        b.setButtonText(spec.protocol === "cosy" ? "登录授权" : "配置凭据").onClick(() => {
          new LoginModal(
            this.app,
            spec,
            null,
            () => renderStatus(),
            {
              credentials: this.plugin.settings.credentials,
              saveCredential: async (id, cred) => {
                this.plugin.settings.credentials[id] = cred;
                await this.plugin.saveSettings();
              },
            }
          ).open();
        })
      );

    const cur = this.plugin.settings.credentials[spec.id] ?? {};
    if (spec.protocol === "openai-compat") {
      new Setting(containerEl)
        .setName("Base URL")
        .addText((t) =>
          t.setPlaceholder(spec.baseUrl ?? "https://…/v1").setValue(cur.baseUrl ?? spec.baseUrl ?? "").onChange(async (v) => {
            this.plugin.settings.credentials[spec.id] = { ...cur, baseUrl: v.trim() };
            await this.plugin.saveSettings();
          })
        );
    }
    if (spec.cred === "key" || spec.cred === "key+oauth") {
      new Setting(containerEl)
        .setName("API Key")
        .addText((t) => {
          t.inputEl.type = "password";
          t.setValue(cur.apiKey ?? "").onChange(async (v) => {
            this.plugin.settings.credentials[spec.id] = { ...this.plugin.settings.credentials[spec.id], apiKey: v.trim() };
            await this.plugin.saveSettings();
            renderStatus();
          });
        });
      if (spec.cred === "key+oauth") {
        new Setting(containerEl)
          .setName("本机 Claude Code 登录态")
          .setDesc("读取 ~/.claude/.credentials.json 中的 OAuth 令牌（若已登录过 Claude Code）")
          .addButton((b) =>
            b.setButtonText("读取").onClick(async () => {
              const t = readClaudeLocalOAuth();
              if (!t) return new Notice("本机无 Claude Code 登录态");
              this.plugin.settings.credentials[spec.id] = { ...this.plugin.settings.credentials[spec.id], oauthToken: t };
              await this.plugin.saveSettings();
              renderStatus();
              new Notice("已读取本机 OAuth 登录态");
            })
          );
      }
    }
    if (spec.cred === "device+pat") {
      new Setting(containerEl)
        .setName("PAT（可选）")
        .setDesc("qoder.com.cn 账号页生成的 Personal Access Token")
        .addText((t) => {
          t.inputEl.type = "password";
          t.setPlaceholder("pt-…").onChange(async (v) => {
            const pat = v.trim();
            if (!pat) return;
            try {
              await cosyPatLogin(spec.site!, pat);
              renderStatus();
              new Notice("PAT 验证成功");
            } catch (e: any) {
              new Notice(String(e?.message ?? e));
            }
          });
        });
    }
  }

  private cliSection(containerEl: HTMLElement, cli: CliAgentSpec) {
    const statusEl = containerEl.createEl("p", { cls: "ah-setting-status" });
    const renderStatus = () => {
      const det = detectCli(cli, this.plugin.settings.cliPaths[cli.id]);
      statusEl.setText(det.available ? `已检测到：${det.path}` : `未检测到。安装方式：${cli.installHint}`);
      statusEl.toggleClass("ah-ok", det.available);
      statusEl.toggleClass("ah-missing", !det.available);
    };
    renderStatus();

    new Setting(containerEl)
      .setName("CLI 路径（可选覆盖）")
      .setDesc("留空则自动检测。可指定 .exe 或 cli.js 的绝对路径。")
      .addText((t) =>
        t
          .setPlaceholder("自动检测")
          .setValue(this.plugin.settings.cliPaths[cli.id] ?? "")
          .onChange(async (v) => {
            this.plugin.settings.cliPaths[cli.id] = v.trim();
            await this.plugin.saveSettings();
            renderStatus();
          })
      )
      .addButton((b) =>
        b.setButtonText("重新检测").onClick(() => {
          renderStatus();
          new Notice("检测完成");
        })
      );

    if (cli.loginHint) {
      containerEl.createEl("p", { cls: "ah-setting-hint", text: "登录提示：" + cli.loginHint });
    }
    const npmPkg = cli.installHint.match(/npm install -g (\S+)/)?.[1];
    if (npmPkg) {
      const progressEl = containerEl.createEl("p", { cls: "ah-setting-hint" });
      new Setting(containerEl)
        .setName("一键安装 CLI")
        .setDesc(`在应用内执行 npm install -g ${npmPkg}（无需打开终端，可能需要几分钟）`)
        .addButton((b) =>
          b.setButtonText("安装").onClick(async () => {
            b.setDisabled(true);
            b.setButtonText("安装中…");
            progressEl.setText("正在安装…");
            const { ok, tail } = await installNpmPackage(npmPkg, (line) => progressEl.setText(line));
            b.setDisabled(false);
            b.setButtonText("安装");
            progressEl.setText(ok ? "安装完成。" : "安装失败：" + tail.slice(-300));
            new Notice(ok ? `${npmPkg} 安装完成` : `${npmPkg} 安装失败，详情见设置页`);
            renderStatus();
          })
        );
    }
  }
}