import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { waitForReply } from "./response.js";
import { parseSnapshot, readAssistantState } from "./snapshot.js";

const execFileAsync = promisify(execFile);
const CHATGPT_URL = "https://chatgpt.com/";

function appleString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function runAppleScript(lines) {
  try {
    const args = lines.flatMap((line) => ["-e", line]);
    const { stdout } = await execFileAsync("osascript", args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
    });
    return stdout.trim();
  } catch (error) {
    const detail = `${error.stderr || ""}\n${error.message || ""}`;
    if (detail.includes("Executing JavaScript through AppleScript is turned off")) {
      throw new Error(
        "Chrome JavaScript automation is disabled. In Chrome, enable View → Developer → Allow JavaScript from Apple Events, then retry.",
      );
    }
    throw error;
  }
}

function findChatGPTTabLines(body) {
  return [
    'tell application "Google Chrome"',
    "set targetTab to missing value",
    "set targetWindow to missing value",
    "set targetTabIndex to 0",
    "repeat with w in windows",
    "repeat with tabIndex from 1 to (count tabs of w)",
    "set t to tab tabIndex of w",
    `if URL of t starts with ${appleString(CHATGPT_URL)} then`,
    "set targetTab to t",
    "set targetWindow to w",
    "set targetTabIndex to tabIndex",
    "end if",
    "end repeat",
    "end repeat",
    'if targetTab is missing value then error "NO_CHATGPT_TAB"',
    ...body,
    "end tell",
  ];
}

export async function ensureChromeChatGPTTab() {
  await runAppleScript([
    'tell application "Google Chrome"',
    "if (count of windows) is 0 then make new window",
    "set targetTab to missing value",
    "repeat with w in windows",
    "repeat with t in tabs of w",
    `if URL of t starts with ${appleString(CHATGPT_URL)} then set targetTab to t`,
    "end repeat",
    "end repeat",
    `if targetTab is missing value then set targetTab to make new tab at end of tabs of front window with properties {URL:${appleString(CHATGPT_URL)}}`,
    "end tell",
  ]);
  await waitForChromePage();
}

export async function executeChromeJavaScript(source) {
  const encoded = Buffer.from(source, "utf8").toString("base64");
  const wrapper = `eval(new TextDecoder().decode(Uint8Array.from(atob('${encoded}'), c => c.charCodeAt(0))))`;
  return runAppleScript(
    findChatGPTTabLines([`return execute targetTab javascript ${appleString(wrapper)}`]),
  );
}

export async function activateChromeChatGPTTab() {
  await runAppleScript(
    findChatGPTTabLines(["set active tab index of targetWindow to targetTabIndex"]),
  );
}

export async function checkChromeBridge() {
  await ensureChromeChatGPTTab();
  const result = await executeChromeJavaScript(
    "JSON.stringify({title: document.title, readyState: document.readyState})",
  );
  return JSON.parse(result || "{}");
}

export async function chromeListConversations(
  { limit = 30, timeoutMs = 12_000 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let conversations = [];

  while (Date.now() < deadline) {
    const result = await executeChromeJavaScript(`
      JSON.stringify((() => {
        const conversationSelector = 'a[href^="/c/"], a[href*="chatgpt.com/c/"]';
        const found = new Map();
        for (const link of document.querySelectorAll(conversationSelector)) {
          const match = link.href.match(/\\/c\\/([^/?#]+)/);
          if (!match || found.has(match[1])) continue;
          const title = (link.getAttribute('aria-label') || link.getAttribute('title') || link.textContent || 'Untitled chat')
            .replace(/\\s+/g, ' ').trim();
          found.set(match[1], { id: match[1], title, url: 'https://chatgpt.com/c/' + match[1] });
          if (found.size >= ${Number(limit)}) break;
        }

        if (!found.size) {
          const openSidebar = [...document.querySelectorAll([
            'button[data-testid="open-sidebar-button"]',
            'button[aria-label*="Open sidebar" i]',
            'button[aria-label*="打开侧边栏"]',
          ].join(','))].find((button) => button.getClientRects().length > 0);
          if (openSidebar) openSidebar.click();
        }
        return [...found.values()];
      })())
    `);
    conversations = JSON.parse(result || "[]");
    if (conversations.length) return conversations;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return conversations;
}

export async function chromeOpenUrl(url) {
  await activateChromeChatGPTTab();
  const encodedUrl = Buffer.from(url, "utf8").toString("base64");
  await executeChromeJavaScript(`
    (() => {
      const url = new TextDecoder().decode(Uint8Array.from(atob('${encodedUrl}'), c => c.charCodeAt(0)));
      location.assign(url);
      return 'NAVIGATING';
    })()
  `);
  await waitForChromePage();
}

export async function chromeOpenConversation(conversation) {
  await activateChromeChatGPTTab();
  const targetPath = new URL(conversation.url).pathname;
  const encodedPath = Buffer.from(targetPath, "utf8").toString("base64");
  const result = await executeChromeJavaScript(`
    (() => {
      const targetPath = new TextDecoder().decode(Uint8Array.from(atob('${encodedPath}'), c => c.charCodeAt(0)));
      if (location.pathname === targetPath) return 'CURRENT';
      const link = [...document.querySelectorAll('a[href^="/c/"], a[href*="chatgpt.com/c/"]')]
        .find((candidate) => new URL(candidate.href, location.origin).pathname === targetPath);
      if (!link) return 'FALLBACK';
      link.click();
      return 'CLICKED';
    })()
  `);

  if (result === "CURRENT") return;
  if (result === "CLICKED") {
    await waitForChromePath(targetPath);
    return;
  }
  await chromeOpenUrl(conversation.url);
}

export async function chromeOpenNewConversation() {
  await activateChromeChatGPTTab();
  const result = await executeChromeJavaScript(`
    (() => {
      if (location.pathname === '/') return 'CURRENT';
      const selectors = [
        'a[data-testid="create-new-chat-button"]',
        'button[data-testid="create-new-chat-button"]',
        'a[aria-label*="New chat" i]',
        'button[aria-label*="New chat" i]',
        'a[aria-label*="新建对话"]',
        'button[aria-label*="新建对话"]',
        'a[href="/"]',
      ].join(',');
      const control = [...document.querySelectorAll(selectors)]
        .find((element) => element.getClientRects().length > 0);
      if (!control) return 'FALLBACK';
      control.click();
      return 'CLICKED';
    })()
  `);

  if (result === "CURRENT") return;
  if (result === "CLICKED") {
    await waitForChromePath("/");
    return;
  }
  await chromeOpenUrl(CHATGPT_URL);
}

export async function chromeRecentMessages(
  { limit = 6, maxChars = 500, timeoutMs = 8_000 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await executeChromeJavaScript(`
      JSON.stringify((() => {
        const primary = [...document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]')];
        const nodes = primary.length
          ? primary
          : [...document.querySelectorAll('article[data-turn="user"], article[data-turn="assistant"]')];
        return nodes.slice(-${Number(limit)}).map((node) => {
          const role = node.getAttribute('data-message-author-role') || node.getAttribute('data-turn') || 'assistant';
          const text = (node.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
          return {
            role,
            text: text.length > ${Number(maxChars)} ? text.slice(0, ${Number(maxChars)}) + '…' : text,
          };
        }).filter((message) => message.text);
      })())
    `);
    const messages = JSON.parse(result || "[]");
    if (messages.length) return messages;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return [];
}

async function waitForChromePage({ timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await executeChromeJavaScript("document.readyState").catch(() => "");
    if (ready === "complete" || ready === "interactive") {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the ChatGPT tab to load.");
}

async function waitForChromePath(pathname, { timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await executeChromeJavaScript(`
      JSON.stringify({
        path: location.pathname,
        composer: Boolean([...document.querySelectorAll('#prompt-textarea, textarea[placeholder], [contenteditable], [role="textbox"]')]
          .find((element) => element.getClientRects().length > 0)),
      })
    `).then((value) => JSON.parse(value || "{}"));
    if (state.path === pathname && state.composer) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Timed out waiting for ChatGPT to open the selected conversation.");
}

export async function chromeAssistantSnapshot({ html = false } = {}) {
  const result = await executeChromeJavaScript(
    `JSON.stringify((${readAssistantState.toString()})(${JSON.stringify({ html })}))`,
  );
  try {
    return parseSnapshot(JSON.parse(result || "{}"));
  } catch {
    // Chrome answers "missing value" when the page script throws or is busy.
    throw new Error(`The ChatGPT tab did not return a readable snapshot (${JSON.stringify(result.slice(0, 40))}).`);
  }
}

async function setChromePrompt(prompt, { timeoutMs = 20_000 } = {}) {
  const encodedPrompt = Buffer.from(prompt, "utf8").toString("base64");
  const deadline = Date.now() + timeoutMs;
  let lastResult = "NO_COMPOSER";

  while (Date.now() < deadline) {
    lastResult = await executeChromeJavaScript(`
      (() => {
        const prompt = new TextDecoder().decode(Uint8Array.from(atob('${encodedPrompt}'), c => c.charCodeAt(0)));
        const candidates = [...document.querySelectorAll('#prompt-textarea, textarea[placeholder], [contenteditable], [role="textbox"]')];
        const visible = (element) => element.getClientRects().length > 0;
        const composer = candidates.find((element) => element.id === 'prompt-textarea' && visible(element))
          || candidates.find((element) => visible(element) && element.getAttribute('role') === 'textbox')
          || candidates.find(visible);
        if (!composer) return 'NO_COMPOSER';
        if (composer.getAttribute('aria-disabled') === 'true' || composer.getAttribute('contenteditable') === 'false') {
          return 'NOT_READY';
        }
        composer.focus();
        if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), 'value')?.set;
          if (setter) setter.call(composer, prompt); else composer.value = prompt;
          composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
        } else {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(composer);
          selection.removeAllRanges();
          selection.addRange(range);
          const inserted = document.execCommand('insertText', false, prompt);
          if (!inserted) {
            composer.textContent = prompt;
            composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
          }
        }
        composer.dispatchEvent(new Event('change', { bubbles: true }));
        return 'OK';
      })()
    `);
    if (lastResult === "OK") return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const detail = lastResult === "NOT_READY"
    ? "The ChatGPT message composer stayed disabled."
    : "The ChatGPT message composer did not appear.";
  throw new Error(`${detail} Wait for the conversation to finish loading and try again.`);
}

async function clickChromeSend() {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const result = await executeChromeJavaScript(`
      (() => {
        const selector = [
          'button[data-testid="send-button"]',
          'button[data-testid="composer-submit-button"]',
          'button[data-testid*="send"]',
          'button[aria-label*="Send"]',
          'button[aria-label*="发送"]',
          'form button[type="submit"]',
        ].join(',');
        const button = [...document.querySelectorAll(selector)]
          .find((candidate) => !candidate.disabled && candidate.getClientRects().length > 0);
        if (!button) return 'WAIT';
        button.click();
        return 'OK';
      })()
    `);
    if (result === "OK") return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("ChatGPT's send button did not become available.");
}

export async function chromeSendMessage(prompt, { timeoutMs = 5 * 60_000 } = {}) {
  await activateChromeChatGPTTab();
  const before = await chromeAssistantSnapshot();
  await setChromePrompt(prompt);
  await clickChromeSend();

  let lastActivationAttempt = 0;
  return waitForReply({
    snapshot: chromeAssistantSnapshot,
    before,
    timeoutMs,
    pollMs: 120,
    onPoll: async (current) => {
      if (!current.visible && Date.now() - lastActivationAttempt >= 2_000) {
        lastActivationAttempt = Date.now();
        await activateChromeChatGPTTab().catch(() => {});
      }
    },
  });
}
