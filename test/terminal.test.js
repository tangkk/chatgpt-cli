import assert from "node:assert/strict";
import test from "node:test";
import { printChatHistory, printConversations } from "../src/terminal.js";
import { sessionIsAuthenticated } from "../src/chatgpt.js";
import { ignoredPlaywrightArgs, loginChromeArgs } from "../src/browser.js";

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
