import { ButtonComponent, Setting } from "obsidian";
import { t } from "../i18n";
import { AIControls } from "./AIControls";

export function renderAISettings(root: HTMLElement, controls: AIControls): () => void {
  const model = new Setting(root)
    .setName(t("端末内AIモデル"))
    .setDesc(t("関連ノート候補と分野分類に使用します。初回の取得は約135 MBです。"));
  const modelStatus = model.descEl.createDiv({ cls: "kokushi-ai-setting-status", attr: { role: "status" } });
  const classification = new Setting(root)
    .setName(t("分野の分類"))
    .setDesc(t("内蔵の27分野を使い、追加・変更された問題を分類します。"));
  const classificationStatus = classification.descEl.createDiv({ cls: "kokushi-ai-setting-status", attr: { role: "status" } });

  const download = new ButtonComponent(model.controlEl).setButtonText(t("モデルを取得")).onClick(() => controls.prepare());
  const update = new ButtonComponent(classification.controlEl).setButtonText(t("分類を更新")).setCta().onClick(() => controls.update());
  return controls.subscribe(() => {
    modelStatus.setText(controls.modelStatus || (controls.isReady ? t("モデルは準備できています。") : ""));
    classificationStatus.setText(controls.classificationStatus);
    download.setDisabled(controls.modelBusy || controls.classificationBusy);
    update.setDisabled(!controls.isReady || controls.modelBusy || controls.classificationBusy);
  });
}
