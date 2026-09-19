import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { chromium } from "playwright-core";
import { chromeExecutable } from "../src/browser.js";
import { htmlToMarkdown } from "../src/markdown.js";
import { parseSnapshot, readAssistantState } from "../src/snapshot.js";

const chromePath = chromeExecutable();
const skip = fs.existsSync(chromePath) ? false : "Chrome is not installed";

async function readFixture(html, { withHtml = true } = {}) {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const childrenBefore = await page.evaluate(() => document.body.children.length);
    const state = parseSnapshot(await page.evaluate(readAssistantState, { html: withHtml }));
    const childrenAfter = await page.evaluate(() => document.body.children.length);
    return { state, markdown: htmlToMarkdown(state.html), pageUntouched: childrenBefore === childrenAfter };
  } finally {
    await browser.close();
  }
}

const KATEX = (tex, glyphs, display = false) => {
  const inner = `<span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">${glyphs}</span></span>`;
  return display ? `<span class="katex-display">${inner}</span>` : inner;
};

const MARKDOWN_FIXTURE = `
<article data-turn="assistant">
  <div data-message-author-role="assistant"><div class="markdown">
    <p>Intro</p>
    <ul><li><p>one</p></li><li><p>two</p></li></ul>
    <ol><li><p>a</p><ul><li><p>nested</p></li></ul></li></ol>
    <p>Energy is ${KATEX("E=mc^2", '<span class="mord">E</span><span class="mrel">=</span><span class="mord">mc</span>')} here.</p>
    ${KATEX("x_1 = 1", '<span class="mord">x</span>', true)}
    <p>See <a href="https://example.com/page">the docs</a>.</p>
    <pre><div class="header"><span>python</span><button>Copy code</button></div><div><code class="whitespace-pre! language-python"><span>def f():</span>\n<span>    return 1</span></code></div></pre>
    <table>
      <thead><tr><th><p>Name</p></th><th><p>Size</p></th></tr></thead>
      <tbody><tr><td><p>alpha</p></td><td><p>1</p></td></tr><tr><td><p>beta</p></td><td><p>2</p></td></tr></tbody>
    </table>
  </div></div>
  <button data-testid="copy-turn-action-button">Copy</button>
</article>`;

test("a reply becomes clean markdown: tight lists, math, code, tables, links", { skip }, async () => {
  const { state, markdown, pageUntouched } = await readFixture(MARKDOWN_FIXTURE);

  assert.equal(markdown, [
    "Intro",
    "",
    "- one",
    "- two",
    "",
    "1. a",
    "   - nested",
    "",
    "Energy is $E=mc^2$ here.",
    "",
    "$$x_1 = 1$$",
    "",
    "See [the docs](https://example.com/page).",
    "",
    "```python",
    "def f():",
    "    return 1",
    "```",
    "",
    "| Name | Size |",
    "| --- | --- |",
    "| alpha | 1 |",
    "| beta | 2 |",
  ].join("\n"));
  assert.equal(state.count, 1);
  assert.equal(state.complete, true);
  assert.equal(pageUntouched, true);
});

test("html is only produced when asked for", { skip }, async () => {
  const { state } = await readFixture(MARKDOWN_FIXTURE, { withHtml: false });
  assert.equal(state.html, "");
  assert.match(state.text, /^Intro/);
});

const TURN_FIXTURE = `
<section data-turn="assistant" data-testid="conversation-turn-2">
  <div data-message-author-role="assistant"><div class="markdown"><p>Let me check.</p></div></div>
  <div data-message-author-role="assistant" style="display:none"><div class="markdown"><p>Hidden reasoning.</p></div></div>
  <div data-message-author-role="assistant"><div class="markdown"><p>The answer.</p></div></div>
  <button data-testid="copy-turn-action-button">Copy</button>
</section>`;

test("a turn with several assistant blocks reads every visible block and counts as complete", { skip }, async () => {
  const { state, markdown } = await readFixture(TURN_FIXTURE);
  assert.equal(markdown, "Let me check.\n\nThe answer.");
  assert.equal(state.count, 3);
  // The copy button sits on the turn that holds all the assistant blocks.
  assert.equal(state.complete, true);
  assert.doesNotMatch(state.text, /Hidden/);
});

test("a turn without its copy button is not complete", { skip }, async () => {
  const { state } = await readFixture(TURN_FIXTURE.replace(/<button[^>]*>Copy<\/button>/, ""));
  assert.equal(state.complete, false);
});

const WIDGET_FIXTURE = `
<section data-turn="assistant" data-testid="conversation-turn-2">
  <div data-message-author-role="assistant"><div class="markdown">
    <p>Options:</p>
    <div class="puik-root not-prose not-markdown">
      <div><div><p>Alpha</p><div class="spacer"></div><p>first option</p></div><p>note a</p></div>
      <div><div><p>Beta</p><div class="spacer"></div><p>second option</p></div><p>note b</p></div>
    </div>
  </div></div>
  <button data-testid="copy-turn-action-button">Copy</button>
</section>`;

test("rich answer widgets keep their lines together instead of one paragraph each", { skip }, async () => {
  const { markdown } = await readFixture(WIDGET_FIXTURE);
  assert.equal(markdown, "Options:\n\nAlpha\nfirst option\n\nnote a\n\nBeta\nsecond option\n\nnote b");
});

const LINK_FIXTURE = `
<base href="https://chatgpt.com/">
<section data-turn="assistant" data-testid="conversation-turn-2">
  <div data-message-author-role="assistant"><div class="markdown">
    <p>Read <a href="/c/abc123">this chat</a> and <a href="https://news.example.com/story" aria-label="Example News"><svg></svg></a>.</p>
  </div></div>
  <button data-testid="copy-turn-action-button">Copy</button>
</section>`;

test("relative links become absolute and text-less link cards keep a label", { skip }, async () => {
  const { markdown } = await readFixture(LINK_FIXTURE);
  assert.equal(
    markdown,
    "Read [this chat](https://chatgpt.com/c/abc123) and [Example News](https://news.example.com/story).",
  );
});
