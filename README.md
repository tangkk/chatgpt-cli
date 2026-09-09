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
- Starts new conversations through ChatGPT's in-page control, avoiding a
  foreground-stealing AppleScript URL navigation.
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

You can also run `chatgpt-web` over SSH. The Mac must still have an active,
unlocked desktop login with Chrome running. A ChatGPT tab may remain hidden in
the desktop session when controlled from SSH; the client waits for an explicit
completed-response control and a short period of stable text before printing
the reply.

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
/back                       Return to the conversation list
/quit                       Exit
```

## Independent background Chrome (CDP)

For SSH use while the desktop is locked, the client can start an independent
Chrome process and connect to it through a loopback-only Chrome DevTools
Protocol (CDP) port. This mode uses a separate Chrome profile and does not read
or modify your regular Chrome profile.

Sign in once while the desktop is unlocked:

```bash
chatgpt-web background-login
```

The dedicated window closes automatically after the ChatGPT session is
detected. While the desktop is still unlocked, start the background client in
tmux and detach it:

```bash
tmux new -s chatgpt-background
chatgpt-web background
# Press Ctrl-B, then D
```

After locking, reconnect over SSH and resume that same process with
`tmux attach -t chatgpt-background`. Do not start a new background Chrome after
macOS is already locked: Chrome may be unable to decrypt its keychain-backed
cookies. The client detects this state and refuses the unsafe launch.

For unlocked-session diagnostics, `background-status`, `background-list`, and
`background-new` remain available.

`background` launches Chrome with `--headless=new` and disables Chrome's
background rendering throttles. The CDP endpoint listens only on
`127.0.0.1` and exists only while the command is running. The legacy command
names `login`, `status`, `list`, `chat`, and `new` remain as aliases.

Some identity providers may reject a browser with remote debugging enabled. If
Google sign-in refuses the dedicated browser, use another sign-in method offered
by ChatGPT where possible. This mode cannot copy authentication from your
regular Chrome profile.

The isolated profile is stored under `CHATGPT_WEB_CLI_HOME` and must never be
committed, shared, or copied to an untrusted machine. Treat it like a password.

## Security model

- No credentials, cookies, browser storage, or conversation transcripts are
  written to this repository.
- Existing-Chrome mode executes JavaScript only in tabs whose URL starts with
  `https://chatgpt.com/`.
- Background mode exposes CDP on a random loopback port only while the command
  is running. Its dedicated profile remains mode `0700` under
  `CHATGPT_WEB_CLI_HOME`.
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
- Background mode requires a one-time headed login and may occasionally require
  reauthentication when ChatGPT expires the dedicated profile's session.

## License

No license has been granted yet. Add a license before accepting external
contributions or reuse.
