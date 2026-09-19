import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { chromium } from "playwright-core";
import { chromeExecutable } from "../src/browser.js";
import { assistantSnapshotScript } from "../src/chrome.js";
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

// Structure captured from ChatGPT's current component renderer: styling is on
// <span data-d-*>, list items are li > div > div > p, links end in &nbsp;, and
// a code block keeps its language only in a header bar next to the <pre>.
const COMPONENT_FIXTURE = `
<section data-turn="assistant" data-testid="conversation-turn-4">
  <div data-message-author-role="assistant"><div class="markdown">
    <p data-d-component="text"><span data-d-component="text" data-d-default-strong="" data-d-inline="">Node.js</span> is fast, <span data-d-component="text" data-d-font-style="italic" data-d-inline="">really</span> and <span data-d-component="text" data-d-text-decoration="line-through" data-d-inline="">slow</span>; see <a href="https://nodejs.org/"><span data-d-text-decoration="underline-dotted">the site </span><span data-d-has-width="true"><span>docs</span>&nbsp;</span></a> for more.</p>
    <p data-d-component="text">1. <span data-d-component="text" data-d-default-strong="" data-d-inline="">Install</span></p>
    <ul data-d-marker=""><li><div><div><p data-d-component="text">Download it.</p></div></div></li><li><div><div><p data-d-component="text">Run it.</p></div></div></li></ul>
    <div data-client-defined-widget="code_block"><div><div>
      <div><div class="text-token-text-primary"><svg><use></use></svg>Python</div><div><button type="button"><svg></svg></button><button aria-label="Run code"><div>Run</div></button></div></div>
      <div><div><pre><code><span>def</span><span> </span><span>f</span><span>():
    return</span><span> 1</span></code></pre></div></div>
    </div></div></div>
  </div></div>
  <button data-testid="copy-turn-action-button">Copy</button>
</section>`;

test("ChatGPT's component markup keeps bold/italic, tight lists and code languages", { skip }, async () => {
  const { markdown } = await readFixture(COMPONENT_FIXTURE);
  assert.equal(markdown, [
    "**Node.js** is fast, *really* and ~~slow~~; see [the site docs](https://nodejs.org/) for more.",
    "",
    "1. **Install**",
    "",
    "- Download it.",
    "- Run it.",
    "",
    "```python",
    "def f():",
    "    return 1",
    "```",
  ].join("\n"));
});

// In the live page the badge <div> sits inside a <p>, which an HTML parser
// would split; a <div> wrapper keeps the fixture's structure intact.
const CITATION_FIXTURE = `
<section data-turn="assistant" data-testid="conversation-turn-6">
  <div data-message-author-role="assistant"><div class="markdown">
    <div class="para">The LTS release is v24.<div role="button" data-state="closed"><div data-d-component="badge" data-pill=""><div><div role="presentation"><img src="x.png"></div></div><div><div><span>GitHub</span></div><div><span>+1</span></div></div></div></div> Newer builds exist.</div>
  </div></div>
  <button data-testid="copy-turn-action-button">Copy</button>
</section>`;

test("citation pills stay inline as a bracketed source label", { skip }, async () => {
  const { markdown } = await readFixture(CITATION_FIXTURE);
  assert.match(markdown, /LTS release is v24\. \[GitHub \+1\] Newer builds exist\./);
  assert.doesNotMatch(markdown, /\n\+1\n/);
});

const TASK_FIXTURE = `
<section data-turn="assistant" data-testid="conversation-turn-8">
  <div data-message-author-role="assistant"><div class="markdown">
    <ul data-d-marker="none">
      <li data-d-component="list-item"><div><div><div><button type="button" role="checkbox" aria-checked="true" data-state="checked"><span></span></button><label><span>Calculate it</span></label></div></div></div></li>
      <li data-d-component="list-item"><div><div><div><button type="button" role="checkbox" aria-checked="false" data-state="unchecked"></button><label><span>Verify it</span></label></div></div></div></li>
    </ul>
    <blockquote><p>Run this:</p><div data-d-component="code_block"><div><div class="text-token-text-primary">Bash</div><button>Copy</button></div><div><pre><code><span>echo</span><span> "hi"</span></code></pre></div></div></blockquote>
  </div></div>
  <button data-testid="copy-turn-action-button">Copy</button>
</section>`;

test("task lists keep their checked state and quoted code keeps its language", { skip }, async () => {
  const { markdown } = await readFixture(TASK_FIXTURE);
  assert.equal(markdown, [
    "- [x] Calculate it",
    "- [ ] Verify it",
    "",
    "> Run this:",
    ">",
    "> ```bash",
    '> echo "hi"',
    "> ```",
  ].join("\n"));
});

const FLOW_FIXTURE = `
<section data-turn="assistant" data-testid="conversation-turn-9">
  <div data-message-author-role="assistant"><div class="markdown">
    <div class="puik-root not-prose not-markdown">
      <h2>Heading</h2>
      <p data-d-component="text">First paragraph.</p>
      <p data-d-component="text">Second paragraph.</p>
      <ul><li><div><div><p>item</p></div></div></li></ul>
      <p data-d-component="text">Third paragraph.</p>
    </div>
  </div></div>
  <button data-testid="copy-turn-action-button">Copy</button>
</section>`;

test("ordinary paragraphs inside the component renderer stay separate paragraphs", { skip }, async () => {
  const { markdown } = await readFixture(FLOW_FIXTURE);
  assert.equal(markdown, "## Heading\n\nFirst paragraph.\n\nSecond paragraph.\n\n- item\n\nThird paragraph.");
});

test("an empty page (a new chat with no messages yet) reads as an empty reply", { skip }, async () => {
  const { state } = await readFixture("<main><textarea placeholder='Ask anything'></textarea></main>");
  assert.equal(state.count, 0);
  assert.equal(state.text, "");
  assert.equal(state.html, "");
  assert.equal(state.complete, false);
});

const HISTORY_FIXTURE = `
<div data-message-author-role="user"><div class="whitespace-pre-wrap" style="white-space: pre-wrap">Compare two things.
Second line of my question.</div></div>
<section data-turn="assistant" data-testid="conversation-turn-2">
  <div data-message-author-role="assistant"><div class="markdown">
    <table><thead><tr><th><p>Name</p></th><th><p>Size</p></th></tr></thead>
    <tbody><tr><td><p>alpha</p></td><td><p>1</p></td></tr></tbody></table>
    <div data-client-defined-widget="code_block"><div><div class="text-token-text-primary">Python</div><button>Copy</button></div><div><pre><code><span>x = 1</span></code></pre></div></div>
  </div></div>
  <button data-testid="copy-turn-action-button">Copy</button>
</section>`;

test("recent messages come back per message, cleaned for assistants and raw for the user", { skip }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(HISTORY_FIXTURE);
    const state = parseSnapshot(await page.evaluate(readAssistantState, { recent: 6 }));
    assert.deepEqual(state.recent.map((message) => message.role), ["user", "assistant"]);
    assert.equal(state.recent[0].text, "Compare two things.\nSecond line of my question.");
    assert.equal(state.recent[0].html, "");
    assert.equal(
      htmlToMarkdown(state.recent[1].html),
      "| Name | Size |\n| --- | --- |\n| alpha | 1 |\n\n```python\nx = 1\n```",
    );
    // Not requested, not returned.
    assert.deepEqual(parseSnapshot(await page.evaluate(readAssistantState)).recent, []);
  } finally {
    await browser.close();
  }
});

test("the script the Chrome bridge runs forwards its options and returns parseable JSON", { skip }, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(HISTORY_FIXTURE);
    // The bridge runs this source text through eval() inside the page.
    const run = async (options) => parseSnapshot(JSON.parse(
      await page.evaluate((code) => window.eval(code), assistantSnapshotScript(options)),
    ));
    const plain = await run({});
    assert.equal(plain.html, "");
    assert.deepEqual(plain.recent, []);
    assert.match(plain.text, /alpha/);
    assert.match((await run({ html: true })).html, /<table>/);
    assert.equal((await run({ recent: 2 })).recent.length, 2);
  } finally {
    await browser.close();
  }
});
