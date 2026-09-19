import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

function createConverter() {
  const converter = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    hr: "---",
  });

  // The output is read as-is in a terminal, where "snake\_case" or "1\." only
  // add noise, so text is not escaped.
  converter.escape = (text) => text;

  // Same as turndown's own list item rule, but with a one-space marker
  // ("- item", "1. item") instead of its wide "-   item" padding.
  converter.addRule("listItem", {
    filter: "li",
    replacement(content, node, options) {
      const parent = node.parentNode;
      let prefix = `${options.bulletListMarker} `;
      if (parent.nodeName === "OL") {
        const start = Number.parseInt(parent.getAttribute("start"), 10);
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = `${(Number.isFinite(start) ? start : 1) + index}. `;
      }
      const body = content
        .replace(/^\n+/, "")
        .replace(/\n+$/, "\n")
        .replace(/\n/g, `\n${" ".repeat(prefix.length)}`);
      return prefix + body + (node.nextSibling && !/\n$/.test(body) ? "\n" : "");
    },
  });

  // Math is emitted by the page as <x-math>TeX</x-math>.
  converter.addRule("math", {
    filter: (node) => node.nodeName === "X-MATH",
    replacement: (_content, node) => {
      const tex = node.textContent.trim();
      return node.getAttribute("data-display") === "block" ? `\n\n$$${tex}$$\n\n` : `$${tex}$`;
    },
  });

  converter.use(gfm);

  // Overrides the gfm table cell rule (added last, so it matches first) to
  // escape "|" and keep each cell on one line.
  converter.addRule("tableCell", {
    filter: ["th", "td"],
    replacement(content, node) {
      const index = Array.prototype.indexOf.call(node.parentNode.childNodes, node);
      const text = content.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();
      return `${index === 0 ? "| " : " "}${text} |`;
    },
  });
  return converter;
}

// Trailing spaces and runs of blank lines are tidied outside fenced code only,
// so code keeps its exact whitespace.
export function tidyMarkdown(markdown) {
  const out = [];
  let inFence = false;
  let blank = false;
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence || /^\s*```/.test(line)) {
      out.push(line);
      blank = false;
      continue;
    }
    const trimmed = line.replace(/[ \t ]+$/, "");
    if (!trimmed) {
      if (!blank) out.push("");
      blank = true;
    } else {
      out.push(trimmed);
      blank = false;
    }
  }
  return out.join("\n").trim();
}

export function htmlToMarkdown(html) {
  if (!html || !html.trim()) return "";
  return tidyMarkdown(createConverter().turndown(html));
}
