import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright-core";

const DEFAULT_HOME = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "chatgpt-web-cli",
);

export function dataDir() {
  return process.env.CHATGPT_WEB_CLI_HOME || DEFAULT_HOME;
}

export function profileDir() {
  return path.join(dataDir(), "chrome-profile");
}

function ensureProfileDir() {
  fs.mkdirSync(profileDir(), { recursive: true, mode: 0o700 });
  fs.chmodSync(dataDir(), 0o700);
  fs.chmodSync(profileDir(), 0o700);
}

export function chromeExecutable() {
  return (
    process.env.CHATGPT_WEB_CLI_CHROME ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  );
}

export function loginChromeArgs() {
  return [
    `--user-data-dir=${profileDir()}`,
    "--profile-directory=Default",
    "--no-first-run",
    "--no-default-browser-check",
    "https://chatgpt.com/",
  ];
}

export function ignoredPlaywrightArgs() {
  // The login browser writes Chrome cookies using the macOS system keychain.
  // Playwright normally adds mock/basic keychain flags, which makes the same
  // Chrome profile unable to decrypt those cookies on the next launch.
  return ["--use-mock-keychain", "--password-store=basic"];
}

export async function launchLoginBrowser() {
  ensureProfileDir();
  const executable = chromeExecutable();
  if (!fs.existsSync(executable)) {
    throw new Error(
      `Google Chrome was not found at ${executable}. Set CHATGPT_WEB_CLI_CHROME to its executable path.`,
    );
  }

  const child = spawn(executable, loginChromeArgs(), {
    stdio: "ignore",
    detached: false,
  });

  await Promise.race([
    once(child, "spawn"),
    once(child, "error").then(([error]) => Promise.reject(error)),
  ]);
  return child;
}

export async function closeLoginBrowser(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

export async function launchBrowser({ headed = false } = {}) {
  ensureProfileDir();

  const context = await chromium.launchPersistentContext(profileDir(), {
    channel: "chrome",
    headless: !headed,
    ignoreDefaultArgs: ignoredPlaywrightArgs(),
    viewport: { width: 1360, height: 900 },
    locale: process.env.LANG?.startsWith("zh") ? "zh-CN" : "en-US",
    args: ["--disable-background-networking"],
  });

  const pages = context.pages();
  const page = pages[0] || (await context.newPage());
  page.setDefaultTimeout(15_000);
  return { context, page };
}
