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
  const feedback = root.createDiv({ cls: "kokushi-study-feedback" });
  const status = feedback.createSpan({ attr: { role: "status" } });
  const retry = feedback.createEl("button", { type: "button", text: "再試行" });
  retry.hidden = true;

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
        retry.hidden = true;
        status.removeClass("kokushi-study-error");
        status.setText("保存中…");
        pending = service.saveMemo(question, text).then(() => {
          saved = text;
          status.setText(input.value === saved ? "保存済み" : "");
          return true;
        }).catch(error => {
          console.error("[Kokushi] Memo save error", error);
          status.addClass("kokushi-study-error");
          status.setText("メモを保存できませんでした。");
          retry.hidden = false;
          return false;
        }).finally(() => { pending = null; });
      }
      if (!await pending) return false;
    }
    return !composing || input.value === saved;
  };

  const schedule = (): void => {
    cancelTimer();
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
  retry.onclick = () => { void flush(); };
  return flush;
}
