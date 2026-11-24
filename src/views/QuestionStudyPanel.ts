import { App, Notice, TFile } from "obsidian";
import { QuestionStudyService } from "../services/QuestionStudyService";
import { Question } from "../types";
import { CreateStudyNoteModal, StudyNotePicker } from "./StudyNoteModals";

export async function renderQuestionStudy(
  root: HTMLElement,
  app: App,
  question: Question,
  service: QuestionStudyService,
): Promise<void> {
  const loading = root.createEl("p", { text: "メモと関連知識ノートを読み込んでいます…" });
  try {
    const initial = await service.load(question);
    loading.remove();

    const form = root.createEl("form", { cls: "kokushi-study-memo" });
    const label = form.createEl("label", { text: "メモ", cls: "kokushi-study-field" });
    const input = label.createEl("input", { type: "text" });
    input.value = initial.memo;
    const save = form.createEl("button", { type: "submit", text: "保存" });
    const memoStatus = root.createDiv({ cls: "kokushi-study-status", attr: { role: "status" } });

    let savedMemo = initial.memo;
    save.disabled = true;
    input.oninput = () => {
      save.disabled = input.value === savedMemo;
      memoStatus.setText("");
    };

    form.onsubmit = async event => {
      event.preventDefault();
      const memo = input.value;
      if (memo === savedMemo || save.disabled) return;
      save.disabled = true;
      input.readOnly = true;

      try {
        await service.saveMemo(question, memo);
        savedMemo = memo;
        memoStatus.removeClass("kokushi-study-error");
        memoStatus.setText("メモを保存しました。");
      } catch (error) {
        console.error("[Kokushi] Memo save error", error);
        memoStatus.addClass("kokushi-study-error");
        memoStatus.setText("メモを保存できませんでした。");
      } finally {
        input.readOnly = false;
        save.disabled = input.value === savedMemo;
      }
    };

    root.createEl("h4", { text: "関連知識ノート" });
    const links = root.createDiv();
    const actions = root.createDiv({ cls: "kokushi-study-actions" });
    const create = actions.createEl("button", { type: "button", text: "新規ノート" });
    const existing = actions.createEl("button", { type: "button", text: "既存ノートを関連付け" });

    const openNote = (file: TFile): void => {
      void service.openNote(file).catch(error => {
        console.error("[Kokushi] Related note open error", error);
        new Notice("ノートを開けませんでした。");
      });
    };

    const renderLinks = (paths: string[]): void => {
      links.empty();
      if (paths.length === 0) return;

      const list = links.createEl("ul");
      for (const path of paths) {
        const item = list.createEl("li");
        const note = service.getNote(path);
        if (!note) {
          item.setText(`${path}（見つかりません）`);
          continue;
        }
        const button = item.createEl("button", {
          type: "button",
          text: note.basename,
          attr: { title: note.path },
          cls: "kokushi-dashboard-link",
        });
        button.onclick = () => { openNote(note); };
      }
    };

    let relatedNotes = initial.relatedNotes;
    renderLinks(relatedNotes);
    const attach = async (file: TFile): Promise<void> => {
      const updated = await service.linkNote(question, file);
      relatedNotes = updated.relatedNotes;
      renderLinks(relatedNotes);
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
  } catch (error) {
    console.error("[Kokushi] Question study load error", error);
    loading.addClass("kokushi-study-error");
    loading.setText("メモと関連知識ノートを読み込めませんでした。");
  }
}
