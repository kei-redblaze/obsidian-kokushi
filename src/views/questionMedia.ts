import { Notice } from "obsidian";

const IMAGE = "img, picture, .image-embed";
const IMAGE_BLOCK = "p, span, a, div";
const GALLERY = ".kokushi-image-gallery";

export function arrangeQuestionImages(root: HTMLElement): () => void {
  const size = (image: HTMLImageElement): void => {
    if (!image.naturalWidth || !image.naturalHeight) return;
    image.classList.toggle("kokushi-image-portrait", image.naturalHeight > image.naturalWidth);
    image.classList.toggle("kokushi-image-landscape", image.naturalHeight <= image.naturalWidth);
  };

  const update = (): void => {
    root.querySelectorAll("img").forEach(size);
    groupImages(root);
  };
  const onLoad = (event: Event): void => {
    const ImageElement = root.ownerDocument.defaultView?.HTMLImageElement ?? HTMLImageElement;
    if (event.target instanceof ImageElement) size(event.target);
  };

  root.addEventListener("load", onLoad, true);
  const Observer = root.ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
  const observer = new Observer(update);
  update();
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    root.removeEventListener("load", onLoad, true);
  };
}

function groupImages(parent: HTMLElement): void {
  if (parent.matches(`${IMAGE}, ${GALLERY}`)) return;

  const groupStandalone = !parent.closest("p, span, a, table, figure, li, blockquote");
  const groups: HTMLElement[][] = [];
  let run: HTMLElement[] = [];
  for (const node of Array.from(parent.childNodes)) {
    const element = node.instanceOf(HTMLElement) ? node : null;
    if (element && isImageBlock(element)) {
      run.push(element);
      continue;
    }
    if (node.nodeType === Node.COMMENT_NODE ||
        node.nodeType === Node.TEXT_NODE && !node.textContent?.trim() ||
        element?.matches("br")) {
      continue;
    }
    if (!groupStandalone) {
      if (run.length > 1) groups.push(run);
      run = [];
    }

    if (element) groupImages(element);
  }
  if (run.length > 1) groups.push(run);

  for (const group of groups) {
    const gallery = group.find(item => item.matches(GALLERY)) ??
      parent.createEl(parent.matches("p, span, a") ? "span" : "div", {
        cls: "kokushi-image-gallery",
        attr: { tabindex: "0", role: "region", "aria-label": "問題文の画像" },
      });

    const first = group[0];
    if (first && first !== gallery) first.before(gallery);
    const contents = group.flatMap(image =>
      image.matches(GALLERY) ? Array.from(image.childNodes) : [image]
    );
    gallery.append(...contents);
    group.filter(image => image !== gallery && image.matches(GALLERY)).forEach(image => image.remove());
  }

  // 画像が1段落に収まっている場合も、段落内の画像の並びを整える。
  Array.from(parent.children).forEach(child => {
    if (child.instanceOf(HTMLElement) && !child.matches(GALLERY) && isImageBlock(child)) {
      if (!child.matches(IMAGE)) groupImages(child);
    }
  });
}

function isImageBlock(element: HTMLElement): boolean {
  return element.matches(`${IMAGE}, ${GALLERY}`) ||
    element.matches(IMAGE_BLOCK) && !element.textContent?.trim() &&
    !!element.querySelector(IMAGE) && !element.querySelector("table, hr, video, audio");
}

export function formatQuestionCopy(
  id: string,
  question: HTMLElement,
  answer: HTMLElement,
): string {
  const stem = plainText(question);
  const options = Array.from(answer.querySelectorAll<HTMLElement>(".kokushi-option"))
    .map(option => {
      const label = option.querySelector(".kokushi-option-letter")?.textContent ?? "";
      const content = option.querySelector(".kokushi-option-markdown");
      return [label, content ? plainText(content) : ""].filter(Boolean).join(" ");
    });
  return [id, stem, options.join("\n")].filter(Boolean).join("\n\n");
}

function plainText(root: Element): string {
  const text = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const element = node as Element;
    if (element.matches(`${IMAGE}, ${GALLERY}, audio, video, script, style`)) return "";
    if (element.matches("br")) return "\n";
    if (element.matches("table")) {
      const rows = Array.from(element.querySelectorAll("tr")).filter(row => row.closest("table") === element);
      return "\n" + rows.map(row => text(row)).join("\n") + "\n";
    }
    if (element.matches("tr")) {
      return Array.from(element.children).map(cell => text(cell).trim()).join(" | ");
    }
    const content = Array.from(element.childNodes).map(text).join("");
    return element.matches("p, div, li, blockquote, pre, h1, h2, h3, h4, h5, h6")
      ? `\n${content}\n` : content;
  };

  return text(root).split("\n").map(line => line.replace(/[ \t]+/g, " ").trim())
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function copyQuestionText(document: Document, text: string): Promise<void> {
  try {
    const clipboard = document.defaultView?.navigator.clipboard;
    if (!clipboard) throw new Error("Clipboard API unavailable");
    await clipboard.writeText(text);
    new Notice("問題をコピーしました。");
  } catch (error) {
    const textarea = document.createElement("textarea");
    textarea.className = "kokushi-copy-target";
    textarea.value = text;
    textarea.readOnly = true;
    const focus = document.activeElement;
    document.body.append(textarea);
    try {
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(0, text.length);
      // Clipboard API が使えない環境でのみ使用する。
      if (document.execCommand("copy")) {
        new Notice("問題をコピーしました。");
        return;
      }
    } catch (fallbackError) {
      console.error("[Kokushi] Clipboard fallback error", fallbackError);
    } finally {
      textarea.remove();
      if (focus?.instanceOf(HTMLElement)) focus.focus({ preventScroll: true });
    }
    console.error("[Kokushi] Question copy error", error);
    new Notice("問題をコピーできませんでした。");
  }
}
