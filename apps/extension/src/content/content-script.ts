import { isReadOnlyContentCommand } from "../shared/types";
import { FacebookContentRunner } from "./facebook-runner";

const CONTENT_READY_KEY = "__listeningSocialContentReady";
const contentScope = globalThis as typeof globalThis & Record<string, unknown>;

if (contentScope[CONTENT_READY_KEY] !== true) {
  contentScope[CONTENT_READY_KEY] = true;
  const runner = new FacebookContentRunner(document, window);

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !isReadOnlyContentCommand(message)) {
      return false;
    }

    void runner
      .handle(message)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error:
            error instanceof Error ? error.message.slice(0, 300) : "Content error"
        })
      );
    return true;
  });
}
