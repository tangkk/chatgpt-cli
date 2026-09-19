// Runs inside the ChatGPT page: through Playwright's page.evaluate() and, as
// source text, through Chrome's AppleScript bridge. It must stay self-contained
// (no imports or outer variables).
//
// `text` is the rendered text of the reply and is only used to notice that a
// reply started or is still changing. With `{ html: true }` it also returns a
// cleaned copy of the reply's HTML for conversion to markdown.
export function readAssistantState({ html = false } = {}) {
  const visible = (element) => Boolean(element && element.getClientRects().length > 0);
  const primary = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  const messages = primary.length
    ? primary
    : [...document.querySelectorAll('article[data-turn="assistant"]')];
  const last = messages.at(-1);

  // The copy button belongs to the whole turn, and a turn can hold several
  // assistant blocks (e.g. a preamble and the answer), so work per turn rather
  // than per block.
  const turn = last?.closest('[data-turn="assistant"], [data-testid^="conversation-turn-"]');
  const turnBlocks = turn
    ? [...turn.querySelectorAll('[data-message-author-role="assistant"]')]
    : [];
  const shown = turnBlocks.filter(visible);
  const blocks = shown.length ? shown : last ? [last] : [];

  const cleanedHtml = (source) => {
    const clone = source.cloneNode(true);
    for (const junk of clone.querySelectorAll("iframe, video, audio, script, style, svg, img, pre button")) {
      junk.remove();
    }

    // Math becomes a custom element so it reaches the markdown untouched.
    const texOf = (element) => (
      element.querySelector('annotation[encoding="application/x-tex"]')
      || element.querySelector("annotation")
      || element.querySelector(".katex-mathml")
      || element
    ).textContent.trim();
    const mathElement = (element, display) => {
      const math = document.createElement("x-math");
      // The TeX goes in as text: turndown drops elements with no text as blank.
      math.textContent = texOf(element);
      if (display) math.setAttribute("data-display", "block");
      return math;
    };
    for (const display of clone.querySelectorAll(".katex-display")) {
      display.replaceWith(mathElement(display, true));
    }
    for (const inline of clone.querySelectorAll(".katex")) {
      inline.replaceWith(mathElement(inline, false));
    }

    // ChatGPT wraps code in a header bar plus nested divs; keep just the code
    // and its language.
    for (const pre of clone.querySelectorAll("pre")) {
      const code = pre.querySelector("code");
      if (!code) continue;
      const language = (code.className.match(/language-([\w+#.-]+)/) || [])[1] || "";
      const plain = document.createElement("pre");
      const inner = document.createElement("code");
      if (language) inner.className = `language-${language}`;
      inner.textContent = code.textContent;
      plain.append(inner);
      pre.replaceWith(plain);
    }

    // <p> inside list items and table cells would turn tight lists into loose
    // ones and break table rows across lines.
    for (const paragraph of clone.querySelectorAll("li > p:first-child")) {
      paragraph.replaceWith(...paragraph.childNodes);
    }
    for (const paragraph of clone.querySelectorAll("td p, th p")) {
      const spacer = paragraph.nextSibling ? [document.createTextNode(" ")] : [];
      paragraph.replaceWith(...paragraph.childNodes, ...spacer);
    }

    // Link cards have no text of their own; label them so the URL is not lost.
    for (const anchor of clone.querySelectorAll("a[href]")) {
      let url;
      try {
        url = new URL(anchor.getAttribute("href"), document.baseURI);
      } catch {
        continue;
      }
      anchor.setAttribute("href", url.href);
      if (!anchor.textContent.trim()) {
        anchor.textContent = anchor.getAttribute("aria-label") || anchor.title || url.hostname;
      }
    }

    // Rich answer widgets (cards, comparison boxes) are nested divs and <p>s
    // that would each become a paragraph of their own. Keep their lines together.
    for (const widget of clone.querySelectorAll(".not-markdown")) {
      const lines = [...widget.querySelectorAll("p, div")].filter((element) => (
        !element.closest("table")
        && !element.querySelector("p, div, h1, h2, h3, h4, h5, h6, table, ul, ol, pre, blockquote")
      ));
      for (const element of lines) {
        if (!element.textContent.trim()) {
          element.remove();
          continue;
        }
        const line = document.createElement("span");
        line.append(...element.childNodes);
        element.replaceWith(line, document.createElement("br"));
      }
    }
    return clone.outerHTML;
  };

  const stop = [...document.querySelectorAll([
    'button[data-testid="stop-button"]',
    'button[data-testid="composer-submit-button"]',
    'button[aria-label*="Stop" i]',
    'button[aria-label*="停止"]',
  ].join(","))].some(visible);

  const copySelector = 'button[data-testid="copy-turn-action-button"]';
  let complete = false;
  if (turn) {
    complete = Boolean(turn.querySelector(copySelector));
  } else {
    for (let node = last; node && node !== document.body; node = node.parentElement) {
      if (node.querySelectorAll('[data-message-author-role="assistant"]').length > 1) break;
      if (node.querySelector(copySelector)) {
        complete = true;
        break;
      }
    }
  }

  const composer = [...document.querySelectorAll('#prompt-textarea, textarea[placeholder], [contenteditable="true"]')]
    .find(visible);
  const composerScope = composer?.closest("form") || composer?.parentElement?.parentElement?.parentElement;
  const idleComposer = Boolean(composerScope && [...composerScope.querySelectorAll([
    'button[aria-label*="Start Voice" i]',
    'button[aria-label*="Start dictation" i]',
    'button[aria-label*="开始语音"]',
    'button[aria-label*="开始听写"]',
  ].join(","))].some(visible));
  const writing = Boolean(turn?.querySelector("[data-writing-block]"));

  const text = blocks.map((block) => (block.innerText || "").trim()).filter(Boolean).join("\n\n");
  return {
    count: messages.length,
    text,
    html: html ? blocks.map(cleanedHtml).join("\n") : "",
    stop,
    complete,
    idleComposer,
    writing,
    visible: document.visibilityState === "visible",
  };
}

export function parseSnapshot(raw) {
  const state = raw && typeof raw === "object" ? raw : {};
  return { ...state, text: String(state.text ?? ""), html: String(state.html ?? "") };
}
