#!/usr/bin/env node

import process from "node:process";
import {
  closeLoginBrowser,
  launchBrowser,
  launchLoginBrowser,
  profileDir,
} from "./browser.js";
import {
  listConversations,
  openChatGPT,
  openConversation,
  openNewConversation,
  requireLogin,
  sendMessage,
  isLoggedIn,
} from "./chatgpt.js";
import {
  chooseConversation,
  createTerminal,
  printChatHistory,
  printConversations,
} from "./terminal.js";
import {
  checkChromeBridge,
  chromeListConversations,
  chromeOpenConversation,
  chromeOpenNewConversation,
  chromeRecentMessages,
  chromeSendMessage,
  ensureChromeChatGPTTab,
} from "./chrome.js";

function usage() {
  console.log(`chatgpt-web - use real ChatGPT web conversations from the terminal

Usage:
  chatgpt-web                      Use the ChatGPT session in your open Chrome
  chatgpt-web chrome               Same as above
  chatgpt-web chrome-check         Check the existing-Chrome bridge
  chatgpt-web chrome-list          List chats from existing Chrome

Isolated-profile fallback:
  chatgpt-web login                Sign in using a dedicated Chrome profile
  chatgpt-web status               Verify the dedicated profile login
  chatgpt-web list [--limit N]     List chats from the dedicated profile
  chatgpt-web chat [ID]            Continue a dedicated-profile chat
  chatgpt-web new                  Start a dedicated-profile chat

Options:
  --headed                         Show Chrome (useful for login challenges)
  --limit N                        Number of recent conversations (default: 30)
  -h, --help                       Show this help

In-chat commands:
  /new                             Start a new conversation
  /quit                            Exit
`);
}

function parseArgs(argv) {
  const args = [...argv];
  let headed = process.env.CHATGPT_WEB_CLI_HEADED === "1";
  let limit = 30;
  const positional = [];

  while (args.length) {
    const arg = args.shift();
    if (arg === "--headed") headed = true;
    else if (arg === "--limit") {
      limit = Number.parseInt(args.shift() || "", 10);
      if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
        throw new Error("--limit must be between 1 and 200.");
      }
    } else if (arg === "-h" || arg === "--help") positional.push("help");
    else positional.push(arg);
  }

  return { command: positional[0] || "chrome", id: positional[1], headed, limit };
}

async function login() {
  console.log(`Using browser profile: ${profileDir()}`);
  console.log("Opening ordinary Chrome without Playwright automation flags.");
  console.log("Complete the ChatGPT sign-in, then return here and press Enter.");
  const terminal = createTerminal();
  const loginBrowser = await launchLoginBrowser();
  try {
    await terminal.question("");
  } finally {
    terminal.close();
    await closeLoginBrowser(loginBrowser);
  }

  const { context, page } = await launchBrowser();
  try {
    await openChatGPT(page);
    if (!(await isLoggedIn(page))) {
      throw new Error(
        "ChatGPT login was not detected. Run `chatgpt-web login` again and make sure ChatGPT shows your signed-in account before pressing Enter.",
      );
    }
    console.log("ChatGPT login verified and saved successfully.");
  } finally {
    await context.close();
  }
}

async function withBrowser(options, callback) {
  const { context, page } = await launchBrowser(options);
  try {
    await openChatGPT(page);
    await requireLogin(page);
    return await callback(page);
  } finally {
    await context.close();
  }
}

async function list({ headed, limit }) {
  await withBrowser({ headed }, async (page) => {
    const conversations = await listConversations(page, { limit });
    printConversations(conversations);
  });
}

async function status({ headed }) {
  const { context, page } = await launchBrowser({ headed });
  try {
    await openChatGPT(page);
    const authenticated = await isLoggedIn(page);
    console.log(authenticated ? "Signed in to ChatGPT." : "Not signed in to ChatGPT.");
    if (!authenticated) process.exitCode = 1;
  } finally {
    await context.close();
  }
}

async function chromeCheck() {
  const state = await checkChromeBridge();
  console.log(`Connected to existing Chrome: ${state.title || "ChatGPT"}`);
}

async function chromeList({ limit }) {
  await ensureChromeChatGPTTab();
  await checkChromeBridge();
  const conversations = await chromeListConversations({ limit });
  printConversations(conversations);
}

async function pickChromeConversation(terminal, limit) {
  while (true) {
    const conversations = await chromeListConversations({ limit });
    const choice = await chooseConversation(terminal, conversations);
    if (choice.action !== "refresh") return choice;
    console.log("\nRefreshing…\n");
  }
}

async function chromeChatLoop(terminal) {
  console.log("\nConnected to ChatGPT in your existing Chrome. Type /new or /quit.\n");
  while (true) {
    const prompt = (await terminal.question("You > ")).trim();
    if (!prompt) continue;
    if (prompt === "/quit") return;
    if (prompt === "/new") {
      await chromeOpenNewConversation();
      console.log("Started a new ChatGPT conversation.\n");
      continue;
    }

    process.stdout.write("ChatGPT > ");
    await chromeSendMessage(prompt, {
      onDelta: (delta) => process.stdout.write(delta),
    });
    process.stdout.write("\n\n");
  }
}

async function chromeChat({ limit }) {
  const terminal = createTerminal();
  try {
    await ensureChromeChatGPTTab();
    await checkChromeBridge();
    const choice = await pickChromeConversation(terminal, limit);
    if (choice.action === "quit") return;
    if (choice.action === "new") await chromeOpenNewConversation();
    if (choice.action === "open") {
      await chromeOpenConversation(choice.conversation);
      printChatHistory(await chromeRecentMessages());
    }
    await chromeChatLoop(terminal);
  } finally {
    terminal.close();
  }
}

async function pickConversation(page, terminal, limit) {
  while (true) {
    const conversations = await listConversations(page, { limit });
    const choice = await chooseConversation(terminal, conversations);
    if (choice.action !== "refresh") return choice;
    console.log("\nRefreshing…\n");
    await page.reload({ waitUntil: "domcontentloaded" });
  }
}

async function chatLoop(page, terminal) {
  console.log("\nConnected to ChatGPT. Type /new for a new chat or /quit to exit.\n");
  while (true) {
    const prompt = (await terminal.question("You > ")).trim();
    if (!prompt) continue;
    if (prompt === "/quit") return;
    if (prompt === "/new") {
      await openNewConversation(page);
      console.log("Started a new ChatGPT conversation.\n");
      continue;
    }

    process.stdout.write("ChatGPT > ");
    await sendMessage(page, prompt, {
      onDelta: (delta) => process.stdout.write(delta),
    });
    process.stdout.write("\n\n");
  }
}

async function chat({ id, headed, limit, forceNew = false }) {
  const terminal = createTerminal();
  try {
    await withBrowser({ headed }, async (page) => {
      if (forceNew) {
        await openNewConversation(page);
      } else if (id) {
        await openConversation(page, {
          id,
          url: `https://chatgpt.com/c/${encodeURIComponent(id)}`,
        });
      } else {
        const choice = await pickConversation(page, terminal, limit);
        if (choice.action === "quit") return;
        if (choice.action === "new") await openNewConversation(page);
        if (choice.action === "open") await openConversation(page, choice.conversation);
      }
      await chatLoop(page, terminal);
    });
  } finally {
    terminal.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "help") return usage();
  if (options.command === "chrome") return chromeChat(options);
  if (options.command === "chrome-check") return chromeCheck();
  if (options.command === "chrome-list") return chromeList(options);
  if (options.command === "login") return login();
  if (options.command === "status") return status(options);
  if (options.command === "list") return list(options);
  if (options.command === "chat") return chat(options);
  if (options.command === "new") return chat({ ...options, forceNew: true });
  throw new Error(`Unknown command: ${options.command}`);
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exitCode = 1;
});
