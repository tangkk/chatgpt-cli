import assert from "node:assert/strict";
import test from "node:test";
import { htmlToMarkdown, tidyMarkdown } from "../src/markdown.js";

test("htmlToMarkdown converts common inline and block markup", () => {
  assert.equal(
    htmlToMarkdown(
      '<h2>Title</h2><p>Some <strong>bold</strong>, <em>it</em> and <code>code_x</code> with <a href="https://a.test/">a link</a>.</p><hr><p>after</p>',
    ),
    "## Title\n\nSome **bold**, *it* and `code_x` with [a link](https://a.test/).\n\n---\n\nafter",
  );
});

test("htmlToMarkdown writes compact lists", () => {
  assert.equal(
    htmlToMarkdown("<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul><ol><li>a</li><li>b</li></ol>"),
    "- one\n- two\n  - nested\n\n1. a\n2. b",
  );
});

test("htmlToMarkdown builds a pipe table and escapes cell pipes", () => {
  assert.equal(
    htmlToMarkdown(
      "<table><thead><tr><th>Name</th><th>Note</th></tr></thead><tbody><tr><td>a|b</td><td>snake_case</td></tr></tbody></table>",
    ),
    "| Name | Note |\n| --- | --- |\n| a\\|b | snake_case |",
  );
});

test("htmlToMarkdown does not escape text meant to be read in a terminal", () => {
  assert.equal(htmlToMarkdown("<p>1. first snake_case *word*</p>"), "1. first snake_case *word*");
});

test("htmlToMarkdown keeps math untouched", () => {
  assert.equal(
    htmlToMarkdown(
      '<p>Energy <x-math>E=mc^2</x-math> and <x-math>a_1 * b_2</x-math>.</p><x-math data-display="block">\\int_0^1 x\\,dx</x-math><p>end</p>',
    ),
    "Energy $E=mc^2$ and $a_1 * b_2$.\n\n$$\\int_0^1 x\\,dx$$\n\nend",
  );
});

test("htmlToMarkdown fences code with its language and exact whitespace", () => {
  assert.equal(
    htmlToMarkdown('<pre><code class="language-python">def f():\n    return 1\n\n\n\ndef g():\n    pass   \n</code></pre><p>after</p>'),
    "```python\ndef f():\n    return 1\n\n\n\ndef g():\n    pass   \n```\n\nafter",
  );
});

test("htmlToMarkdown returns an empty string for blank input", () => {
  assert.equal(htmlToMarkdown("   "), "");
  assert.equal(htmlToMarkdown(""), "");
  assert.equal(htmlToMarkdown(undefined), "");
});

test("tidyMarkdown trims outside code and leaves code alone", () => {
  assert.equal(
    tidyMarkdown("a  \n\n\n\nb\n```\nx  \n\n\n\ny\n```\n\n\nc\n"),
    "a\n\nb\n```\nx  \n\n\n\ny\n```\n\nc",
  );
});
