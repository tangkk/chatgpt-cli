import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
    "repeat with w in windows",
    "repeat with t in tabs of w",
    `if URL of t starts with ${appleString(CHATGPT_URL)} then set targetTab to t`,
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
}

export async function executeChromeJavaScript(source) {
  const encoded = Buffer.from(source, "utf8").toString("base64");
  const wrapper = `eval(new TextDecoder().decode(Uint8Array.from(atob('${encoded}'), c => c.charCodeAt(0))))`;
  return runAppleScript(
    findChatGPTTabLines([`return execute targetTab javascript ${appleString(wrapper)}`]),
  );
}

export async function checkChromeBridge() {
  await ensureChromeChatGPTTab();
  const result = await executeChromeJavaScript(
    "JSON.stringify({title: document.title, readyState: document.readyState})",
  );
  return JSON.parse(result || "{}");
}

export async function chromeListConversations({ limit = 30 } = {}) {
  const result = await executeChromeJavaScript(`
    JSON.stringify((() => {
      const found = new Map();
      for (const link of document.querySelectorAll('a[href^="/c/"], a[href*="chatgpt.com/c/"]')) {
        const match = link.href.match(/\\/c\\/([^/?#]+)/);
        if (!match || found.has(match[1])) continue;
        const title = (link.getAttribute('aria-label') || link.getAttribute('title') || link.textContent || 'Untitled chat')
          .replace(/\\s+/g, ' ').trim();
        found.set(match[1], { id: match[1], title, url: 'https://chatgpt.com/c/' + match[1] });
        if (found.size >= ${Number(limit)}) break;
      }
      return [...found.values()];
    })())
  `);
  return JSON.parse(result || "[]");
}

export async function chromeOpenUrl(url) {
  await runAppleScript(findChatGPTTabLines([`set URL of targetTab to ${appleString(url)}`]));
  await waitForChromePage();
}

export async function chromeOpenConversation(conversation) {
  await chromeOpenUrl(conversation.url);
}

export async function chromeOpenNewConversation() {
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

async function chromeAssistantSnapshot() {
  const result = await executeChromeJavaScript(`
    JSON.stringify((() => {
      const messages = [...document.querySelectorAll('[data-message-author-role="assistant"], article[data-turn="assistant"]')];
      const last = messages.at(-1);
      const stop = document.querySelector('button[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="停止"]');
      return { count: messages.length, text: last?.innerText || '', stop: Boolean(stop) };
    })())
  `);
  return JSON.parse(result || "{}");
}

async function setChromePrompt(prompt) {
  const encodedPrompt = Buffer.from(prompt, "utf8").toString("base64");
  const result = await executeChromeJavaScript(`
    (() => {
      const prompt = new TextDecoder().decode(Uint8Array.from(atob('${encodedPrompt}'), c => c.charCodeAt(0)));
      const candidates = [...document.querySelectorAll('#prompt-textarea, textarea[placeholder], [contenteditable="true"]')];
      const visible = (element) => element.getClientRects().length > 0;
      const composer = candidates.find((element) => element.id === 'prompt-textarea' && visible(element))
        || candidates.find(visible);
      if (!composer) return 'NO_COMPOSER';
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
  if (result !== "OK") throw new Error("Could not find the ChatGPT message composer.");
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

export async function chromeSendMessage(
  prompt,
  { onDelta = () => {}, timeoutMs = 5 * 60_000 } = {},
) {
  const before = await chromeAssistantSnapshot();
  await setChromePrompt(prompt);
  await clickChromeSend();

  const deadline = Date.now() + timeoutMs;
  let emitted = "";
  let lastObserved = "";
  let stableSince = Date.now();
  let started = false;
  let sawStop = false;

  while (Date.now() < deadline) {
    const current = await chromeAssistantSnapshot();
    const isNew = current.count > before.count || current.text !== before.text;
    if (isNew && current.text) started = true;
    if (current.stop) sawStop = true;

    if (started && current.text !== lastObserved) {
      lastObserved = current.text;
      stableSince = Date.now();
    }
    if (started && current.text.startsWith(emitted)) {
      const delta = current.text.slice(emitted.length);
      if (delta) {
        onDelta(delta);
        emitted = current.text;
      }
    }

    if (started && !current.stop && (sawStop || Date.now() - stableSince > 3_000)) {
      if (lastObserved && !lastObserved.startsWith(emitted)) onDelta(`\n${lastObserved}`);
      return lastObserved;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("Timed out waiting for ChatGPT to finish responding.");
}
