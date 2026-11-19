import { App, Modal, Notice } from "obsidian";
import { Conversation } from "../types";
import { getAgent } from "../agents/registry";
import { t } from "../i18n";

export class HistoryModal extends Modal {
  constructor(
    app: App,
    private conversations: Conversation[],
    private actions: { open: (c: Conversation) => void; remove: (id: string) => Promise<void> }
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("ah-history-modal");
    contentEl.createEl("h3", { text: t("historyTitle") });
    if (!this.conversations.length) {
      contentEl.createEl("p", { cls: "ah-setting-desc", text: t("historyEmpty") });
      return;
    }
    const list = contentEl.createDiv({ cls: "ah-history-list" });
    for (const c of this.conversations) {
      const row = list.createDiv({ cls: "ah-history-row" });
      const main = row.createDiv({ cls: "ah-history-main" });
      main.createDiv({ cls: "ah-history-title", text: c.title || t("untitled") });
      const agent = getAgent(c.agentId)?.label ?? c.agentId;
      const date = new Date(c.updatedAt).toLocaleString();
      main.createDiv({
        cls: "ah-history-meta",
        text: t("historyMeta", { agent, model: c.model || t("defaultModel"), date, n: c.messages.length }),
      });
      const btns = row.createDiv({ cls: "ah-history-btns" });
      const open = btns.createEl("button", { text: t("open"), cls: "mod-cta" });
      open.addEventListener("click", () => {
        this.close();
        this.actions.open(c);
      });
      const del = btns.createEl("button", { text: t("delete") });
      del.addEventListener("click", async () => {
        await this.actions.remove(c.id);
        row.remove();
        new Notice(t("deleted"));
        if (!list.children.length) {
          list.createDiv({ cls: "ah-setting-desc", text: t("historyEmptyAfterDelete") });
        }
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}