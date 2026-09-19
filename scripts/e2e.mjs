#!/usr/bin/env node
// End-to-end check: drives the real CLI through its interactive menu against the
// conversation that is currently open in Chrome, sends each prompt, and prints
// what a user would see. This writes real messages into that conversation.
//
//   node scripts/e2e.mjs "prompt one" "prompt two"
//   node scripts/e2e.mjs @prompts.json          (a JSON array of prompts)
//
// A prompt containing newlines is written in one go, like a terminal paste, and
// must arrive as a single multi-line message.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromeListConversations, executeChromeJavaScript } from "../src/chrome.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");
const timeoutMs = Number(process.env.E2E_TIMEOUT_MS || 9 * 60_000);
const args = process.argv.slice(2);
const prompts = args.length === 1 && args[0].startsWith("@")
  ? JSON.parse(fs.readFileSync(args[0].slice(1), "utf8"))
  : args;
if (!prompts.length) {
  console.error('usage: node scripts/e2e.mjs "prompt" ...   |   node scripts/e2e.mjs @prompts.json');
  process.exit(2);
}

const currentPath = JSON.parse(await executeChromeJavaScript("JSON.stringify(location.pathname)"));
const currentId = currentPath.split("/c/")[1];
const conversations = await chromeListConversations({ limit: 50 });
const menuNumber = conversations.findIndex((conversation) => conversation.id === currentId) + 1;
if (!menuNumber) {
  console.error("The conversation open in Chrome is not in the sidebar list; open an existing chat first.");
  process.exit(2);
}

const child = spawn(process.execPath, [cli, "chrome"], { stdio: ["pipe", "pipe", "pipe"] });
let output = "";
let stderr = "";
let phase = "menu";
let sent = 0;
let sentAt = 0;
let finished = false;
let failed = false;
const startedAt = Date.now();
const seconds = (from) => ((Date.now() - from) / 1000).toFixed(1);

child.stdout.on("data", (chunk) => {
  output += chunk.toString();
  if (phase === "menu" && /\n> $/.test(output)) {
    phase = "chat";
    output = "";
    child.stdin.write(`${menuNumber}\n`);
    return;
  }
  if (phase !== "chat" || !/You > $/.test(output)) return;

  if (sent > 0) {
    const reply = output.slice(output.lastIndexOf("ChatGPT > ")).replace(/\r\x1b\[2K/g, "").replace(/\nYou > $/, "");
    console.log(`\n=== reply ${sent} (${seconds(sentAt)}s) ===\n${reply.trimEnd()}`);
    if (!reply.replace("ChatGPT >", "").trim()) failed = true;
  }
  output = "";
  if (sent < prompts.length) {
    console.log(`\n>>> prompt ${sent + 1}: ${prompts[sent].slice(0, 100)}`);
    sentAt = Date.now();
    child.stdin.write(`${prompts[sent++]}\n`);
  } else {
    finished = true;
    child.stdin.write("/quit\n");
  }
});
child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
child.on("exit", (code) => {
  const problem = code || failed || !finished;
  console.log(`\n[cli exit ${code}, ${finished ? "all prompts answered" : "stopped early"}, ${seconds(startedAt)}s total]`);
  if (stderr.trim()) console.log(`stderr: ${stderr.trim()}`);
  if (!finished) console.log(`last output: ${JSON.stringify(output.slice(-400))}`);
  process.exit(problem ? 1 : 0);
});
setTimeout(() => {
  console.log(`TIMEOUT after ${seconds(startedAt)}s`);
  child.kill();
}, timeoutMs);
