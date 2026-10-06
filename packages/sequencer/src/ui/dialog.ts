// In-app confirmations and prompts. Browsers may block window.confirm and prompt in an
// embedded frame (cross-origin or sandboxed), which would make actions behind them
// silently do nothing, so the app asks with its own modal <dialog> instead.

import { h } from "./dom";

const ACCEPT = "accept";

let dialogs = 0;

/**
 * Shows a modal dialog and resolves with how it closed: accepted, or cancelled. The
 * message element names the dialog for assistive technology.
 */
function ask(message: HTMLElement, accept: string, focus?: HTMLElement): Promise<boolean> {
  return new Promise((resolve) => {
    message.id = `dialog-message-${++dialogs}`;
    const cancelButton = h("button", { type: "button", text: "cancel" });
    const acceptButton = h("button", { type: "button", class: "dialog-accept", text: accept });
    const dialog = h("dialog", { class: "dialog", "aria-labelledby": message.id }, [
      message,
      h("div", { class: "dialog-actions" }, [cancelButton, acceptButton]),
    ]);
    cancelButton.addEventListener("click", () => dialog.close());
    acceptButton.addEventListener("click", () => dialog.close(ACCEPT));
    // Escape cancels: the dialog closes with an empty return value.
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(dialog.returnValue === ACCEPT);
    });
    document.body.append(dialog);
    dialog.showModal();
    (focus ?? acceptButton).focus();
  });
}

/** Asks the user to confirm an action; resolves true if they accept. */
export function confirmDialog(message: string, accept = "ok"): Promise<boolean> {
  return ask(h("p", { class: "dialog-message", text: message }), accept);
}

/** Asks the user for text; resolves with it, or undefined if they cancel. */
export async function promptDialog(
  message: string,
  value: string,
  accept = "ok",
): Promise<string | undefined> {
  const input = h("input", {
    class: "dialog-input",
    value,
    spellcheck: false,
    "aria-label": message,
  });
  const label = h("label", { class: "dialog-message" }, [message, input]);
  const accepted = ask(label, accept, input);
  input.select();
  // Enter accepts, as it would in a form. Closing returns focus to the button that
  // opened the dialog, so the key's default action must not reach it and reopen it.
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    input.closest("dialog")?.close(ACCEPT);
  });
  return (await accepted) ? input.value : undefined;
}
