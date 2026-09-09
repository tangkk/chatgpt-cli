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

This installs the `chatgpt-web` command.

## Configuration

Machine-specific settings should live in your shell configuration, not in the
repository:

```bash
export CHATGPT_WEB_CLI_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
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
   chatgpt-web chrome-check
   ```

macOS may ask whether Terminal can control Google Chrome. This permission is
required for opening a ChatGPT tab, reading its visible conversation UI, and
sending messages.

You can run `chatgpt-web` from an SSH terminal, but the Mac must keep an active,
unlocked desktop login with Chrome running. Screen lock and some screen savers
pause the ChatGPT page, so replies may not reach the terminal until the Mac is
unlocked. This is a limitation of controlling the real Chrome UI, not an SSH
connection problem.

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

### Use ScreenVeil with chatgpt-web over SSH

On the Mac, while the desktop is unlocked:

1. Open regular Chrome, sign in to ChatGPT, and leave a ChatGPT tab open.
2. Enable Chrome's **View → Developer → Allow JavaScript from Apple Events**.
3. Start ScreenVeil through `caffeinate` so macOS does not independently put
   the display or computer to sleep:

   ```bash
   cd chatgpt-cli
   caffeinate -di ./screenveil.sh
   ```

ScreenVeil now covers the physical desktop, while its non-opaque window
configuration allows Chrome to continue rendering underneath. From another
machine, connect over SSH and start the normal existing-Chrome client:

```bash
ssh your-mac
chatgpt-web
```

Do not use `chatgpt-web login`, a separate browser profile, or a headless mode
for this workflow. Enter the ScreenVeil password locally on the Mac when you
want to reveal the desktop; exiting ScreenVeil also ends its `caffeinate`
process.

For this arrangement to keep working:

- Do not also invoke the native macOS lock screen.
- Do not run `pmset displaysleepnow` or allow automatic display/system sleep.
- Keep the Mac awake and, for a laptop, do not close the lid unless it is in a
  supported awake clamshell configuration.
- Keep Chrome running. `chatgpt-web` may select the ChatGPT tab inside its
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
- Prompts and responses still pass through ChatGPT and remain subject to your
  ChatGPT account, workspace, history, and data-control settings.
- ScreenVeil stores only its generic Keychain service/account identifiers in
  source control; the password value remains in the user's macOS Keychain.
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
- SSH operation is not reliable while macOS is locked or a screen saver has
  suspended Chrome's page rendering. Unlocking the Mac resumes the page.
- Text chat is supported; attachments, voice, model selection, canvas, and
  custom GPT controls are not implemented.
- The existing-Chrome integration currently requires macOS and Google Chrome.

## License

No license has been granted yet. Add a license before accepting external
contributions or reuse.
