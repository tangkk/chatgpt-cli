import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import net from "node:net";
import { execFileSync, spawn } from "node:child_process";
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

export function chromeUserAgent(executable = chromeExecutable()) {
  const output = execFileSync(executable, ["--version"], { encoding: "utf8" });
  const version = output.match(/(\d+(?:\.\d+){3})/)?.[1];
  if (!version) throw new Error(`Could not determine Chrome version from: ${output.trim()}`);
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

export function cdpChromeArgs({ headed = false, port, userAgent }) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("A valid CDP port is required.");
  }
  return [
    `--user-data-dir=${profileDir()}`,
    "--profile-directory=Default",
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=http://127.0.0.1",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    ...(headed ? [] : ["--headless=new", "--mute-audio", `--user-agent=${userAgent}`]),
    "about:blank",
  ];
}

async function reservePort() {
  const server = net.createServer();
  server.unref();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (!port) throw new Error("Could not reserve a local CDP port.");
  return port;
}

async function waitForCdp(port, child, { timeoutMs = 20_000 } = {}) {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Dedicated Chrome exited before CDP was ready (code ${child.exitCode}).`);
    }
    try {
      const response = await fetch(`${endpoint}/json/version`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return endpoint;
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the dedicated Chrome CDP endpoint.");
}

async function stopChrome(browser, child) {
  await browser?.close().catch(() => {});
  if (!child || child.exitCode !== null) return;
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGTERM");
}

export async function launchBrowser({ headed = false } = {}) {
  ensureProfileDir();
  const executable = chromeExecutable();
  if (!fs.existsSync(executable)) {
    throw new Error(
      `Google Chrome was not found at ${executable}. Set CHATGPT_WEB_CLI_CHROME to its executable path.`,
    );
  }

  const port = await reservePort();
  const userAgent = headed ? undefined : chromeUserAgent(executable);
  const child = spawn(executable, cdpChromeArgs({ headed, port, userAgent }), {
    stdio: "ignore",
    detached: false,
  });
  await Promise.race([
    once(child, "spawn"),
    once(child, "error").then(([error]) => Promise.reject(error)),
  ]);

  const killOnExit = () => {
    if (child.exitCode === null) child.kill("SIGTERM");
  };
  process.once("exit", killOnExit);

  let browser;
  try {
    const endpoint = await waitForCdp(port, child);
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    if (!context) throw new Error("Dedicated Chrome did not expose a browser context.");
    const pages = context.pages();
    const page = pages[0] || (await context.newPage());
    page.setDefaultTimeout(15_000);

    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      process.removeListener("exit", killOnExit);
      await stopChrome(browser, child);
    };
    return { browser, context, page, child, port, close };
  } catch (error) {
    process.removeListener("exit", killOnExit);
    await stopChrome(browser, child);
    throw error;
  }
}
