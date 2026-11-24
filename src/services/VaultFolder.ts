import { TFolder, Vault } from "obsidian";

export async function ensureFolder(vault: Vault, path: string): Promise<void> {
  if (vault.getAbstractFileByPath(path) instanceof TFolder) return;

  try {
    await vault.createFolder(path);
  } catch (error) {
    // 別の演習ビューが先に作成した場合も、そのフォルダーを使用する。
    if (!(vault.getAbstractFileByPath(path) instanceof TFolder)) throw error;
  }
}
