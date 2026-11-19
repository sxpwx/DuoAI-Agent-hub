import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { AGENTS, detectCli } from "./agents/registry";
import { installNpmPackage } from "./agents/detect";
import { readCosyCred, cosyPatLogin, readClaudeLocalOAuth } from "./agents/qwenwork-auth";
import { CliAgentSpec, NativeAgentSpec } from "./types";
import { LoginModal } from "./ui/login-modal";
import { t } from "./i18n";
import type AgentHubPlugin from "./main";

export class AgentHubSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: AgentHubPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: t("settingsTitle") });

    new Setting(containerEl)
      .setName(t("language"))
      .setDesc(t("languageDesc"))
      .addDropdown((d) =>
        d
          .addOption("auto", t("langAuto"))
          .addOption("zh", t("langZh"))
          .addOption("en", t("langEn"))
          .setValue(this.plugin.settings.language)
          .onChange(async (v) => {
            this.plugin.settings.language = v as "auto" | "zh" | "en";
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName(t("permMode"))
      .setDesc(t("permModeDesc"))
      .addDropdown((d) =>
        d
          .addOption("confirm", t("permConfirmOpt"))
          .addOption("full", t("permFullOpt"))
          .setValue(this.plugin.settings.permissionMode)
          .onChange(async (v) => {
            this.plugin.settings.permissionMode = v as "confirm" | "full";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("networkTools"))
      .setDesc(t("networkToolsDesc"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.networkTools).onChange(async (v) => {
          this.plugin.settings.networkTools = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("confirmTimeout"))
      .setDesc(t("confirmTimeoutDesc"))
      .addText((tx) =>
        tx.setValue(String(this.plugin.settings.confirmTimeoutSec)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (n >= 10 && n <= 3600) {
            this.plugin.settings.confirmTimeoutSec = n;
            await this.plugin.saveSettings();
          }
        })
      );

    for (const spec of AGENTS) {
      containerEl.createEl("h3", { text: spec.label });
      containerEl.createEl("p", { cls: "ah-setting-desc", text: t(`agent.${spec.id}.desc`) });
      if (spec.kind === "native") this.nativeSection(containerEl, spec);
      else if (spec.kind === "cli") this.cliSection(containerEl, spec);
    }

    containerEl.createEl("h3", { text: t("securityTitle") });
    containerEl.createEl("p", { cls: "ah-setting-desc", text: t("securityDesc") });
  }

  private nativeSection(containerEl: HTMLElement, spec: NativeAgentSpec) {
    const statusEl = containerEl.createEl("p", { cls: "ah-setting-status" });
    const renderStatus = () => {
      if (spec.protocol === "cosy") {
        const cred = readCosyCred(spec.site!);
        statusEl.setText(cred ? t("statusLoggedIn", { name: String(cred.name || cred.email || cred.uid) }) : t("statusNotLoggedIn"));
        statusEl.toggleClass("ah-ok", !!cred);
        statusEl.toggleClass("ah-missing", !cred);
      } else {
        const c = this.plugin.settings.credentials[spec.id];
        const ok = !!(c?.apiKey || c?.oauthToken);
        statusEl.setText(ok ? t("statusCredOk") : t("statusCredMissing"));
        statusEl.toggleClass("ah-ok", ok);
        statusEl.toggleClass("ah-missing", !ok);
      }
    };
    renderStatus();

    new Setting(containerEl)
      .setName(t("loginCredSetup"))
      .setDesc(t(`agent.${spec.id}.hint`))
      .addButton((b) =>
        b.setButtonText(spec.protocol === "cosy" ? t("loginAuthBtn") : t("configCredBtn")).onClick(() => {
          new LoginModal(this.app, spec, null, () => renderStatus(), {
            credentials: this.plugin.settings.credentials,
            saveCredential: async (id, cred) => {
              this.plugin.settings.credentials[id] = cred;
              await this.plugin.saveSettings();
            },
          }).open();
        })
      );

    const cur = this.plugin.settings.credentials[spec.id] ?? {};
    if (spec.protocol === "openai-compat") {
      new Setting(containerEl).setName(t("baseUrl")).addText((tx) =>
        tx.setPlaceholder(spec.baseUrl ?? "https://…/v1").setValue(cur.baseUrl ?? spec.baseUrl ?? "").onChange(async (v) => {
          this.plugin.settings.credentials[spec.id] = { ...cur, baseUrl: v.trim() };
          await this.plugin.saveSettings();
        })
      );
    }
    if (spec.cred === "key" || spec.cred === "key+oauth") {
      new Setting(containerEl).setName(t("apiKey")).addText((tx) => {
        tx.inputEl.type = "password";
        tx.setValue(cur.apiKey ?? "").onChange(async (v) => {
          this.plugin.settings.credentials[spec.id] = { ...this.plugin.settings.credentials[spec.id], apiKey: v.trim() };
          await this.plugin.saveSettings();
          renderStatus();
        });
      });
      if (spec.cred === "key+oauth") {
        new Setting(containerEl)
          .setName(t("localClaude"))
          .setDesc(t("localClaudeDesc"))
          .addButton((b) =>
            b.setButtonText(t("readBtn")).onClick(async () => {
              const tk = readClaudeLocalOAuth();
              if (!tk) return new Notice(t("readNone"));
              this.plugin.settings.credentials[spec.id] = { ...this.plugin.settings.credentials[spec.id], oauthToken: tk };
              await this.plugin.saveSettings();
              renderStatus();
              new Notice(t("readOk"));
            })
          );
      }
    }
    if (spec.cred === "device+pat") {
      new Setting(containerEl)
        .setName(t("patOptional"))
        .setDesc(t("patDesc"))
        .addText((tx) => {
          tx.inputEl.type = "password";
          tx.setPlaceholder("pt-…").onChange(async (v) => {
            const pat = v.trim();
            if (!pat) return;
            try {
              await cosyPatLogin(spec.site!, pat);
              renderStatus();
              new Notice(t("patOk"));
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
      statusEl.setText(det.available ? t("statusDetected", { path: det.path ?? "" }) : t("statusNotDetected", { hint: cli.installHint }));
      statusEl.toggleClass("ah-ok", det.available);
      statusEl.toggleClass("ah-missing", !det.available);
    };
    renderStatus();

    new Setting(containerEl)
      .setName(t("cliPath"))
      .setDesc(t("cliPathDesc"))
      .addText((tx) =>
        tx
          .setPlaceholder(t("autodetect"))
          .setValue(this.plugin.settings.cliPaths[cli.id] ?? "")
          .onChange(async (v) => {
            this.plugin.settings.cliPaths[cli.id] = v.trim();
            await this.plugin.saveSettings();
            renderStatus();
          })
      )
      .addButton((b) =>
        b.setButtonText(t("redetect")).onClick(() => {
          renderStatus();
          new Notice(t("detected"));
        })
      );

    containerEl.createEl("p", { cls: "ah-setting-hint", text: t("loginHintPrefix", { hint: t(`agent.${cli.id}.hint`) }) });

    const npmPkg = cli.installHint.match(/npm install -g (\S+)/)?.[1];
    if (npmPkg) {
      const progressEl = containerEl.createEl("p", { cls: "ah-setting-hint" });
      new Setting(containerEl)
        .setName(t("installCli"))
        .setDesc(t("installCliDesc", { pkg: npmPkg }))
        .addButton((b) =>
          b.setButtonText(t("install")).onClick(async () => {
            b.setDisabled(true);
            b.setButtonText(t("installing"));
            progressEl.setText(t("installProgress"));
            const { ok, tail } = await installNpmPackage(npmPkg, (line) => progressEl.setText(line));
            b.setDisabled(false);
            b.setButtonText(t("install"));
            progressEl.setText(ok ? t("installOk") : t("installFail", { tail: tail.slice(-300) }));
            new Notice(ok ? t("installOkNotice", { pkg: npmPkg }) : t("installFailNotice", { pkg: npmPkg }));
            renderStatus();
          })
        );
    }
  }
}