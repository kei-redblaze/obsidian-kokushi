import { App, Notice, TFile } from "obsidian";
import { QuestionStudyService } from "../services/QuestionStudyService";
import { Question } from "../types";
import { renderQuestionMemo } from "./QuestionMemoEditor";
import { CreateStudyNoteModal, StudyNotePicker } from "./StudyNoteModals";

export async function renderQuestionStudy(
  root: HTMLElement,
  app: App,
  question: Question,
  service: QuestionStudyService,
): Promise<(() => Promise<boolean>) | undefined> {
  const loading = root.createEl("p", { text: "メモと関連知識ノートを読み込んでいます…" });
  try {
    const initial = await service.load(question);
    loading.remove();
    const flushMemo = renderQuestionMemo(root, question, service, initial.memo);

    root.createEl("h4", { text: "関連知識ノート" });
    const links = root.createDiv();
    const actions = root.createDiv({ cls: "kokushi-study-actions" });
    const create = actions.createEl("button", { type: "button", text: "新規ノート", cls: "mod-cta" });
    const existing = actions.createEl("button", { type: "button", text: "既存ノートを関連付け", cls: "mod-cta" });
    const edit = actions.createEl("button", { type: "button", text: "編集", cls: "mod-cta" });
    const remove = actions.createEl("button", { type: "button", text: "選択した関連付けを外す" });
    const cancel = actions.createEl("button", { type: "button", text: "キャンセル" });

    let relatedNotes = initial.relatedNotes;
    let editing = false;
    const selected = new Map<string, TFile | null>();

    const openNote = (file: TFile): void => {
      void service.openNote(file).catch(error => {
        console.error("[Kokushi] Related note open error", error);
        new Notice("ノートを開けませんでした。");
      });
    };

    const renderLinks = (): void => {
      links.empty();
      create.hidden = existing.hidden = edit.hidden = editing;
      edit.disabled = relatedNotes.length === 0;
      remove.hidden = cancel.hidden = !editing;
      remove.disabled = selected.size === 0;
      if (relatedNotes.length === 0) return;

      const list = links.createEl("ul");
      for (const path of relatedNotes) {
        const item = list.createEl("li");
        const note = service.getNote(path);
        const name = note?.basename ?? `${path}（見つかりません）`;
        if (editing) {
          const label = item.createEl("label", { cls: "kokushi-study-check" });
          const check = label.createEl("input", { type: "checkbox" });
          check.checked = selected.has(path);
          label.createSpan({ text: name });
          check.onchange = () => {
            if (check.checked) selected.set(path, note);
            else selected.delete(path);
            remove.disabled = selected.size === 0;
          };
        } else if (note) {
          const link = item.createEl("a", {
            text: name,
            attr: { href: path.split("/").map(encodeURIComponent).join("/"), title: note.path },
            cls: "kokushi-study-link",
          });
          link.onclick = event => {
            event.preventDefault();
            openNote(note);
          };
        } else {
          item.setText(name);
        }
      }
    };

    const stopEditing = (): void => {
      editing = false;
      selected.clear();
      renderLinks();
    };

    renderLinks();
    const attach = async (file: TFile): Promise<void> => {
      relatedNotes = (await service.linkNote(question, file)).relatedNotes;
      renderLinks();
    };

    create.onclick = () => {
      new CreateStudyNoteModal(app, title => service.createNote(title), attach, openNote).open();
    };

    existing.onclick = () => {
      const notes = service.getNotes().filter(note => !relatedNotes.includes(note.path));
      if (notes.length === 0) {
        new Notice("関連付けられるノートがありません。");
        return;
      }
      new StudyNotePicker(app, notes, file => {
        void attach(file).catch(error => {
          console.error("[Kokushi] Related note link error", error);
          new Notice("ノートの関連付けを保存できませんでした。");
        });
      }).open();
    };

    edit.onclick = () => {
      editing = true;
      renderLinks();
      links.querySelector("input")?.focus();
    };
    cancel.onclick = stopEditing;

    remove.onclick = async () => {
      if (remove.disabled) return;
      remove.disabled = cancel.disabled = true;
      const checks = links.querySelectorAll("input");
      checks.forEach(check => { check.disabled = true; });
      try {
        const paths = Array.from(selected, ([path, note]) => note && note.path !== path ? [path, note.path] : [path]).flat();
        relatedNotes = (await service.unlinkNotes(question, paths)).relatedNotes;
        stopEditing();
      } catch (error) {
        console.error("[Kokushi] Related note unlink error", error);
        new Notice("ノートの関連付けを外せませんでした。");
        remove.disabled = selected.size === 0;
      } finally {
        cancel.disabled = false;
        checks.forEach(check => { check.disabled = false; });
      }
    };
    return flushMemo;
  } catch (error) {
    console.error("[Kokushi] Question study load error", error);
    loading.addClass("kokushi-study-error");
    loading.setText("メモと関連知識ノートを読み込めませんでした。");
    return undefined;
  }
}
