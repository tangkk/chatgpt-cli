import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

export function createTerminal() {
  return readline.createInterface({ input: stdin, output: stdout });
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
