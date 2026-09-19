import assert from "node:assert/strict";
import test from "node:test";
import { replyTimeoutMs, waitForReply } from "../src/response.js";

const done = { complete: true, stop: false, visible: true };

// Serves scripted page snapshots; the final read (`{ html: true }`) returns `html`.
function fakePage(frames, html) {
  const queue = [...frames];
  const calls = [];
  const snapshot = async (options) => {
    calls.push(options);
    if (options?.html) return { ...frames.at(-1), html };
    return queue.length > 1 ? queue.shift() : queue[0];
  };
  return { snapshot, calls };
}

test("waitForReply returns the finished reply as markdown", async () => {
  const page = fakePage([
    { count: 1, text: "Par", stop: true },
    { count: 1, text: "Paris is", stop: true },
    { count: 1, text: "Paris is the capital.", ...done },
  ], "<h2>Paris</h2><ul><li>capital</li></ul>");

  const reply = await waitForReply({ snapshot: page.snapshot, before: { count: 0, text: "" }, pollMs: 0 });

  assert.equal(reply, "## Paris\n\n- capital");
  // HTML is only requested once, for the final read.
  assert.equal(page.calls.filter((options) => options?.html).length, 1);
});

test("waitForReply ignores the previous reply until a new one starts", async () => {
  const page = fakePage([
    { count: 1, text: "old answer", ...done },
    { count: 2, text: "new", stop: true },
    { count: 2, text: "new answer", ...done },
  ], "<p>new answer</p>");

  const reply = await waitForReply({ snapshot: page.snapshot, before: { count: 1, text: "old answer" }, pollMs: 0 });

  assert.equal(reply, "new answer");
});

test("waitForReply falls back to plain text when there is no HTML", async () => {
  const page = fakePage([{ count: 1, text: "plain text", ...done }], "");
  const reply = await waitForReply({ snapshot: page.snapshot, before: { count: 0, text: "" }, pollMs: 0 });
  assert.equal(reply, "plain text");
});

test("waitForReply times out when the reply never finishes", async () => {
  await assert.rejects(
    waitForReply({
      before: { count: 0, text: "" },
      snapshot: async () => ({ count: 1, text: "partial", stop: true }),
      timeoutMs: 50,
      pollMs: 5,
    }),
    /Timed out/,
  );
});

test("waitForReply survives a few failed reads while the reply is still being written", async () => {
  let calls = 0;
  const frames = [
    { count: 1, text: "Par", stop: true },
    "boom",
    "boom",
    { count: 1, text: "Paris.", complete: true, stop: false, visible: true },
  ];
  const snapshot = async (options) => {
    if (options?.html) return { html: "<p>Paris.</p>", text: "Paris." };
    const frame = frames[Math.min(calls++, frames.length - 1)];
    if (frame === "boom") throw new Error("osascript timed out");
    return frame;
  };
  const reply = await waitForReply({ snapshot, before: { count: 0, text: "" }, pollMs: 0, retryMs: 0 });
  assert.equal(reply, "Paris.");
});

test("waitForReply gives up after repeated failed reads", async () => {
  await assert.rejects(
    waitForReply({
      before: { count: 0, text: "" },
      snapshot: async () => { throw new Error("tab is gone"); },
      pollMs: 0,
      retryMs: 0,
      maxConsecutiveFailures: 3,
    }),
    /tab is gone/,
  );
});

test("waitForReply falls back to the plain text if the formatted read fails", async () => {
  let reads = 0;
  const snapshot = async (options) => {
    if (options?.html) throw new Error("page busy");
    reads += 1;
    return { count: 1, text: "plain answer", complete: true, stop: false, visible: true };
  };
  const reply = await waitForReply({ snapshot, before: { count: 0, text: "" }, pollMs: 0 });
  assert.equal(reply, "plain answer");
  assert.ok(reads >= 1);
});

test("waitForReply treats a new assistant block as started even when it has no text", async () => {
  const frames = [
    { count: 2, text: "", stop: true },
    { count: 2, text: "", complete: true, stop: false, visible: true },
  ];
  let i = 0;
  const snapshot = async (options) => (options?.html ? { html: "", text: "" } : frames[Math.min(i++, frames.length - 1)]);
  const reply = await waitForReply({ snapshot, before: { count: 1, text: "old" }, pollMs: 0 });
  assert.match(reply, /no text/);
});

test("replyTimeoutMs reads CHATGPT_CLI_TIMEOUT_SECONDS and ignores bad values", () => {
  assert.equal(replyTimeoutMs({}), 300_000);
  assert.equal(replyTimeoutMs({ CHATGPT_CLI_TIMEOUT_SECONDS: "900" }), 900_000);
  assert.equal(replyTimeoutMs({ CHATGPT_CLI_TIMEOUT_SECONDS: "abc" }), 300_000);
  assert.equal(replyTimeoutMs({ CHATGPT_CLI_TIMEOUT_SECONDS: "-5" }), 300_000);
});
