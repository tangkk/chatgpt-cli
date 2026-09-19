import { waitForReply } from "./response.js";
import { parseSnapshot, readAssistantState } from "./snapshot.js";

const CHATGPT_URL = "https://chatgpt.com/";

const SELECTORS = {
  composer: [
    "#prompt-textarea",
    "textarea[placeholder]",
    '[contenteditable="true"][data-virtualkeyboard="true"]',
  ],
  conversationLink: 'a[href^="/c/"], a[href*="chatgpt.com/c/"]',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function openChatGPT(page) {
  await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1_000);
}

export async function findComposer(page) {
  for (const selector of SELECTORS.composer) {
    const candidate = page.locator(selector).first();
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

export function sessionIsAuthenticated(session) {
  return Boolean(session && (session.user || session.accessToken));
}

export async function isLoggedIn(page) {
  if (!page.url().startsWith("https://chatgpt.com/")) return false;

  return page
    .evaluate(async () => {
      const response = await fetch("/api/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) return false;
      const session = await response.json();
      return Boolean(session && (session.user || session.accessToken));
    })
    .catch(() => false);
}

export async function waitForLogin(page, { timeoutMs = 10 * 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isLoggedIn(page)) return;
    await sleep(1_000);
  }
  throw new Error("Timed out waiting for ChatGPT login.");
}

export async function requireLogin(page) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await isLoggedIn(page)) return;
    await sleep(500);
  }
  throw new Error(
    "Not signed in to ChatGPT. Run `chatgpt-web login` first. If headless mode is being challenged, retry with --headed.",
  );
}

async function openSidebar(page) {
  const buttons = [
    'button[data-testid="open-sidebar-button"]',
    'button[aria-label*="sidebar" i]',
    'button[aria-label*="侧边栏"]',
  ];
  for (const selector of buttons) {
    const button = page.locator(selector).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click().catch(() => {});
      await page.waitForTimeout(400);
      return;
    }
  }
}

export async function listConversations(page, { limit = 30 } = {}) {
  await openSidebar(page);

  const found = new Map();
  let unchangedRounds = 0;

  while (found.size < limit && unchangedRounds < 4) {
    const before = found.size;
    const rows = await page.locator(SELECTORS.conversationLink).evaluateAll((links) =>
      links.map((link) => ({
        href: link.href,
        title:
          link.getAttribute("aria-label") ||
          link.getAttribute("title") ||
          link.textContent ||
          "Untitled chat",
      })),
    );

    for (const row of rows) {
      const match = row.href.match(/\/c\/([^/?#]+)/);
      if (!match) continue;
      const title = row.title.replace(/\s+/g, " ").trim();
      found.set(match[1], {
        id: match[1],
        title: title || "Untitled chat",
        url: new URL(`/c/${match[1]}`, CHATGPT_URL).href,
      });
      if (found.size >= limit) break;
    }

    unchangedRounds = found.size === before ? unchangedRounds + 1 : 0;
    await page.evaluate((selector) => {
      const links = [...document.querySelectorAll(selector)];
      const candidates = links.flatMap((link) => {
        const result = [];
        let node = link.parentElement;
        while (node && node !== document.body) {
          if (node.scrollHeight > node.clientHeight + 20) result.push(node);
          node = node.parentElement;
        }
        return result;
      });
      const scroller = candidates.sort((a, b) => b.clientHeight - a.clientHeight)[0];
      if (scroller) scroller.scrollTop += Math.max(scroller.clientHeight * 0.8, 400);
    }, SELECTORS.conversationLink);
    await page.waitForTimeout(500);
  }

  return [...found.values()].slice(0, limit);
}

export async function openConversation(page, conversation) {
  await page.goto(conversation.url, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(700);
  await requireLogin(page);
}

export async function openNewConversation(page) {
  await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(700);
  await requireLogin(page);
}

async function assistantSnapshot(page, { html = false } = {}) {
  return parseSnapshot(await page.evaluate(readAssistantState, { html }));
}

async function writePrompt(page, prompt) {
  const composer = await findComposer(page);
  if (!composer) throw new Error("Could not find the ChatGPT message composer.");

  await composer.click();
  await composer.fill(prompt).catch(async () => {
    await composer.press("ControlOrMeta+A");
    await composer.pressSequentially(prompt, { delay: 1 });
  });
  await composer.press("Enter");
}

export async function sendMessage(page, prompt, { timeoutMs = 5 * 60_000 } = {}) {
  const before = await assistantSnapshot(page);
  await writePrompt(page, prompt);

  return waitForReply({
    snapshot: (options) => assistantSnapshot(page, options),
    before,
    timeoutMs,
  });
}
