import assert from "node:assert/strict";
import test from "node:test";
import { printChatHistory, printConversations } from "../src/terminal.js";
import { sessionIsAuthenticated } from "../src/chatgpt.js";
import { ignoredPlaywrightArgs, loginChromeArgs } from "../src/browser.js";
import { responseIsFinished } from "../src/response.js";

test("printConversations handles an empty list", () => {
  const original = console.log;
  const output = [];
  console.log = (line) => output.push(line);
  try {
    printConversations([]);
  } finally {
    console.log = original;
  }
  assert.match(output.join("\n"), /No recent conversations/);
});

test("printChatHistory labels recent user and assistant messages", () => {
  const original = console.log;
  const output = [];
  console.log = (line) => output.push(line);
  try {
    printChatHistory([
      { role: "user", text: "Earlier question" },
      { role: "assistant", text: "Earlier answer" },
    ]);
  } finally {
    console.log = original;
  }
  assert.match(output.join("\n"), /You > Earlier question/);
  assert.match(output.join("\n"), /ChatGPT > Earlier answer/);
});

test("sessionIsAuthenticated rejects a guest session", () => {
  assert.equal(sessionIsAuthenticated(null), false);
  assert.equal(sessionIsAuthenticated({}), false);
});

test("sessionIsAuthenticated accepts authenticated session shapes", () => {
  assert.equal(sessionIsAuthenticated({ user: { id: "user-1" } }), true);
  assert.equal(sessionIsAuthenticated({ accessToken: "redacted" }), true);
});

test("manual login Chrome has no automation or debugging flags", () => {
  const args = loginChromeArgs().join(" ");
  assert.doesNotMatch(args, /automation/i);
  assert.doesNotMatch(args, /remote-debugging/i);
  assert.match(args, /chatgpt\.com/);
});

test("Playwright does not replace the macOS Chrome keychain", () => {
  assert.deepEqual(ignoredPlaywrightArgs(), [
    "--use-mock-keychain",
    "--password-store=basic",
  ]);
});

test("a web-search pause is not treated as a completed response", () => {
  assert.equal(
    responseIsFinished({
      started: true,
      complete: false,
      stop: false,
      idle: true,
      quietForMs: 10_000,
    }),
    false,
  );
});

test("a response finishes only after ChatGPT exposes completion controls", () => {
  assert.equal(
    responseIsFinished({ started: true, complete: true, stop: false }),
    true,
  );
  assert.equal(
    responseIsFinished({ started: true, complete: true, stop: true }),
    false,
  );
});

test("an idle composer is only a long-quiet fallback", () => {
  assert.equal(
    responseIsFinished({
      started: true,
      complete: false,
      stop: false,
      idle: true,
      quietForMs: 30_000,
    }),
    true,
  );
  assert.equal(
    responseIsFinished({
      started: true,
      complete: false,
      stop: false,
      idle: true,
      writing: true,
      quietForMs: 60_000,
    }),
    false,
  );
});

test("a hidden ChatGPT tab never finishes a response", () => {
  assert.equal(
    responseIsFinished({
      started: true,
      complete: true,
      stop: false,
      visible: false,
      quietForMs: 60_000,
    }),
    false,
  );
});
