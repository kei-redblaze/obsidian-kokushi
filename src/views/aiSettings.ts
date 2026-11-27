import { ButtonComponent, DropdownComponent, Setting, TextComponent, ToggleComponent } from "obsidian";
import { DEFAULT_NOTE_THRESHOLD, isNoteThreshold, isSearchMode, SEARCH_MODES, SearchMode, SearchPreferences } from "../ai/searchPreferences";
import { t } from "../i18n";
import { AIControls } from "./AIControls";

export function renderAISettings(
  root: HTMLElement,
  controls: AIControls,
  preferences: () => SearchPreferences,
  save: (change: Partial<SearchPreferences>) => Promise<void>,
): () => void {
  const model = new Setting(root)
    .setName(t("端末内AIモデル"))
    .setDesc(t("ベクトル検索とハイブリッドで使用します。初回の取得は約135 MBです。"));
  const modelStatus = statusLine(model);
  const backendStatus = statusLine(model);
  const download = new ButtonComponent(model.controlEl).setButtonText(t("モデルを取得")).onClick(() => controls.prepare());
  const remove = new ButtonComponent(model.controlEl).setButtonText(t("モデルを削除")).onClick(() => controls.confirmRemoval());

  const gpuSetting = new Setting(root).setName(t("WebGPUを使用する"))
    .setDesc(t("失敗時はCPU（WASM）に自動で切り替えます。"));
  const gpu = new ToggleComponent(gpuSetting.controlEl).onChange(async enabled => {
    await save({ useWebGPU: enabled });
    sync();
  });

  const classification = new Setting(root)
    .setName(t("分野の分類"))
    .setDesc(t("内蔵の27分野を使い、追加・変更された問題を分類します。"));
  const classificationStatus = statusLine(classification);
  const classificationFallback = statusLine(classification);
  const classificationMode = modeDropdown(classification, async mode => {
    await save({ classificationMode: mode });
    sync();
  });
  const update = new ButtonComponent(classification.controlEl).setButtonText(t("分類を更新")).setCta().onClick(() => controls.update());

  const note = new Setting(root).setName(t("関連ノート検索"));
  const noteFallback = statusLine(note);
  const noteMode = modeDropdown(note, async mode => {
    await save({ noteMode: mode });
    sync();
  });
  const threshold = new Setting(root).setName(t("関連ノート候補の閾値"))
    .setDesc(t("ベクトル候補のコサイン類似度。値が高いほど候補が絞られます。"));
  const number = new TextComponent(threshold.controlEl);
  number.inputEl.type = "number";
  number.inputEl.min = "0";
  number.inputEl.max = "1";
  number.inputEl.step = "0.01";
  number.inputEl.setAttribute("aria-label", t("関連ノート候補の閾値"));
  number.inputEl.addEventListener("change", () => {
    void (async () => {
      const value = number.inputEl.valueAsNumber;
      if (isNoteThreshold(value)) await save({ noteThreshold: value });
      number.setValue(preferences().noteThreshold.toFixed(2));
      sync();
    })();
  });
  const reset = new ButtonComponent(threshold.controlEl).setButtonText(t("初期値に戻す")).onClick(async () => {
    await save({ noteThreshold: DEFAULT_NOTE_THRESHOLD });
    sync();
  });

  function sync(): void {
    const settings = preferences();
    const busy = controls.modelBusy || controls.classificationBusy;
    const ready = controls.isReady;
    modelStatus.setText(controls.modelStatus || (ready ? t("モデルは準備できています。") : ""));
    backendStatus.setText(controls.backend === "webgpu" ? t("使用中：WebGPU") : controls.backend === "wasm" ? t("使用中：CPU（WASM）") : "");
    classificationStatus.setText(controls.classificationStatus);
    const fallback = t("端末内モデルがないため、キーワード検索で動作します。");
    classificationFallback.setText(!ready && settings.classificationMode !== "keyword" ? fallback : "");
    noteFallback.setText(!ready && settings.noteMode !== "keyword" ? fallback : "");
    download.setDisabled(busy);
    remove.setDisabled(busy);
    gpu.setValue(settings.useWebGPU).setDisabled(busy);
    update.setDisabled(busy);
    classificationMode.setValue(settings.classificationMode).setDisabled(busy);
    noteMode.setValue(settings.noteMode);
    if (number.inputEl !== root.ownerDocument.activeElement) number.setValue(settings.noteThreshold.toFixed(2));
    reset.setDisabled(settings.noteThreshold === DEFAULT_NOTE_THRESHOLD);
  }

  return controls.subscribe(sync);
}

function modeDropdown(setting: Setting, onChange: (mode: SearchMode) => Promise<void>): DropdownComponent {
  const dropdown = new DropdownComponent(setting.controlEl).setDisabled(false);
  const labels = { vector: t("ベクトル検索"), keyword: t("キーワード検索"), hybrid: t("ハイブリッド") };
  for (const mode of SEARCH_MODES) dropdown.addOption(mode, labels[mode]);
  dropdown.selectEl.setAttribute("aria-label", setting.nameEl.textContent ?? "");
  return dropdown.onChange(mode => isSearchMode(mode) ? onChange(mode) : undefined);
}

function statusLine(setting: Setting): HTMLElement {
  return setting.descEl.createDiv({ cls: "kokushi-ai-setting-status", attr: { role: "status" } });
}
