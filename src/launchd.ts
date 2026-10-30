import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const LABEL = "app.caret.stet";

export function plistPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * launchd owns the listening socket and starts `stet serve --launchd` on the first connection.
 * With inetdCompatibility Wait=true the socket arrives as fd 0; the server exits when idle.
 */
export function plist(opts: { node: string; cli: string; port: number; vault: string }): string {
  const args = [opts.node, opts.cli, "serve", "--launchd"].map((a) => `    <string>${esc(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>STET_HOME</key>
    <string>${esc(opts.vault)}</string>
  </dict>
  <key>Sockets</key>
  <dict>
    <key>Listener</key>
    <dict>
      <key>SockNodeName</key>
      <string>127.0.0.1</string>
      <key>SockServiceName</key>
      <string>${opts.port}</string>
      <key>SockType</key>
      <string>stream</string>
    </dict>
  </dict>
  <key>inetdCompatibility</key>
  <dict>
    <key>Wait</key>
    <true/>
  </dict>
</dict>
</plist>
`;
}

function domain(): string {
  return `gui/${os.userInfo().uid}`;
}

export function isInstalled(): boolean {
  return fs.existsSync(plistPath());
}

export function install(opts: { node: string; cli: string; port: number; vault: string }): void {
  if (process.platform !== "darwin") throw new Error("on-demand start uses launchd and is only available on macOS");
  uninstall();
  fs.mkdirSync(path.dirname(plistPath()), { recursive: true });
  fs.writeFileSync(plistPath(), plist(opts));
  execFileSync("launchctl", ["bootstrap", domain(), plistPath()], { stdio: "ignore" });
}

export function uninstall(): boolean {
  if (!fs.existsSync(plistPath())) return false;
  try {
    execFileSync("launchctl", ["bootout", `${domain()}/${LABEL}`], { stdio: "ignore" });
  } catch {
    // not loaded
  }
  fs.rmSync(plistPath());
  return true;
}
