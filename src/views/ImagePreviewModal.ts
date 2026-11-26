import { t } from "../i18n";
import { bindAppearance, unbindAppearance } from "./KokushiAppearance";
import { App, Modal, Notice } from "obsidian";
import { resolveQuestionAsset } from "../services/QuestionAssets";

export function bindImagePreview(app: App, root: HTMLElement, questionPath: string): () => void {
  const view = root.ownerDocument.defaultView ?? window;
  const markImages = (): void => {
    for (const image of Array.from(root.querySelectorAll<HTMLImageElement>("img"))) {
      if (image.classList.contains("kokushi-previewable-image")) continue;
      image.classList.add("kokushi-previewable-image");
      image.tabIndex = 0;
      image.setAttribute("role", "button");
      image.setAttribute("aria-label", image.alt ? t("{0}を拡大表示", image.alt) : t("画像を拡大表示"));
    }
  };
  const open = (event: MouseEvent | KeyboardEvent): void => {
    if ("key" in event && event.key !== "Enter" && event.key !== " ") return;
    if (!(event.target instanceof view.HTMLImageElement) || !event.target.classList.contains("kokushi-previewable-image")) return;
    if (!(event.target.currentSrc || event.target.src)) return;
    event.preventDefault();
    event.stopPropagation();
    new ImagePreviewModal(app, event.target, questionPath).open();
  };
  markImages();
  const observer = new view.MutationObserver(markImages);
  observer.observe(root, { childList: true, subtree: true });
  root.addEventListener("click", open, true);
  root.addEventListener("keydown", open, true);
  return () => {
    observer.disconnect();
    root.removeEventListener("click", open, true);
    root.removeEventListener("keydown", open, true);
  };
}

class ImagePreviewModal extends Modal {
  constructor(app: App, private original: HTMLImageElement, private questionPath: string) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.original.alt || t("問題画像"));
    bindAppearance(this.app, this.modalEl);
    const root = this.contentEl;
    root.addClass("kokushi-image-preview");
    const image = root.createEl("img", {
      attr: { src: this.original.currentSrc || this.original.src, alt: this.original.alt },
    });
    const actions = root.createDiv({ cls: "kokushi-history-actions" });
    const copy = actions.createEl("button", { type: "button", text: t("画像をコピー"), cls: "mod-cta" });
    const close = actions.createEl("button", { type: "button", text: t("閉じる") });
    close.onclick = () => this.close();
    copy.onclick = async () => {
      if (copy.disabled) return;
      copy.disabled = true;
      try {
        const embed = this.original.closest(".internal-embed")?.getAttribute("src");
        await copyImage(this.original.naturalWidth ? this.original : image, () => {
          if (!embed) return null;
          const file = resolveQuestionAsset(this.app, embed, this.questionPath);
          return file ? this.app.vault.readBinary(file) : null;
        });
        new Notice(t("画像をコピーしました。"));
      } catch (error) {
        console.error("[Kokushi] Image copy error", error);
        new Notice(t("画像をコピーできませんでした。画像の読み込みと端末の対応状況を確認してください。"));
      } finally {
        copy.disabled = false;
      }
    };
  }

  onClose(): void {
    unbindAppearance(this.app, this.modalEl);
    this.contentEl.empty();
  }
}

async function copyImage(image: HTMLImageElement, readVaultImage: () => Promise<ArrayBuffer> | null): Promise<void> {
  const view = image.ownerDocument.defaultView ?? window;
  if (!view.navigator.clipboard?.write || !view.ClipboardItem) throw new Error(t("画像のコピーに対応していません"));
  // 書き込みはクリックの処理中に開始し、画像の変換結果は ClipboardItem に渡す。
  const blob = imagePng(image).catch(async (error: unknown) => {
    const data = await readVaultImage();
    if (!data) throw error;
    const bytes = new Uint8Array(data);
    if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) {
      return new view.Blob([data], { type: "image/png" });
    }
    const objectUrl = view.URL.createObjectURL(new view.Blob([data]));
    const localImage = image.ownerDocument.createElement("img");
    localImage.src = objectUrl;
    try {
      return await imagePng(localImage);
    } finally {
      view.URL.revokeObjectURL(objectUrl);
    }
  });
  void blob.catch(() => {});
  await view.navigator.clipboard.write([new view.ClipboardItem({ "image/png": blob })]);
}

async function imagePng(image: HTMLImageElement): Promise<Blob> {
  if (!image.naturalWidth) await image.decode();
  const canvas = image.ownerDocument.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context || !canvas.width || !canvas.height) throw new Error(t("画像を読み込めません"));
  context.drawImage(image, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error(t("PNGに変換できません")));
  }, "image/png"));
}
