import { t } from "../i18n";
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
  const loading = root.createEl("p", { text: t("メモと関連知識ノートを読み込んでいます…") });
  try {
    const initial = await service.load(question);
    loading.remove();
    const flushMemo = renderQuestionMemo(root, question, service, initial.memo);

    const heading = root.createDiv({ cls: "kokushi-study-heading" });
    heading.createEl("h4", { text: t("ノート") });
    const headingActions = heading.createDiv({ cls: "kokushi-study-heading-actions" });
    const create = headingActions.createEl("button", { type: "button", text: t("新規") });
    const edit = headingActions.createEl("button", { type: "button", text: t("編集") });
    const links = root.createDiv();
    const actions = root.createDiv({ cls: "kokushi-study-actions" });
    const existing = actions.createEl("button", { type: "button", text: t("既存ノートを関連付け"), cls: "mod-cta" });
    const remove = actions.createEl("button", { type: "button", text: t("選択した関連付けを外す") });
    const cancel = actions.createEl("button", { type: "button", text: t("キャンセル") });

    let relatedNotes = initial.relatedNotes;
    let editing = false;
    const selected = new Map<string, TFile | null>();

    const openNote = (file: TFile): void => {
      void service.openNote(file).catch(error => {
        console.error("[Kokushi] Related note open error", error);
        new Notice(t("ノートを開けませんでした。"));
      });
    };

    const renderLinks = (): void => {
      links.empty();
      if (editing) {
        headingActions.remove();
        root.append(actions);
      } else {
        actions.remove();
        heading.append(headingActions);
      }
      remove.disabled = selected.size === 0;
      if (relatedNotes.length === 0) {
        links.createEl("p", { text: t("関連づけられているノートはありません") });
        return;
      }

      const list = links.createEl("ul");
      for (const path of relatedNotes) {
        const item = list.createEl("li");
        const note = service.getNote(path);
        const name = note?.basename ?? t("{0}（見つかりません）", path);
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
      edit.focus();
    };

    renderLinks();
    const attach = async (file: TFile): Promise<void> => {
      relatedNotes = (await service.linkNote(question, file)).relatedNotes;
      if (editing) stopEditing();
      else renderLinks();
    };

    create.onclick = () => {
      new CreateStudyNoteModal(app, title => service.createNote(title), attach, openNote).open();
    };

    existing.onclick = () => {
      const notes = service.getNotes().filter(note => !relatedNotes.includes(note.path));
      if (notes.length === 0) {
        new Notice(t("関連付けられるノートがありません。"));
        return;
      }
      new StudyNotePicker(app, notes, file => {
        void attach(file).catch(error => {
          console.error("[Kokushi] Related note link error", error);
          new Notice(t("ノートの関連付けを保存できませんでした。"));
        });
      }).open();
    };

    edit.onclick = () => {
      editing = true;
      renderLinks();
      (links.querySelector("input") ?? existing).focus();
    };
    cancel.onclick = stopEditing;

    remove.onclick = async () => {
      if (remove.disabled) return;
      remove.disabled = cancel.disabled = existing.disabled = true;
      const checks = links.querySelectorAll("input");
      checks.forEach(check => { check.disabled = true; });
      try {
        const paths = Array.from(selected, ([path, note]) => note && note.path !== path ? [path, note.path] : [path]).flat();
        relatedNotes = (await service.unlinkNotes(question, paths)).relatedNotes;
        stopEditing();
      } catch (error) {
        console.error("[Kokushi] Related note unlink error", error);
        new Notice(t("ノートの関連付けを外せませんでした。"));
        remove.disabled = selected.size === 0;
      } finally {
        cancel.disabled = existing.disabled = false;
        checks.forEach(check => { check.disabled = false; });
      }
    };
    return flushMemo;
  } catch (error) {
    console.error("[Kokushi] Question study load error", error);
    loading.addClass("kokushi-study-error");
    loading.setText(t("メモと関連知識ノートを読み込めませんでした。"));
    return undefined;
  }
}
