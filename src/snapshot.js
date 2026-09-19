// Runs inside the ChatGPT page: through Playwright's page.evaluate() and, as
// source text, through Chrome's AppleScript bridge. It must stay self-contained
// (no imports or outer variables).
//
// `text` is the rendered text of the reply and is only used to notice that a
// reply started or is still changing. With `{ html: true }` it also returns a
// cleaned copy of the reply's HTML for conversion to markdown. With
// `{ recent: N }` it also returns the last N user/assistant messages (assistant
// ones with cleaned HTML) for showing the conversation history.
export function readAssistantState({ html = false, recent = 0 } = {}) {
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

    // Task-list checkboxes are <button role="checkbox">, not <input>.
    for (const box of clone.querySelectorAll('[role="checkbox"]')) {
      box.replaceWith(document.createTextNode(box.getAttribute("aria-checked") === "true" ? "[x] " : "[ ] "));
    }

    // Citation pills are <div role="button"> badges with no link in the DOM (the
    // URL only appears in a popover). Keep the label inline, e.g. "[GitHub +1]".
    for (const badge of clone.querySelectorAll('[data-d-component="badge"]')) {
      const label = [...badge.querySelectorAll("span")]
        .filter((part) => !part.querySelector("span"))
        .map((part) => part.textContent.trim())
        .filter(Boolean)
        .join(" ") || badge.textContent.trim();
      const holder = badge.closest('[role="button"]') || badge;
      holder.replaceWith(document.createTextNode(label ? ` [${label}]` : ""));
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

    // Bold, italic and strikethrough arrive as <span data-d-*> rather than
    // <strong>/<em>/<del>, which the converter would not recognise.
    for (const span of clone.querySelectorAll(
      '[data-d-default-strong], [data-d-font-style="italic"], [data-d-text-decoration~="line-through"]',
    )) {
      const names = [];
      if (span.hasAttribute("data-d-default-strong")) names.push("strong");
      if (span.getAttribute("data-d-font-style") === "italic") names.push("em");
      if ((span.getAttribute("data-d-text-decoration") || "").includes("line-through")) names.push("del");
      let outer = null;
      let innermost = null;
      for (const name of names) {
        const element = document.createElement(name);
        if (innermost) innermost.append(element);
        else outer = element;
        innermost = element;
      }
      innermost.append(...span.childNodes);
      span.replaceWith(outer);
    }

    // Code blocks: the language is only shown in a header bar beside the <pre>
    // (with buttons), not on the <code>. Keep just the code and its language.
    const plainCode = (pre, language) => {
      const code = pre.querySelector("code");
      const plain = document.createElement("pre");
      const inner = document.createElement("code");
      const known = (code.className.match(/language-([\w+#.-]+)/) || [])[1] || language;
      if (known) inner.className = `language-${known}`;
      inner.textContent = code.textContent;
      plain.append(inner);
      return plain;
    };
    for (const root of clone.querySelectorAll(
      '[data-client-defined-widget="code_block"], [data-d-component="code_block"]',
    )) {
      const pre = root.querySelector("pre");
      if (!pre || !pre.querySelector("code")) continue;
      const header = root.cloneNode(true);
      for (const part of header.querySelectorAll("pre, button")) part.remove();
      const label = header.textContent.trim().toLowerCase().replace(/\s+/g, "");
      root.replaceWith(plainCode(pre, /^[a-z0-9+#.-]{1,24}$/.test(label) ? label : ""));
    }
    for (const pre of clone.querySelectorAll("pre")) {
      if (pre.querySelector("code")) pre.replaceWith(plainCode(pre, ""));
    }

    // List items wrap their text in nested divs and <p>s, which would turn tight
    // lists into loose ones; table cells would break rows across lines.
    for (const item of clone.querySelectorAll("li")) {
      for (const wrapper of [...item.querySelectorAll("div")]) {
        if (wrapper.closest("li") === item) wrapper.replaceWith(...wrapper.childNodes);
      }
    }
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

    // Rich answer widgets (cards, comparison boxes) lay out a title and a
    // subtitle as <p>, <empty spacer div>, <p>. Keep such a group on adjacent
    // lines. Ordinary paragraphs, even inside the same renderer, stay paragraphs.
    for (const spacer of clone.querySelectorAll(".not-markdown div")) {
      if (spacer.children.length || spacer.textContent.trim()) continue;
      const box = spacer.parentElement;
      const lines = [...box.children].filter((child) => child.tagName === "P" && child.textContent.trim());
      if (lines.length < 2) continue;
      for (const element of lines) {
        const line = document.createElement("span");
        line.append(...element.childNodes);
        element.replaceWith(line, document.createElement("br"));
      }
      spacer.remove();
    }
    return clone.outerHTML;
  };

  // If cleaning throws on an unexpected page structure, return no HTML so the
  // caller falls back to the plain text instead of losing the reply.
  const safeHtml = (list) => {
    try {
      return list.map(cleanedHtml).join("\n");
    } catch {
      return "";
    }
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

  const recentMessages = () => {
    const role = (node) => node.getAttribute("data-message-author-role") || node.getAttribute("data-turn") || "assistant";
    const primaryNodes = [...document.querySelectorAll(
      '[data-message-author-role="user"], [data-message-author-role="assistant"]',
    )];
    const nodes = primaryNodes.length
      ? primaryNodes
      : [...document.querySelectorAll('article[data-turn="user"], article[data-turn="assistant"]')];
    return nodes.slice(-recent).map((node) => ({
      role: role(node),
      text: (node.innerText || "").trim(),
      html: role(node) === "user" ? "" : safeHtml([node]),
    }));
  };

  const text = blocks.map((block) => (block.innerText || "").trim()).filter(Boolean).join("\n\n");
  return {
    count: messages.length,
    text,
    html: html ? safeHtml(blocks) : "",
    recent: recent ? recentMessages() : [],
    stop,
    complete,
    idleComposer,
    writing,
    visible: document.visibilityState === "visible",
  };
}

export function parseSnapshot(raw) {
  const state = raw && typeof raw === "object" ? raw : {};
  return {
    ...state,
    text: String(state.text ?? ""),
    html: String(state.html ?? ""),
    recent: Array.isArray(state.recent) ? state.recent : [],
  };
}
