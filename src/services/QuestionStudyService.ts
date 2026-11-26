import { t } from "../i18n";
import { App, Platform, TAbstractFile, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { Document, isMap, isScalar, isSeq, parseDocument, Scalar } from "yaml";
import { PATHS } from "../constants";
import { QuestionReference } from "../types";
import { ensureFolder } from "./VaultFolder";

interface QuestionStudy {
  memo: string;
  relatedNotes: string[];
}

export class QuestionStudyService {
  private pending: Promise<void> = Promise.resolve();
  private noteLeaf: WorkspaceLeaf | null = null;

  constructor(private app: App) {}

  async load(question: QuestionReference): Promise<QuestionStudy> {
    await this.pending;
    const file = this.getStudyFile(this.studyPath(question));
    if (!file) return { memo: "", relatedNotes: [] };

    const doc = parseStudy(await this.app.vault.cachedRead(file));
    const memo: unknown = doc.get("memo");
    return {
      memo: typeof memo === "string" ? memo : "",
      relatedNotes: [...new Set(noteLinks(doc).map(link => link.value).filter(isNotePath))],
    };
  }

  saveMemo(question: QuestionReference, memo: string): Promise<void> {
    const value = memo.replace(/\r\n?/g, "\n");
    return this.updateStudy(question, Boolean(value), doc => {
      const existing = doc.get("memo", true);
      if (isScalar(existing) && existing.value === value && existing.type === Scalar.QUOTE_DOUBLE) return false;

      const node = new Scalar(value);
      node.type = Scalar.QUOTE_DOUBLE;
      doc.set("memo", node);
      return true;
    });
  }

  async linkNote(question: QuestionReference, note: TFile): Promise<QuestionStudy> {
    await this.updateStudy(question, true, doc => {
      const path = note.path;
      if (this.getNote(path) !== note) throw new Error(t("関連付けられるノートが見つかりません"));
      if (noteLinks(doc).some(link => link.value === path)) return false;

      if (!doc.has("relatedNotes")) doc.set("relatedNotes", doc.createNode([]));
      doc.addIn(["relatedNotes"], new Scalar(path));
      return true;
    });
    return this.load(question);
  }

  async unlinkNotes(question: QuestionReference, paths: string[]): Promise<QuestionStudy> {
    const selected = new Set(paths);
    await this.updateStudy(question, false, doc => {
      const links = noteLinks(doc);
      const remaining = links.filter(link => !selected.has(link.value));
      if (remaining.length === links.length) return false;
      doc.set("relatedNotes", doc.createNode(remaining));
      return true;
    });
    return this.load(question);
  }

  getNotes(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter(file => isNotePath(file.path));
  }

  getNote(path: string): TFile | null {
    if (!isNotePath(path)) return null;
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile && file.path === path ? file : null;
  }

  async createNote(value: string): Promise<TFile> {
    const title = value.trim().replace(/\.md$/i, "").trim();
    const invalid = [...title].some(character =>
      '/\\:*?"<>|[]#^'.includes(character) || character.charCodeAt(0) < 32
    );
    if (!title || title.startsWith(".") || title.endsWith(".") || invalid ||
        /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(title)) {
      throw new Error(t("ノート名に使えない文字があるか、名前が空です。"));
    }

    await ensureFolder(this.app.vault, PATHS.notes);
    const path = `${PATHS.notes}/${title}.md`;
    if (this.app.vault.getAbstractFileByPath(path)) {
      throw new Error(t("同名のノートがあります。「既存ノートを関連付け」から選べます。"));
    }
    return this.app.vault.create(path, `# ${title}\n`);
  }

  async openNote(note: TFile): Promise<void> {
    if (this.getNote(note.path) !== note) throw new Error(t("ノートが見つかりません"));

    const workspace = this.app.workspace;
    const leaves = workspace.getLeavesOfType("markdown");
    const current = leaves.find(leaf => leaf.getViewState().state?.file === note.path);
    if (current) {
      await workspace.revealLeaf(current);
      return;
    }

    const reusable = this.noteLeaf && leaves.includes(this.noteLeaf) ? this.noteLeaf : null;
    const leaf = reusable ?? (Platform.isPhone ? workspace.getLeaf("tab") : workspace.getLeaf("split", "vertical"));
    await leaf.openFile(note);
    this.noteLeaf = leaf;
    await workspace.revealLeaf(leaf);
  }

  async trackRename(file: TAbstractFile, oldPath: string): Promise<number> {
    const from = oldPath.startsWith(`${PATHS.notes}/`);
    const to = file.path.startsWith(`${PATHS.notes}/`);
    if (!from || !to || !(file instanceof TFolder || file instanceof TFile && isNotePath(oldPath) && isNotePath(file.path))) {
      return 0;
    }

    const newPath = file.path;
    const replacePath = (path: string): string => {
      if (file instanceof TFolder && path.startsWith(oldPath + "/")) {
        return newPath + path.slice(oldPath.length);
      }
      return path === oldPath ? newPath : path;
    };

    let failed = 0;
    await this.enqueue(async () => {
      for (const metadata of this.app.vault.getFiles()) {
        if (!metadata.path.startsWith(`${PATHS.study}/`) || metadata.extension !== "yaml") continue;

        try {
          const raw = await this.app.vault.cachedRead(metadata);
          if (!raw.includes("relatedNotes")) continue;
          const links = noteLinks(parseStudy(raw));
          if (!links.some(link => replacePath(link.value) !== link.value)) continue;

          await this.app.vault.process(metadata, data => {
            const doc = parseStudy(data);
            let changed = false;
            for (const link of noteLinks(doc)) {
              const updated = replacePath(link.value);
              if (updated !== link.value) {
                link.value = updated;
                changed = true;
              }
            }
            return changed ? doc.toString({ lineWidth: 0 }) : data;
          });
        } catch (error) {
          failed++;
          console.error("[Kokushi] Related note rename error", metadata.path, error);
        }
      }
    });
    return failed;
  }

  private studyPath(question: QuestionReference): string {
    return `${PATHS.study}/${question.source}/${question.id}.yaml`;
  }

  private getStudyFile(path: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile || file === null) return file;
    throw new Error(t("問題の学習データの保存先がファイルではありません"));
  }

  private updateStudy(
    question: QuestionReference,
    create: boolean,
    update: (doc: Document) => boolean,
  ): Promise<void> {
    return this.enqueue(async () => {
      const path = this.studyPath(question);
      let file = this.getStudyFile(path);
      if (!file && create) {
        await ensureFolder(this.app.vault, `${PATHS.study}/${question.source}`);
        file = this.getStudyFile(path);
        if (!file) {
          const doc = new Document({});
          if (!update(doc)) return;
          try {
            await this.app.vault.create(path, doc.toString({ lineWidth: 0 }));
            return;
          } catch (error) {
            // 同期などで先に作成された場合は既存ファイルへ変更を適用する。
            file = this.getStudyFile(path);
            if (!file) throw error;
          }
        }
      }
      if (file) {
        await this.app.vault.process(file, data => {
          const doc = parseStudy(data);
          return update(doc) ? doc.toString({ lineWidth: 0 }) : data;
        });
      }
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const write = this.pending.then(task);
    this.pending = write.catch(() => {});
    return write;
  }
}

function isNotePath(path: unknown): path is string {
  return typeof path === "string" && path.startsWith(`${PATHS.notes}/`) && /\.md$/i.test(path);
}

function parseStudy(data: string): Document {
  const doc = parseDocument(data);
  if (doc.errors.length || !isMap(doc.contents)) {
    throw new Error(t("問題の学習データのYAMLが不正です"));
  }
  return doc;
}

function noteLinks(doc: Document): Scalar<string>[] {
  const node = doc.get("relatedNotes", true);
  if (node === undefined) return [];

  if (!isSeq(node) || !node.items.every((item): item is Scalar<string> =>
    isScalar(item) && typeof item.value === "string"
  )) {
    throw new Error(t("relatedNotes は文字列の一覧で指定してください"));
  }
  return node.items;
}
