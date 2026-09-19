import readline from "node:readline";
import { stdin, stdout } from "node:process";

// Line reader that keeps a multi-line paste together. A plain readline question
// only takes the next line and silently drops the rest of a paste, so lines that
// arrive within `pasteWindowMs` of each other are joined into one answer.
// End of input answers "/quit" instead of throwing.
export function createTerminal({ input = stdin, output = stdout, pasteWindowMs = 30 } = {}) {
  const rl = readline.createInterface({ input, output });
  const queue = [];
  let waiter = null;
  let closed = false;

  const wake = (value) => {
    const resolve = waiter;
    waiter = null;
    if (resolve) resolve(value);
  };
  rl.on("line", (line) => {
    if (waiter) wake({ line });
    else queue.push(line);
  });
  rl.on("close", () => {
    closed = true;
    wake({ closed: true });
  });

  // Resolves with { line }, { closed: true }, or { timeout: true }.
  const nextLine = (timeoutMs) => {
    if (queue.length) return Promise.resolve({ line: queue.shift() });
    if (closed) return Promise.resolve({ closed: true });
    return new Promise((resolve) => {
      const timer = timeoutMs === undefined ? null : setTimeout(() => wake({ timeout: true }), timeoutMs);
      waiter = (value) => {
        if (timer) clearTimeout(timer);
        resolve(value);
      };
    });
  };

  return {
    async question(text) {
      if (closed && !queue.length) return "/quit";
      rl.setPrompt(text);
      rl.prompt();
      const first = await nextLine();
      if (first.closed) return "/quit";
      const lines = [first.line];
      for (;;) {
        const more = await nextLine(pasteWindowMs);
        if (more.line === undefined) break;
        lines.push(more.line);
      }
      return lines.join("\n");
    },
    close() {
      rl.close();
    },
  };
}

// Replies are printed once ChatGPT has finished, so a placeholder line is shown
// while waiting and cleared when the reply (or an error) arrives.
export async function replyWhileWaiting(getReply) {
  stdout.write("ChatGPT > ChatGPT is replying…");
  let reply;
  try {
    reply = await getReply();
  } finally {
    stdout.write(stdout.isTTY ? "\r\x1b[2K" : "\n");
  }
  stdout.write(`ChatGPT > ${reply}\n\n`);
}

export function printConversations(conversations) {
  if (!conversations.length) {
    console.log("No recent conversations were found in the ChatGPT sidebar.");
    return;
  }

  for (const [index, conversation] of conversations.entries()) {
    console.log(`${String(index + 1).padStart(2, " ")}  ${conversation.title}`);
  }
}

export function printChatHistory(messages) {
  if (!messages.length) return;

  console.log("\nRecent messages:");
  for (const message of messages) {
    const label = message.role === "user" ? "You" : "ChatGPT";
    const text = message.text.replace(/\n/g, "\n  ");
    console.log(`\n${label} > ${text}`);
  }
  console.log("\n---");
}

export async function chooseConversation(terminal, conversations) {
  printConversations(conversations);
  console.log("\nEnter a number, n for a new chat, r to refresh, or q to quit.");

  while (true) {
    const answer = (await terminal.question("> ")).trim().toLowerCase();
    if (answer === "n") return { action: "new" };
    if (answer === "r") return { action: "refresh" };
    if (answer === "q" || answer === "/quit") return { action: "quit" };

    const index = Number.parseInt(answer, 10) - 1;
    if (Number.isInteger(index) && conversations[index]) {
      return { action: "open", conversation: conversations[index] };
    }
    console.log("Please enter one of the displayed numbers, n, r, or q.");
  }
}
