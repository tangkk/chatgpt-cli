import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { responseIsFinished } from "./response.js";

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
  await activateChromeChatGPTTab();
  await runAppleScript(findChatGPTTabLines([`set URL of targetTab to ${appleString(url)}`]));
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

export async function chromeAssistantSnapshot() {
  const result = await executeChromeJavaScript(`
    JSON.stringify((() => {
      const primary = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
      const messages = primary.length
        ? primary
        : [...document.querySelectorAll('article[data-turn="assistant"]')];
      const last = messages.at(-1);
      const visible = (element) => Boolean(element && element.getClientRects().length > 0);
      const stop = [...document.querySelectorAll([
        'button[data-testid="stop-button"]',
        'button[data-testid="composer-submit-button"]',
        'button[aria-label*="Stop" i]',
        'button[aria-label*="停止"]',
      ].join(','))].some(visible);

      let complete = false;
      for (let node = last; node && node !== document.body; node = node.parentElement) {
        const assistantCount = node.querySelectorAll('[data-message-author-role="assistant"]').length;
        if (assistantCount > 1) break;
        const copy = node.querySelector('button[data-testid="copy-turn-action-button"]');
        if (copy) {
          complete = true;
          break;
        }
      }

      const composer = [...document.querySelectorAll('#prompt-textarea, textarea[placeholder], [contenteditable="true"]')]
        .find(visible);
      const composerScope = composer?.closest('form') || composer?.parentElement?.parentElement?.parentElement;
      const idleComposer = Boolean(composerScope && [...composerScope.querySelectorAll([
        'button[aria-label*="Start Voice" i]',
        'button[aria-label*="Start dictation" i]',
        'button[aria-label*="开始语音"]',
        'button[aria-label*="开始听写"]',
      ].join(','))].some(visible));
      const turn = last?.closest('[data-turn="assistant"], [data-testid^="conversation-turn-"]');
      const writing = Boolean(turn?.querySelector('[data-writing-block]'));

      const body = (last?.innerText || '').trim();
      const links = last ? [...last.querySelectorAll('a[href]')].map((anchor) => ({
        label: (anchor.innerText || anchor.getAttribute('aria-label') || anchor.title || '').replace(/\\s+/g, ' ').trim(),
        href: anchor.href,
      })).filter(({ href }) => {
        try {
          const url = new URL(href);
          return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== 'chatgpt.com';
        } catch {
          return false;
        }
      }) : [];
      const uniqueLinks = [...new Map(links.map((link) => [link.href, link])).values()];
      const missingLinks = uniqueLinks.filter((link) => !body.includes(link.href));
      const linkText = missingLinks.length
        ? '\\n\\nLinks:\\n' + missingLinks.map((link) => '- ' + (link.label ? link.label + ': ' : '') + link.href).join('\\n')
        : '';
      return {
        count: messages.length,
        text: body + linkText,
        stop,
        complete,
        idleComposer,
        writing,
        visible: document.visibilityState === 'visible',
      };
    })())
  `);
  return JSON.parse(result || "{}");
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

export async function chromeSendMessage(
  prompt,
  { onDelta = () => {}, timeoutMs = 5 * 60_000 } = {},
) {
  await activateChromeChatGPTTab();
  const before = await chromeAssistantSnapshot();
  await setChromePrompt(prompt);
  await clickChromeSend();

  const deadline = Date.now() + timeoutMs;
  let emitted = "";
  let lastObserved = "";
  let started = false;
  let stableSince = Date.now();

  while (Date.now() < deadline) {
    const current = await chromeAssistantSnapshot();
    if (!current.visible) {
      await activateChromeChatGPTTab();
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    const isNew = current.count > before.count || current.text !== before.text;
    if (isNew && current.text) started = true;

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

    if (responseIsFinished({
      started,
      complete: current.complete,
      stop: current.stop,
      idle: current.idleComposer,
      writing: current.writing,
      visible: current.visible,
      quietForMs: Date.now() - stableSince,
    })) {
      if (lastObserved && !lastObserved.startsWith(emitted)) {
        onDelta(`${emitted ? "\n" : ""}${lastObserved}`);
      }
      return lastObserved;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("Timed out waiting for ChatGPT to finish responding.");
}
