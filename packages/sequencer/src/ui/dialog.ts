// In-app confirmations and prompts. The app runs inside host pages, where window.confirm
// and prompt would block the whole page (and a cross-origin frame may refuse them), so
// it asks with its own <dialog>. A dialog opens inside the app's root, over the app
// only: the app goes inert behind it while the rest of the host page stays usable.

import { h } from "./dom";

const ACCEPT = "accept";

let dialogs = 0;

/** Tab and Shift+Tab cycle through the dialog's own controls. */
function keepFocus(event: KeyboardEvent, layer: HTMLElement): void {
  const controls = [...layer.querySelectorAll<HTMLElement>("button, input")];
  const first = controls[0];
  const last = controls.at(-1);
  const active = (layer.getRootNode() as Document | ShadowRoot).activeElement;
  if (event.shiftKey && (active === first || !controls.includes(active as HTMLElement))) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first?.focus();
  }
}

export class Dialogs {
  private open = 0;

  /**
   * Dialogs open in `root`, over `content`, which goes inert while one is open. They
   * cancel when `signal` aborts. `onChange` hears of each dialog opening and closing.
   */
  constructor(
    private readonly root: Document | ShadowRoot,
    private readonly content: HTMLElement,
    private readonly signal: AbortSignal,
    private readonly onChange: () => void = () => {},
  ) {}

  /** A dialog is open, and the app behind it inert. */
  get isOpen(): boolean {
    return this.open > 0;
  }

  /**
   * Shows a dialog and resolves with how it closed: accepted, or cancelled. The message
   * element names the dialog for assistive technology.
   */
  private ask(message: HTMLElement, accept: string, focus?: HTMLElement): Promise<boolean> {
    // An app that has gone asks nothing: the answer is no.
    if (this.signal.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      message.id = `dialog-message-${++dialogs}`;
      const cancelButton = h("button", { type: "button", text: "cancel" });
      const acceptButton = h("button", { type: "button", class: "dialog-accept", text: accept });
      const dialog = h(
        "dialog",
        // Not aria-modal: only the app behind it goes inert, and the host page stays usable.
        { class: "dialog", "aria-labelledby": message.id },
        [message, h("div", { class: "dialog-actions" }, [cancelButton, acceptButton])],
      );
      // The layer covers the app; a press on it keeps focus in the dialog.
      const layer = h("div", { class: "dialog-layer", tabindex: -1 }, [dialog]);
      layer.addEventListener("mousedown", (event) => {
        if (event.target === layer) event.preventDefault();
      });
      const opener = this.root.activeElement;
      const cancel = () => dialog.close();
      cancelButton.addEventListener("click", cancel);
      acceptButton.addEventListener("click", () => dialog.close(ACCEPT));
      layer.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          // Escape cancels the dialog, and nothing in the host page.
          event.preventDefault();
          event.stopPropagation();
          cancel();
        } else if (event.key === "Tab") {
          keepFocus(event, layer);
        }
      });
      this.signal.addEventListener("abort", cancel, { once: true });
      dialog.addEventListener("close", () => {
        this.signal.removeEventListener("abort", cancel);
        layer.remove();
        this.open -= 1;
        if (this.open === 0) this.content.inert = false;
        // As a modal dialog would, return focus to what opened it.
        if (opener instanceof HTMLElement && this.content.contains(opener)) {
          opener.focus({ preventScroll: true });
        }
        this.onChange();
        resolve(dialog.returnValue === ACCEPT);
      });
      this.open += 1;
      this.content.inert = true;
      this.root.append(layer);
      dialog.show();
      (focus ?? acceptButton).focus();
      this.onChange();
    });
  }

  /** Asks the user to confirm an action; resolves true if they accept. */
  confirm(message: string, accept = "ok"): Promise<boolean> {
    return this.ask(h("p", { class: "dialog-message", text: message }), accept);
  }

  /** Asks the user for text; resolves with it, or undefined if they cancel. */
  async prompt(message: string, value: string, accept = "ok"): Promise<string | undefined> {
    const input = h("input", {
      class: "dialog-input",
      value,
      spellcheck: false,
      "aria-label": message,
    });
    const label = h("label", { class: "dialog-message" }, [message, input]);
    const accepted = this.ask(label, accept, input);
    input.select();
    // Enter accepts, as it would in a form, without reaching the button focus returns to.
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      input.closest("dialog")?.close(ACCEPT);
    });
    return (await accepted) ? input.value : undefined;
  }
}
