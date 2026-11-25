import { QuestionStudyService } from "../services/QuestionStudyService";
import { Question } from "../types";

const SAVE_DELAY = 500;

export function renderQuestionMemo(
  root: HTMLElement,
  question: Question,
  service: QuestionStudyService,
  initial: string,
): () => Promise<boolean> {
  const label = root.createEl("label", { text: "メモ", cls: "kokushi-study-field" });
  const input = label.createEl("textarea", { cls: "kokushi-study-memo", attr: { rows: "3" } });
  input.value = initial;
  const status = root.createDiv({
    cls: "kokushi-study-feedback kokushi-study-error",
    attr: { role: "status" },
  });

  const owner = root.ownerDocument.defaultView ?? window;
  let saved = initial;
  let timer: number | undefined;
  let composing = false;
  let pending: Promise<boolean> | null = null;

  const cancelTimer = (): void => {
    if (timer === undefined) return;
    owner.clearTimeout(timer);
    timer = undefined;
  };

  const flush = async (): Promise<boolean> => {
    cancelTimer();
    while (!composing && (pending || input.value !== saved)) {
      if (!pending) {
        const text = input.value;
        pending = service.saveMemo(question, text).then(() => {
          saved = text;
          status.setText("");
          return true;
        }).catch(error => {
          console.error("[Kokushi] Memo save error", error);
          const dirty = input.value !== saved;
          status.setText(dirty ? "メモを保存できませんでした。" : "");
          return !dirty;
        }).finally(() => { pending = null; });
      }
      if (!await pending) return false;
    }
    return !composing || input.value === saved;
  };

  const schedule = (): void => {
    cancelTimer();
    if (input.value === saved) status.setText("");
    if (composing || input.value === saved) return;
    timer = owner.setTimeout(() => { void flush(); }, SAVE_DELAY);
  };

  input.oninput = schedule;
  input.onblur = () => { if (!composing) void flush(); };
  input.addEventListener("compositionstart", () => {
    composing = true;
    cancelTimer();
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    if (input.ownerDocument.activeElement === input) schedule();
    else void flush();
  });
  return flush;
}
