import { App, TFile } from "obsidian";

export function resolveQuestionAsset(app: App, link: string, questionPath: string): TFile | null {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(link)) return null;
  const target = link.split("#")[0] ?? "";
  let decoded: string;
  try { decoded = decodeURIComponent(target); } catch { decoded = target; }
  if (!decoded) return null;
  const parts = decoded.startsWith("/") ? [] : questionPath.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  const direct = app.vault.getAbstractFileByPath(parts.join("/"));
  if (direct instanceof TFile) return direct;
  return decoded.startsWith(".") ? null : app.metadataCache.getFirstLinkpathDest(decoded, questionPath);
}
