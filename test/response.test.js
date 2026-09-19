import assert from "node:assert/strict";
import test from "node:test";
import { waitForReply } from "../src/response.js";

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
