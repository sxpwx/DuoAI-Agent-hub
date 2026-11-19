import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { AGENTS, detectCli } from "./agents/registry";
import { installNpmPackage } from "./agents/detect";
import { readCosyCred, cosyPatLogin, readClaudeLocalOAuth } from "./agents/qwenwork-auth";
import { CliAgentSpec, NativeAgentSpec } from "./types";
import { LoginModal } from "./ui/login-modal";
import { t, t2 } from "./i18n";
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
      .setName(t2("language"))
      .setDesc(t2("languageDesc", undefined, "\n"))
      .addDropdown((d) =>
        d
          .addOption("auto", t2("langAuto"))
          .addOption("zh", t2("langZh"))
          .addOption("en", t2("langEn"))
          .setValue(this.plugin.settings.language)
          .onChange(async (v) => {
            this.plugin.settings.language = v as "auto" | "zh" | "en";
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName(t2("permMode"))
      .setDesc(t2("permModeDesc", undefined, "\n"))
      .addDropdown((d) =>
        d
          .addOption("confirm", t2("permConfirmOpt"))
          .addOption("full", t2("permFullOpt"))
          .setValue(this.plugin.settings.permissionMode)
          .onChange(async (v) => {
            this.plugin.settings.permissionMode = v as "confirm" | "full";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t2("networkTools"))
      .setDesc(t2("networkToolsDesc", undefined, "\n"))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.networkTools).onChange(async (v) => {
          this.plugin.settings.networkTools = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t2("confirmTimeout"))
      .setDesc(t2("confirmTimeoutDesc", undefined, "\n"))
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
      containerEl.createEl("p", { cls: "ah-setting-desc", text: t2(`agent.${spec.id}.desc`) });
      if (spec.kind === "native") this.nativeSection(containerEl, spec);
      else if (spec.kind === "cli") this.cliSection(containerEl, spec);
    }

    containerEl.createEl("h3", { text: t("securityTitle") });
    containerEl.createEl("p", { cls: "ah-setting-desc", text: t2("securityDesc", undefined, "\n") });
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
      .setName(t2("loginCredSetup"))
      .setDesc(t2(`agent.${spec.id}.hint`))
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
      new Setting(containerEl).setName(t2("baseUrl")).addText((tx) =>
        tx.setPlaceholder(spec.baseUrl ?? "https://…/v1").setValue(cur.baseUrl ?? spec.baseUrl ?? "").onChange(async (v) => {
          this.plugin.settings.credentials[spec.id] = { ...cur, baseUrl: v.trim() };
          await this.plugin.saveSettings();
        })
      );
    }
    if (spec.cred === "key" || spec.cred === "key+oauth") {
      new Setting(containerEl).setName(t2("apiKey")).addText((tx) => {
        tx.inputEl.type = "password";
        tx.setValue(cur.apiKey ?? "").onChange(async (v) => {
          this.plugin.settings.credentials[spec.id] = { ...this.plugin.settings.credentials[spec.id], apiKey: v.trim() };
          await this.plugin.saveSettings();
          renderStatus();
        });
      });
      if (spec.cred === "key+oauth") {
        new Setting(containerEl)
          .setName(t2("localClaude"))
          .setDesc(t2("localClaudeDesc", undefined, "\n"))
          .addButton((b) =>
            b.setButtonText(t2("readBtn")).onClick(async () => {
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
        .setName(t2("patOptional"))
        .setDesc(t2("patDesc", undefined, "\n"))
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
      .setName(t2("cliPath"))
      .setDesc(t2("cliPathDesc", undefined, "\n"))
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
        b.setButtonText(t2("redetect")).onClick(() => {
          renderStatus();
          new Notice(t("detected"));
        })
      );

    containerEl.createEl("p", { cls: "ah-setting-hint", text: t("loginHintPrefix", { hint: t(`agent.${cli.id}.hint`) }) });

    const npmPkg = cli.installHint.match(/npm install -g (\S+)/)?.[1];
    if (npmPkg) {
      const progressEl = containerEl.createEl("p", { cls: "ah-setting-hint" });
      new Setting(containerEl)
        .setName(t2("installCli"))
        .setDesc(t2("installCliDesc", { pkg: npmPkg }))
        .addButton((b) =>
          b.setButtonText(t2("install")).onClick(async () => {
            b.setDisabled(true);
            b.setButtonText(t2("installing"));
            progressEl.setText(t2("installProgress"));
            const { ok, tail } = await installNpmPackage(npmPkg, (line) => progressEl.setText(line));
            b.setDisabled(false);
            b.setButtonText(t2("install"));
            progressEl.setText(ok ? t("installOk") : t("installFail", { tail: tail.slice(-300) }));
            new Notice(ok ? t("installOkNotice", { pkg: npmPkg }) : t("installFailNotice", { pkg: npmPkg }));
            renderStatus();
          })
        );
    }
  }
}