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

// Replies can take a while (long answers, web search, reasoning). The wait is
// capped at 5 minutes unless CHATGPT_CLI_TIMEOUT_SECONDS says otherwise.
export function replyTimeoutMs(env = process.env) {
  const seconds = Number(env.CHATGPT_CLI_TIMEOUT_SECONDS);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 5 * 60_000;
}

const EMPTY_REPLY = "(ChatGPT's reply has no text. It may be an image, file or other content; open ChatGPT to see it.)";

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
  timeoutMs = replyTimeoutMs(),
  pollMs = 100,
  retryMs = 500,
  maxConsecutiveFailures = 6,
}) {
  const deadline = Date.now() + timeoutMs;
  let started = false;
  let lastText = "";
  let stableSince = Date.now();
  let failures = 0;

  while (Date.now() < deadline) {
    // A single failed read (Chrome busy, page navigating) must not lose a reply
    // that ChatGPT is still writing; give up only after repeated failures.
    let current;
    try {
      current = await snapshot();
      if (onPoll) await onPoll(current);
      failures = 0;
    } catch (error) {
      failures += 1;
      if (failures >= maxConsecutiveFailures) throw error;
      await sleep(retryMs);
      continue;
    }

    // A new assistant block means the reply has begun even if it has no text yet
    // (or never gets any, e.g. an image).
    const newBlock = current.count > before.count;
    if (newBlock || (current.text !== before.text && current.text)) started = true;
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
      // If the formatted read fails, the plain text already seen is still a reply.
      const final = await snapshot({ html: true }).catch(() => null);
      return htmlToMarkdown(final?.html) || final?.text || current.text || EMPTY_REPLY;
    }

    await sleep(pollMs);
  }

  throw new Error("Timed out waiting for ChatGPT to finish responding.");
}
