#!/usr/bin/env node
// Saves the raw HTML of one assistant message from the conversation open in
// Chrome and replays it through the real cleaning + markdown pipeline in a
// headless Chrome, so a formatting bug can be reproduced and turned into a test
// fixture without sending anything.
//
//   node scripts/capture-dom.mjs "text inside the reply" output/case.html
//   node scripts/capture-dom.mjs "text inside the reply" output/case.html --skeleton
//
// --skeleton masks letters and digits, so the layout can be shared without the
// conversation text. The saved file contains real conversation content: keep it
// under output/ (git-ignored) and never commit it.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { chromeExecutable } from "../src/browser.js";
import { executeChromeJavaScript } from "../src/chrome.js";
import { htmlToMarkdown } from "../src/markdown.js";
import { parseSnapshot, readAssistantState } from "../src/snapshot.js";

const [needle, outFile, flag] = process.argv.slice(2);
if (!needle || !outFile) {
  console.error('usage: node scripts/capture-dom.mjs "text in the reply" <out.html> [--skeleton]');
  process.exit(2);
}

const raw = JSON.parse(await executeChromeJavaScript(`JSON.stringify((() => {
  const block = [...document.querySelectorAll('[data-message-author-role="assistant"]')]
    .find((element) => (element.innerText || '').includes(${JSON.stringify(needle)}));
  return block ? block.outerHTML : null;
})())`));
if (!raw) {
  console.error("No assistant message contains that text.");
  process.exit(1);
}
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, raw);

const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(raw);
  const snapshot = parseSnapshot(await page.evaluate(readAssistantState, { html: true }));
  const markdown = htmlToMarkdown(snapshot.html);
  console.log(flag === "--skeleton" ? markdown.replace(/[\p{L}\p{N}]+/gu, "x") : markdown);
} finally {
  await browser.close();
}
console.error(`saved ${raw.length} chars to ${outFile}`);
