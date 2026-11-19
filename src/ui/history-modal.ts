import { App, Modal, Notice } from "obsidian";
import { Conversation } from "../types";
import { getAgent } from "../agents/registry";

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
    contentEl.createEl("h3", { text: "历史会话" });
    if (!this.conversations.length) {
      contentEl.createEl("p", { cls: "ah-setting-desc", text: "暂无历史会话。发送第一条消息后会自动保存。" });
      return;
    }
    const list = contentEl.createDiv({ cls: "ah-history-list" });
    for (const c of this.conversations) {
      const row = list.createDiv({ cls: "ah-history-row" });
      const main = row.createDiv({ cls: "ah-history-main" });
      main.createDiv({ cls: "ah-history-title", text: c.title || "（无标题）" });
      const agent = getAgent(c.agentId)?.label ?? c.agentId;
      const date = new Date(c.updatedAt).toLocaleString();
      main.createDiv({
        cls: "ah-history-meta",
        text: `${agent} · ${c.model || "默认模型"} · ${date} · ${c.messages.length} 条消息`,
      });
      const btns = row.createDiv({ cls: "ah-history-btns" });
      const open = btns.createEl("button", { text: "打开", cls: "mod-cta" });
      open.addEventListener("click", () => {
        this.close();
        this.actions.open(c);
      });
      const del = btns.createEl("button", { text: "删除" });
      del.addEventListener("click", async () => {
        await this.actions.remove(c.id);
        row.remove();
        new Notice("已删除该会话");
        if (!list.children.length) {
          list.createDiv({ cls: "ah-setting-desc", text: "暂无历史会话。" });
        }
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}