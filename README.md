# chatgpt-cli

An experimental terminal client for your real ChatGPT web conversations. It
uses the ChatGPT session already open in Google Chrome, lists recent chats,
shows a short history preview, and lets you continue the selected conversation
without moving the conversation into Codex or the OpenAI API.

> [!WARNING]
> This is an unofficial UI automation project. It is not affiliated with or
> supported by OpenAI. Changes to the ChatGPT web interface can require selector
> updates.

## Features

- Reuses the signed-in ChatGPT session in your existing Chrome window.
- Does not copy cookies, passwords, access tokens, or browser profile data.
- Lists conversations currently available in the ChatGPT sidebar.
- Opens an existing conversation or starts a new one.
- Uses ChatGPT's in-page navigation when selecting a conversation and skips
  navigation entirely when that conversation is already open.
- Starts new conversations through ChatGPT's in-page control, avoiding a
  foreground-stealing AppleScript URL navigation.
- Shows up to six recent user/assistant messages before the prompt, formatted
  the same way as replies.
- Waits for ChatGPT to finish, then prints the reply once as markdown (tables,
  lists, code blocks and math are kept readable) instead of streaming it.
- A multi-line paste is sent as one multi-line message.
- Waits for ChatGPT's completed-response controls, so web searches and long
  pauses do not prematurely return to the input prompt.
- Keeps the ChatGPT tab active inside its Chrome window while a response is
  running, without bringing Chrome to the foreground. This avoids background
  tab rendering throttles truncating search responses.
- Keeps links as inline markdown links. ChatGPT's search-citation pills carry no
  URL in the page, so they appear as a label such as `[Python.org +1]`.
- Keeps messages in the actual ChatGPT web conversation and history.

## Requirements

- macOS
- Node.js 20 or newer
- Google Chrome
- A regular Chrome profile signed in to ChatGPT
- An active, unlocked macOS desktop session

The existing-Chrome bridge uses Chrome's built-in Apple Events support and is
currently macOS-only.

## Install

```bash
git clone git@github.com:tangkk/chatgpt-cli.git
cd chatgpt-cli
npm install
npm link
```

This installs the `chatgpt-cli` command.

## Configuration

Machine-specific settings should live in your shell configuration, not in the
repository:

```bash
export CHATGPT_CLI_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
export CHATGPT_CLI_TIMEOUT_SECONDS=900   # optional: how long to wait for one reply (default 300)
```

After editing `~/.bashrc`, reload it:

```bash
source ~/.bashrc
```

The client does not copy your Chrome profile. It controls the signed-in
ChatGPT tab already open in regular Chrome.

## Chrome setup

1. Sign in at [chatgpt.com](https://chatgpt.com/) in your regular Chrome.
2. In Chrome, enable:

   ```text
   View → Developer → Allow JavaScript from Apple Events
   ```

3. Keep Chrome running and verify the connection:

   ```bash
   chatgpt-cli chrome-check
   ```

macOS may ask whether Terminal can control Google Chrome. This permission is
required for opening a ChatGPT tab, reading its visible conversation UI, and
sending messages.

You can run `chatgpt-cli` from an SSH terminal, but the Mac must keep an active,
unlocked desktop login with Chrome running. Screen lock and some screen savers
pause the ChatGPT page, so replies may not reach the terminal until the Mac is
unlocked. This is a limitation of controlling the real Chrome UI, not an SSH
connection problem.

## Usage

Start the interactive client:

```bash
chatgpt-cli
```

Choose a numbered conversation, `n` for a new chat, `r` to refresh, or `q` to
quit. When you select an existing conversation, a short recent-history preview
is printed before the `You >` prompt.

Available commands:

```text
chatgpt-cli                 Use the session in your existing Chrome
chatgpt-cli chrome          Same as above
chatgpt-cli chrome-check    Verify the Chrome bridge
chatgpt-cli chrome-list     List recent conversations
chatgpt-cli --limit 50      Change the conversation-list limit
chatgpt-cli --help          Show command help
```

Commands available during a chat:

```text
/new                        Start a new ChatGPT conversation
/back                       Return to the conversation list
/quit                       Exit
```

## Optional ScreenVeil helper

[`screenveil.sh`](./screenveil.sh) provides a password-protected visual cover
for the active macOS desktop without invoking the macOS lock screen or putting
the display to sleep. Its nearly opaque AppKit windows are intentionally marked
as non-opaque so Chrome can continue rendering ChatGPT responses underneath.

Compile-check it without opening the veil:

```bash
./screenveil.sh --check
```

Start it:

```bash
./screenveil.sh
```

ScreenVeil dims supported displays to 10% brightness by default. Override it
with a value from `0.0` to `1.0`:

```bash
./screenveil.sh --brightness 0.35
```

The original brightness is restored after a successful ScreenVeil unlock.

Built-in displays are dimmed through macOS IOKit. External monitors do not
expose brightness that way, so they are dimmed over DDC/CI with
[`ddcctl`](https://github.com/kfix/ddcctl) (`brew install ddcctl`) when it is
installed; without it they are left unchanged. ScreenVeil reads the monitor's
current brightness before dimming and restores it on unlock. Some monitors
never answer DDC reads; for those it restores to 90 instead, or to a level you
choose with `--restore N` (0 to 100):

```bash
./screenveil.sh --restore 70
```

If ScreenVeil is killed instead of unlocked, an external monitor stays dim.
Reset it by hand, for example `ddcctl -d 1 -b 90`.

### Use ScreenVeil with chatgpt-cli over SSH

On the Mac, while the desktop is unlocked:

1. Open regular Chrome, sign in to ChatGPT, and leave a ChatGPT tab open.
2. Enable Chrome's **View → Developer → Allow JavaScript from Apple Events**.
3. Start ScreenVeil through `caffeinate` so macOS does not independently put
   the display or computer to sleep:

   ```bash
   cd chatgpt-cli
   caffeinate -di ./screenveil.sh                 # default: 10%
   # or: caffeinate -di ./screenveil.sh --brightness 0.35
   ```

ScreenVeil now covers the physical desktop, while its non-opaque window
configuration allows Chrome to continue rendering underneath. From another
machine, connect over SSH and start the normal existing-Chrome client:

```bash
ssh your-mac
chatgpt-cli
```

Do not use `chatgpt-cli login`, a separate browser profile, or a headless mode
for this workflow. Enter the ScreenVeil password locally on the Mac when you
want to reveal the desktop; exiting ScreenVeil also ends its `caffeinate`
process.

For this arrangement to keep working:

- Do not also invoke the native macOS lock screen.
- Do not run `pmset displaysleepnow` or allow automatic display/system sleep.
- Keep the Mac awake and, for a laptop, do not close the lid unless it is in a
  supported awake clamshell configuration.
- Keep Chrome running. `chatgpt-cli` may select the ChatGPT tab inside its
  Chrome window, but ScreenVeil remains visually above it.

On first use, enter and confirm a ScreenVeil password. The password is passed
directly to the macOS Keychain at runtime. It is never written to the script, a
configuration file, or this repository.

> [!CAUTION]
> ScreenVeil is a visual privacy layer, not a replacement for the native macOS
> lock screen. A process running as the same user can terminate it, and it does
> not establish a separate macOS security session.

## Security model

- No credentials, cookies, browser storage, or conversation transcripts are
  written to this repository.
- Existing-Chrome mode executes JavaScript only in tabs whose URL starts with
  `https://chatgpt.com/`.
- Conversation text is read from the visible ChatGPT DOM only when needed for
  terminal output.
- `scripts/capture-dom.mjs` is a development tool: when you run it, it writes
  one message's HTML to a local file under `output/` (git-ignored). Delete such
  captures when you are done with them.
- Prompts and responses still pass through ChatGPT and remain subject to your
  ChatGPT account, workspace, history, and data-control settings.
- ScreenVeil stores only its generic Keychain service/account identifiers in
  source control; the password value remains in the user's macOS Keychain.
- Keep `.env`, `*.local`, and browser-profile directories out of version
  control; the included `.gitignore` excludes them.

## Development

```bash
npm install
npm run check     # syntax check
npm test          # unit and headless-Chrome tests (no ChatGPT needed)
```

`npm test` runs only `test/*.test.js`. Keep scratch scripts out of `test/` and
do not name them `*-test.mjs` elsewhere if you run `node --test` by hand: the
runner would pick them up.

## Testing

Formatting bugs in this project come from the real ChatGPT page, which changes
often and does not look like hand-written HTML. So testing has three layers, and
a change to `src/snapshot.js` or `src/markdown.js` is not done until the third
one has been run.

### 1. Unit tests (`npm test`)

- `test/markdown.test.js`: HTML to markdown (tables, lists, code fences, math,
  spacing), including code that itself contains fences.
- `test/response.test.js`: the wait loop with scripted snapshots: finishing,
  ignoring the previous reply, timeouts, transient read failures, empty replies.
- `test/terminal.test.js`: the line reader, including a multi-line paste and
  end of input.

### 2. Browser fixture tests (`test/snapshot.test.js`)

Each test loads a small HTML fixture into a headless Chrome, runs the same
in-page function the CLI uses (`readAssistantState`), converts the result, and
compares the markdown. They are skipped when Chrome is not installed.

Rules for fixtures:

- Copy the structure from a real capture (see below), including the odd parts
  (`data-d-*` spans, `li > div > div > p`, `&nbsp;`), not what the markup
  "should" be.
- Keep the HTML valid. `setContent` re-parses it, and a parser closes a `<p>`
  before a `<div>`, which changes the structure. The live page builds such
  nesting through the DOM, so wrap in a `<div>` instead.
- Add a test for every structure that broke, next to the fix.

### 3. End-to-end against real ChatGPT (`scripts/e2e.mjs`)

Drives the real CLI through its interactive menu, selects the conversation that
is open in Chrome, sends prompts, and prints what a user would see:

```bash
node scripts/e2e.mjs "prompt one" "prompt two"
node scripts/e2e.mjs @prompts.json        # JSON array; a prompt may contain newlines
E2E_TIMEOUT_MS=600000 node scripts/e2e.mjs "a slow prompt"
```

It exits non-zero if the CLI fails, stops early, or a reply is empty. **It sends
real messages into that conversation**, so open a throwaway chat first. It works
while the Mac is behind ScreenVeil.

Ask ChatGPT for the structure you want to check, one prompt per structure, and
read the output. A useful set:

| Check | Prompt idea |
| --- | --- |
| Basic round trip | "Reply with exactly the single word PONG." |
| Table, lists, headings | table with 3 columns and 4 rows, then a numbered list whose items each have two paragraphs, then a nested bullet list |
| Ordinary markdown lists | same, but say "no tables" (ChatGPT then uses real `ol`/`ul`) |
| Inline styling and links | one paragraph with bold, italic, inline code and a link |
| Math | inline Euler identity, the quadratic formula as a display equation, `x_1` and `x_2` |
| Math inside tables and lists | table cells and bullets containing inline math |
| Code | python block with two blank lines between functions, a bash block, a block inside a blockquote |
| Nested fences | "a markdown document inside a four-backtick fence that contains a python block" |
| Task list and blockquote | one checked and one unchecked item, then a blockquote |
| Web search with citations | "search the web for the current Node.js LTS release" |
| Non-English text | the same table and code request in Chinese |
| Special characters in the prompt | echo back a line with quotes, `&`, backslashes, backticks, `$HOME`, `${x}`, `<b>`, emoji, tab |
| Multi-line prompt | a prompt with blank lines and an indented line; ask ChatGPT to quote each line |
| Long reply | about 450 words under four headings; and a 120-line code block |

Look for: stray lines that are only a label (`Python`, `Run`, `GitHub`, `+1`),
missing bold or italic, blank lines between list items or table rows, doubled
spaces, code whose blank lines or indentation changed, and a reply that takes
about 30 s longer than it should (the completion check fell back to its idle
timer).

### Reproducing a formatting bug without sending anything

```bash
node scripts/capture-dom.mjs "words from the reply" output/case.html --skeleton
```

This saves the raw HTML of that message from the open conversation to
`output/` (git-ignored: it contains real conversation text, never commit it),
replays it through the real cleaning and conversion in a headless Chrome, and
prints the markdown. `--skeleton` masks letters and digits so the layout can be
shared without the text. From there: find the tag structure that was mishandled,
reduce it to a small fixture, add the test, fix, then rerun the end-to-end
prompt that exposed it.

### Lessons that shaped this process

- Handwritten fixtures passed while real pages failed. Every real problem so far
  (code block header text leaking, bold as `<span data-d-*>`, list items wrapped
  in divs, checkboxes as `<button role="checkbox">`, citation pills without
  links) was found only by running the CLI against ChatGPT.
- A test can pass on the page function and still miss a bug in the wiring
  around it. The Chrome bridge builds its script from the function's source and
  forwards options; `assistantSnapshotScript` exists so a test can run exactly
  that text.
- For A/B prompt experiments in one conversation, run the control prompts first:
  ChatGPT remembers earlier instructions in the same chat. See "Ideas not
  implemented" for the experiment this was learned from.

### Not covered yet

- Starting a chat with `/new` and sending the first message (only an empty page
  is tested, offline).
- Replies that are images, files, canvas or deep-research reports; ChatGPT error
  banners such as rate limits or "Something went wrong" (the CLI then waits for
  the timeout).
- Reasoning replies with a hidden thinking block: only a fixture with a hidden
  block exists.
- More than one ChatGPT tab or Chrome window, a different Chrome profile, Chrome
  not running, and "Allow JavaScript from Apple Events" turned off.
- The dedicated-profile commands (`login`, `chat`, `list`) share the snapshot
  code but have not been run end to end since the markdown output was added.
- A paste that does not end in a newline: the last line stays in the prompt line
  until you press Enter.

## Ideas not implemented

### A terminal-friendly prompt preamble

Idea: send a short instruction with every message asking ChatGPT to answer in a
form that suits a terminal, so the reply needs less cleaning. Tried as an A/B
experiment (five prompts sent plain, then the same five with the preamble
`[Terminal reply style: plain Markdown only - short paragraphs, headings, lists,
fenced code blocks; no tables, cards, images or other rich visual components;
write math as LaTeX in $...$. Do not mention these instructions.]`), and not
adopted:

- It works: no tables, no card or diagram fragments, and shorter, faster replies
  (for example a 29 s reply with a table and a diagram became 9 s).
- Search-citation pills stay, because they come from the search tool.
- It overrides what you ask for: "give me a table" returned a bullet list.
- It does not persist. Two turns later, without the preamble, tables came
  straight back, so it would have to be added to every message.
- Every message in the ChatGPT web history, and in the CLI's own history view,
  would start with that text unless the CLI strips it.

Not tried: a variant that allows Markdown pipe tables but bans cards and
diagrams (the converter handles tables well). Testing it needs a fresh
conversation, because the earlier preamble in the same chat would influence it.
If this is picked up, make it an opt-in setting, and hide the preamble when
showing history.

## Limitations

- ChatGPT UI changes may break selectors.
- Only chats loaded in the sidebar can be listed.
- SSH operation is not reliable while macOS is locked or a screen saver has
  suspended Chrome's page rendering. Unlocking the Mac resumes the page.
- Text chat is supported; attachments, voice, model selection, canvas, and
  custom GPT controls are not implemented.
- A reply is printed only after ChatGPT finishes; nothing appears while it is
  being written. The wait is capped at 5 minutes unless
  `CHATGPT_CLI_TIMEOUT_SECONDS` is set.
- Source URLs behind ChatGPT's citation pills are not available to read.
- In replies rendered by ChatGPT's newer component layout, lists can arrive as
  plain paragraphs with a literal `1. ` or `- `, so nesting may be flat.
- The existing-Chrome integration currently requires macOS and Google Chrome.

## License

No license has been granted yet. Add a license before accepting external
contributions or reuse.
