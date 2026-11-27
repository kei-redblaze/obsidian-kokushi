import type { KokushiAI } from "../ai/KokushiAI";
import { t } from "../i18n";
import { App, Notice, setIcon, TFile } from "obsidian";
import { QuestionStudyService } from "../services/QuestionStudyService";
import { Question } from "../types";
import { renderQuestionMemo } from "./QuestionMemoEditor";
import { CreateStudyNoteModal, StudyNotePicker } from "./StudyNoteModals";

export async function renderQuestionStudy(
  root: HTMLElement,
  app: App,
  question: Question,
  service: QuestionStudyService,
  ai?: KokushiAI,
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
    const markAll = headingActions.createEl("button", { type: "button", text: t("全てマーク"), cls: "mod-cta" });
    const links = root.createDiv();
    const status = root.createDiv({ cls: "kokushi-study-ai-status", attr: { role: "status" } });
    const actions = root.createDiv({ cls: "kokushi-study-actions" });
    const existing = actions.createEl("button", { type: "button", text: t("その他のノートをマーク") });
    const done = actions.createEl("button", { type: "button", text: t("決定"), cls: "mod-cta" });
    const cancel = actions.createEl("button", { type: "button", text: t("キャンセル") });

    let linked = initial.relatedNotes;
    let suggestions: string[] = [];
    let editing = false;
    let busy = false;
    const selected = new Set<string>();

    const candidatePaths = (): string[] => suggestions.filter(path => !linked.includes(path) && service.getNote(path));
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
      const candidates = candidatePaths();
      markAll.disabled = busy || !candidates.length;
      const paths = [...linked, ...candidates];
      if (!paths.length) {
        links.createEl("p", { text: t("関連づけられているノートはありません") });
        return;
      }

      const list = links.createEl("ul", { cls: "kokushi-related-notes" });
      for (const path of paths) {
        const item = list.createEl("li");
        const note = service.getNote(path);
        const name = note?.basename ?? t("{0}（見つかりません）", path);
        if (editing) {
          const label = item.createEl("label", { cls: "kokushi-study-check" });
          const check = label.createEl("input", { type: "checkbox" });
          check.checked = selected.has(path);
          label.createSpan({ text: name });
          check.onchange = () => {
            if (check.checked) selected.add(path);
            else selected.delete(path);
          };
          continue;
        }
        const marker = item.createSpan({ cls: "kokushi-note-marker" });
        if (linked.includes(path)) {
          setIcon(marker, "pin");
          marker.setAttribute("role", "img");
          marker.setAttribute("aria-label", t("関連付け済み"));
          marker.title = t("関連付け済み");
        } else {
          marker.setText("•");
          marker.setAttribute("aria-hidden", "true");
        }
        if (note) {
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
          item.createSpan({ text: name });
        }
      }
    };

    const stopEditing = (): void => {
      editing = false;
      selected.clear();
      renderLinks();
      edit.focus();
    };

    const apply = async (add: readonly string[], remove: readonly string[]): Promise<boolean> => {
      if (busy) return false;
      busy = true;
      const options = [...Array.from(headingActions.querySelectorAll("button")),
        ...Array.from(actions.querySelectorAll("button")), ...Array.from(links.querySelectorAll("input"))];
      options.forEach(control => { control.disabled = true; });
      try {
        linked = (await service.updateRelatedNotes(question, add, remove)).relatedNotes;
        return true;
      } catch (error) {
        console.error("[Kokushi] Related note update error", error);
        new Notice(t("ノートの関連付けを保存できませんでした。"));
        return false;
      } finally {
        busy = false;
        options.forEach(control => { control.disabled = false; });
        markAll.disabled = !candidatePaths().length;
      }
    };

    renderLinks();
    const attach = async (file: TFile): Promise<void> => {
      linked = (await service.linkNote(question, file)).relatedNotes;
      if (!editing) renderLinks();
    };

    create.onclick = () => {
      new CreateStudyNoteModal(app, title => service.createNote(title), attach, openNote).open();
    };

    const openPicker = (): void => {
      const notes = service.getNotes().filter(note => !linked.includes(note.path));
      if (!notes.length) {
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

    const commitEdit = async (): Promise<boolean> => {
      const add = [...selected].filter(path => !linked.includes(path));
      const remove = linked.filter(path => !selected.has(path));
      if (!await apply(add, remove)) return false;
      stopEditing();
      return true;
    };

    existing.onclick = async () => { if (await commitEdit() && root.isConnected) openPicker(); };
    done.onclick = () => { void commitEdit(); };
    edit.onclick = () => {
      editing = true;
      linked.forEach(path => selected.add(path));
      renderLinks();
      (links.querySelector("input") ?? existing).focus();
    };
    cancel.onclick = stopEditing;
    markAll.onclick = async () => {
      const paths = candidatePaths();
      if (paths.length && await apply(paths, [])) renderLinks();
    };

    if (ai) {
      status.setText(t("関連ノートを検索しています…"));
      void ai.suggestNotes(question, []).then(paths => {
        if (!root.isConnected) return;
        suggestions = paths;
        status.setText("");
        if (!editing && !busy) renderLinks();
      }).catch(error => {
        console.error("[Kokushi] Note suggestion error", error);
        if (root.isConnected) status.setText(t("関連ノート候補を取得できませんでした。"));
      });
    }
    return flushMemo;
  } catch (error) {
    console.error("[Kokushi] Question study load error", error);
    loading.addClass("kokushi-study-error");
    loading.setText(t("メモと関連知識ノートを読み込めませんでした。"));
    return undefined;
  }
}
