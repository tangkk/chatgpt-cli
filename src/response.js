import { htmlToMarkdown } from "./markdown.js";

export function responseIsFinished({
  started,
  complete,
  stop,
  idle = false,
  writing = false,
  visible = true,
  quietForMs = 0,
  fallbackMs = 30_000,
  hiddenCompleteGraceMs = 3_000,
  hiddenFallbackMs = 60_000,
}) {
  if (!started || stop || writing) return false;
  if (complete) return visible || quietForMs >= hiddenCompleteGraceMs;
  const requiredFallbackMs = visible ? fallbackMs : hiddenFallbackMs;
  return Boolean(idle && quietForMs >= requiredFallbackMs);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Waits for ChatGPT to finish the reply, reads it once, and returns it as
// markdown. `snapshot({ html })` reads the page; the HTML is requested only for
// the final read.
export async function waitForReply({
  snapshot,
  before,
  onPoll,
  timeoutMs = 5 * 60_000,
  pollMs = 100,
}) {
  const deadline = Date.now() + timeoutMs;
  let started = false;
  let lastText = "";
  let stableSince = Date.now();

  while (Date.now() < deadline) {
    const current = await snapshot();
    if (onPoll) await onPoll(current);

    const isNew = current.count > before.count || current.text !== before.text;
    if (isNew && current.text) started = true;
    if (started && current.text !== lastText) {
      lastText = current.text;
      stableSince = Date.now();
    }

    if (responseIsFinished({
      started,
      complete: current.complete,
      stop: current.stop,
      idle: current.idleComposer,
      writing: current.writing,
      visible: current.visible,
      quietForMs: Date.now() - stableSince,
    })) {
      const final = await snapshot({ html: true });
      return htmlToMarkdown(final.html) || final.text || current.text;
    }

    await sleep(pollMs);
  }

  throw new Error("Timed out waiting for ChatGPT to finish responding.");
}
