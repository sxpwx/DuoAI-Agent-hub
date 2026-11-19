import { App, Modal } from "obsidian";
import { ConfirmDecision, ConfirmRequest } from "../types";
import { t } from "../i18n";

export function requestConfirmation(app: App, req: ConfirmRequest, timeoutSec: number): Promise<ConfirmDecision> {
  return new Promise((resolve) => {
    new ConfirmModal(app, req, timeoutSec, resolve).open();
  });
}

export class ConfirmModal extends Modal {
  private decision: ConfirmDecision = "deny";
  private settled = false;
  private timer: number | null = null;

  constructor(
    app: App,
    private req: ConfirmRequest,
    private timeoutSec: number,
    private done: (d: ConfirmDecision) => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("ah-confirm-modal");
    if (this.req.tier === "danger") modalEl.addClass("ah-danger");

    contentEl.createEl("h3", {
      text: this.req.tier === "danger" ? t("confirmDangerTitle", { tool: this.req.tool }) : t("confirmWriteTitle", { tool: this.req.tool }),
    });
    contentEl.createEl("p", {
      cls: "ah-confirm-hint",
      text: this.req.tier === "danger" ? t("confirmDangerHint") : t("confirmWriteHint"),
    });
    contentEl.createEl("pre", { cls: "ah-confirm-summary", text: this.req.summary });

    const details = contentEl.createEl("details");
    details.createEl("summary", { text: t("fullArgs") });
    details.createEl("pre", {
      cls: "ah-confirm-args",
      text: JSON.stringify(this.req.args, null, 2).slice(0, 4000),
    });

    const remain = contentEl.createEl("p", { cls: "ah-confirm-timer" });
    let left = this.timeoutSec;
    const tick = () => {
      remain.setText(t("timeoutHint", { s: left }));
      if (left <= 0) {
        this.finish("deny");
        return;
      }
      left--;
      this.timer = window.setTimeout(tick, 1000);
    };
    tick();

    const btns = contentEl.createDiv({ cls: "ah-confirm-buttons" });
    const deny = btns.createEl("button", { text: t("deny") });
    deny.addEventListener("click", () => this.finish("deny"));
    const allowSession = btns.createEl("button", { text: t("allowSession"), cls: "ah-btn-warn" });
    allowSession.addEventListener("click", () => this.finish("allow-session"));
    const allow = btns.createEl("button", {
      text: this.req.tier === "danger" ? t("confirmExecute") : t("allow"),
      cls: this.req.tier === "danger" ? "mod-warning" : "mod-cta",
    });
    allow.addEventListener("click", () => this.finish("allow"));
    deny.focus();
  }

  private finish(d: ConfirmDecision) {
    if (this.settled) return;
    this.settled = true;
    this.decision = d;
    this.close();
  }

  /** 外部强制拒绝（如用户点击停止） */
  forceDeny() {
    this.finish("deny");
  }

  onClose() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.contentEl.empty();
    this.done(this.decision);
  }
}