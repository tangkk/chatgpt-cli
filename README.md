# chatgpt-web-cli

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
- Shows up to six recent user/assistant messages before the prompt.
- Streams ChatGPT responses in the terminal.
- Waits for ChatGPT's completed-response controls, so web searches and long
  pauses do not prematurely return to the input prompt.
- Keeps the ChatGPT tab active inside its Chrome window while a response is
  running, without bringing Chrome to the foreground. This avoids background
  tab rendering throttles truncating search responses.
- Prints external citation URLs that are otherwise represented only by link
  cards in the web UI.
- Keeps messages in the actual ChatGPT web conversation and history.

## Requirements

- macOS
- Node.js 20 or newer
- Google Chrome
- A signed-in ChatGPT tab

The existing-Chrome bridge uses Chrome's built-in Apple Events support and is
currently macOS-only.

## Install

```bash
git clone git@github.com:tangkk/chatgpt-cli.git
cd chatgpt-cli
npm install
npm link
```

This installs the `chatgpt-web` command.

## Configuration

Machine-specific settings should live in your shell configuration, not in the
repository:

```bash
export CHATGPT_WEB_CLI_HOME="$HOME/Library/Application Support/chatgpt-web-cli"
export CHATGPT_WEB_CLI_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

After editing `~/.bashrc`, reload it:

```bash
source ~/.bashrc
```

`CHATGPT_WEB_CLI_HOME` is used only by the optional isolated-profile fallback.
The recommended existing-Chrome mode does not copy your Chrome profile.

## Chrome setup

1. Sign in at [chatgpt.com](https://chatgpt.com/) in your regular Chrome.
2. In Chrome, enable:

   ```text
   View → Developer → Allow JavaScript from Apple Events
   ```

3. Keep Chrome running and verify the connection:

   ```bash
   chatgpt-web chrome-check
   ```

macOS may ask whether Terminal can control Google Chrome. This permission is
required for opening a ChatGPT tab, reading its visible conversation UI, and
sending messages.

## Usage

Start the interactive client:

```bash
chatgpt-web
```

Choose a numbered conversation, `n` for a new chat, `r` to refresh, or `q` to
quit. When you select an existing conversation, a short recent-history preview
is printed before the `You >` prompt.

Available commands:

```text
chatgpt-web                 Use the session in your existing Chrome
chatgpt-web chrome          Same as above
chatgpt-web chrome-check    Verify the Chrome bridge
chatgpt-web chrome-list     List recent conversations
chatgpt-web --limit 50      Change the conversation-list limit
chatgpt-web --help          Show command help
```

Commands available during a chat:

```text
/new                        Start a new ChatGPT conversation
/quit                       Exit
```

## Optional isolated-profile fallback

The project also contains an experimental Playwright-based mode with a separate
Chrome profile:

```bash
chatgpt-web login
chatgpt-web status
chatgpt-web list
chatgpt-web chat [conversation-id]
chatgpt-web new
```

Some identity providers reject automated browser login. Existing-Chrome mode is
therefore recommended.

The isolated profile is stored under `CHATGPT_WEB_CLI_HOME` and must never be
committed, shared, or copied to an untrusted machine. Treat it like a password.

## Security model

- No credentials, cookies, browser storage, or conversation transcripts are
  written to this repository.
- Existing-Chrome mode executes JavaScript only in tabs whose URL starts with
  `https://chatgpt.com/`.
- Conversation text is read from the visible ChatGPT DOM only when needed for
  terminal output.
- Prompts and responses still pass through ChatGPT and remain subject to your
  ChatGPT account, workspace, history, and data-control settings.
- Keep `.env`, `*.local`, and browser-profile directories out of version
  control; the included `.gitignore` excludes them.

## Development

```bash
npm install
npm run check
npm test
```

## Limitations

- ChatGPT UI changes may break selectors.
- Only chats loaded in the sidebar can be listed.
- Text chat is supported; attachments, voice, model selection, canvas, and
  custom GPT controls are not implemented.
- The existing-Chrome integration currently requires macOS and Google Chrome.

## License

No license has been granted yet. Add a license before accepting external
contributions or reuse.
