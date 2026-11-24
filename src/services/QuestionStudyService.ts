import { App, Platform, TAbstractFile, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { isMap, isScalar, isSeq, parseDocument, Scalar } from "yaml";
import { PATHS, QUESTION_ID_PATTERN } from "../constants";
import { Question } from "../types";
import { ensureFolder } from "./VaultFolder";

interface QuestionStudy {
  memo: string;
  relatedNotes: string[];
}

export class QuestionStudyService {
  private pending: Promise<void> = Promise.resolve();
  private noteLeaf: WorkspaceLeaf | null = null;

  constructor(private app: App) {}

  async load(question: Question): Promise<QuestionStudy> {
    await this.pending;
    const doc = parseMetadata(await this.app.vault.cachedRead(this.getMetadataFile(question)), question.id);
    const memo: unknown = doc.get("memo");
    const node = doc.get("relatedNotes", true);
    const relatedNotes = isSeq(node)
      ? node.items.flatMap(item => isScalar(item) && isNotePath(item.value) ? [item.value] : [])
      : [];
    return {
      memo: typeof memo === "string" ? memo : "",
      relatedNotes: [...new Set(relatedNotes)],
    };
  }

  saveMemo(question: Question, memo: string): Promise<void> {
    return this.enqueue(async () => {
      await this.app.vault.process(this.getMetadataFile(question), data => {
        const doc = parseMetadata(data, question.id);
        const value = memo.replace(/[\r\n]+/g, " ");
        const existing = doc.get("memo", true);
        if (isScalar(existing) && existing.value === value && existing.type === Scalar.QUOTE_DOUBLE) {
          return data;
        }

        const node = isScalar(existing) ? existing : new Scalar(value);
        node.value = value;
        node.type = Scalar.QUOTE_DOUBLE;
        // メモは YAML の明示タグの有無にかかわらず文字列として保存する。
        delete node.tag;
        doc.set("memo", node);
        return doc.toString({ lineWidth: 0 });
      });
    });
  }

  async linkNote(question: Question, note: TFile): Promise<QuestionStudy> {
    await this.enqueue(async () => {
      await this.app.vault.process(this.getMetadataFile(question), data => {
        const path = note.path;
        if (this.getNote(path) !== note) throw new Error("関連付けられるノートが見つかりません");
        const doc = parseMetadata(data, question.id);
        if (!doc.has("relatedNotes")) doc.set("relatedNotes", doc.createNode([]));
        const links = noteLinks(doc);
        if (links.some(link => link.value === path)) return data;

        doc.addIn(["relatedNotes"], new Scalar(path));
        return doc.toString({ lineWidth: 0 });
      });
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
      throw new Error("ノート名に使えない文字があるか、名前が空です。");
    }

    await ensureFolder(this.app.vault, PATHS.notes);
    const path = `${PATHS.notes}/${title}.md`;
    if (this.app.vault.getAbstractFileByPath(path)) {
      throw new Error("同名のノートがあります。「既存ノートを関連付け」から選べます。");
    }
    return this.app.vault.create(path, `# ${title}\n`);
  }

  async openNote(note: TFile): Promise<void> {
    if (this.getNote(note.path) !== note) throw new Error("ノートが見つかりません");

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
        if (!metadata.path.startsWith(`${PATHS.questions}/`) ||
            metadata.extension !== "yaml" || !QUESTION_ID_PATTERN.test(metadata.basename)) continue;

        try {
          const raw = await this.app.vault.cachedRead(metadata);
          if (!raw.includes("relatedNotes")) continue;
          const links = noteLinks(parseMetadata(raw, metadata.basename));
          if (!links.some(link => replacePath(link.value) !== link.value)) continue;

          await this.app.vault.process(metadata, data => {
            const doc = parseMetadata(data, metadata.basename);
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

  private getMetadataFile(question: Question): TFile {
    const path = question.path.replace(/\.md$/, ".yaml");
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error("問題のYAMLファイルが見つかりません");
    return file;
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

function parseMetadata(data: string, id: string) {
  const doc = parseDocument(data);
  if (doc.errors.length || !isMap(doc.contents) || doc.get("id") !== id) {
    throw new Error("問題YAMLの形式または問題IDが不正です");
  }
  return doc;
}

function noteLinks(doc: ReturnType<typeof parseMetadata>): Scalar<string>[] {
  const node = doc.get("relatedNotes", true);
  if (node === undefined) return [];

  if (!isSeq(node) || !node.items.every((item): item is Scalar<string> =>
    isScalar(item) && typeof item.value === "string"
  )) {
    throw new Error("relatedNotes は文字列の一覧で指定してください");
  }
  return node.items;
}
