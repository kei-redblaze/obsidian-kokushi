import { t } from "../i18n";
import { App, Notice, Platform, TFile } from "obsidian";

export async function openQuestionEditor(app: App, path: string): Promise<void> {
  try {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(t("問題Markdownが見つかりません"));
    const workspace = app.workspace;
    const existing = workspace.getLeavesOfType("markdown").find(leaf => leaf.getViewState().state?.file === file.path);
    const leaf = existing ?? (Platform.isPhone ? workspace.getLeaf("tab") : workspace.getLeaf("split", "vertical"));
    await leaf.openFile(file, { state: { mode: "source" }, active: true });
    await workspace.revealLeaf(leaf);
  } catch (error) {
    console.error("[Kokushi] Question editor error", error);
    new Notice(t("問題Markdownを開けませんでした。"));
  }
}
