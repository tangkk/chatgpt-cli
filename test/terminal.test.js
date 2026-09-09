import assert from "node:assert/strict";
import test from "node:test";
import { printChatHistory, printConversations } from "../src/terminal.js";
import { sessionIsAuthenticated } from "../src/chatgpt.js";
import { cdpChromeArgs, ioregShowsLocked } from "../src/browser.js";
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

test("dedicated Chrome exposes CDP without Playwright automation flags", () => {
  const args = cdpChromeArgs({ headed: true, port: 19_876 }).join(" ");
  assert.match(args, /remote-debugging-port=19876/);
  assert.doesNotMatch(args, /enable-automation/i);
  assert.doesNotMatch(args, /no-sandbox/i);
  assert.doesNotMatch(args, /headless/i);
});

test("background Chrome disables rendering throttles", () => {
  const args = cdpChromeArgs({
    headed: false,
    port: 19_876,
    userAgent: "Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36",
  }).join(" ");
  assert.match(args, /headless=new/);
  assert.doesNotMatch(args, /HeadlessChrome/);
  assert.match(args, /disable-background-timer-throttling/);
  assert.match(args, /disable-renderer-backgrounding/);
  assert.match(args, /disable-backgrounding-occluded-windows/);
});

test("macOS lock state is recognized from ioreg output", () => {
  assert.equal(ioregShowsLocked('"CGSSessionScreenIsLocked" = Yes'), true);
  assert.equal(ioregShowsLocked('"CGSSessionOnConsoleKey" = Yes'), false);
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

test("a completed hidden response finishes after its text is stable", () => {
  assert.equal(
    responseIsFinished({
      started: true,
      complete: true,
      stop: false,
      visible: false,
      quietForMs: 2_999,
    }),
    false,
  );
  assert.equal(
    responseIsFinished({
      started: true,
      complete: true,
      stop: false,
      visible: false,
      quietForMs: 3_000,
    }),
    true,
  );
});

test("a hidden idle composer uses a longer completion fallback", () => {
  assert.equal(
    responseIsFinished({
      started: true,
      complete: false,
      stop: false,
      idle: true,
      visible: false,
      quietForMs: 59_999,
    }),
    false,
  );
  assert.equal(
    responseIsFinished({
      started: true,
      complete: false,
      stop: false,
      idle: true,
      visible: false,
      quietForMs: 60_000,
    }),
    true,
  );
});
