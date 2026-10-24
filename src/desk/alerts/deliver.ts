import { spawnSync } from "node:child_process";

import type { AlertEvent } from "./engine.ts";

/**
 * Where an alert goes. The terminal always works. A desktop notification uses what the system has (a balloon on Windows,
 * `osascript` on macOS, `notify-send` elsewhere). A webhook is off unless a URL is given; it receives the title, the
 * body, the state and the evidence command, nothing else, and a failure is logged and retried a few times, never thrown
 * and never allowed to hold up anything that matters. A command channel runs a program of the owner's choosing with the
 * alert in environment variables, not in its arguments.
 */
export interface Channels {
  terminal?: boolean;
  desktop?: boolean;
  webhook?: string;
  /** A program and arguments to run; DESK_ALERT_TITLE, DESK_ALERT_BODY, DESK_ALERT_STATE and DESK_ALERT_EVIDENCE are set. */
  command?: string[];
}

export interface DeliveryDeps {
  fetch: typeof fetch;
  run: (program: string, args: string[], env: Record<string, string>) => { status: number | null; error?: string };
  sleep: (ms: number) => Promise<void>;
  print: (line: string) => void;
  platform: string;
  /** Delivery attempts for a webhook before it is given up on. */
  webhookAttempts?: number;
  webhookTimeoutMs?: number;
}

export const realDeps = (): DeliveryDeps => ({
  fetch,
  run: (program, args, env) => {
    const r = spawnSync(program, args, { env: { ...process.env, ...env }, timeout: 15_000, windowsHide: true, stdio: "ignore" });
    return r.error ? { status: null, error: r.error.message } : { status: r.status };
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  print: (line) => console.log(line),
  platform: process.platform,
});

export type Delivered = AlertEvent["delivered"];

const ICON: Record<string, string> = { ALERT: "ALERT", WARNING: "WARNING" };

export function formatForTerminal(a: Pick<AlertEvent, "state" | "title" | "body" | "evidence">): string {
  return `${ICON[a.state] ?? a.state}  ${a.title}\n         ${a.body}\n         See: ${a.evidence}`;
}

/** The desktop notification command for a platform. The text goes through the environment, never into the command line. */
export function desktopCommand(platform: string): { program: string; args: string[] } {
  if (platform === "darwin") return { program: "osascript", args: ["-e", 'display notification (system attribute "DESK_ALERT_BODY") with title (system attribute "DESK_ALERT_TITLE")'] };
  if (platform === "win32") {
    const script =
      "Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Warning; $n.Visible = $true; " +
      "$n.ShowBalloonTip(10000, $env:DESK_ALERT_TITLE, $env:DESK_ALERT_BODY, [System.Windows.Forms.ToolTipIcon]::Warning); Start-Sleep -Seconds 11; $n.Dispose()";
    return { program: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", script] };
  }
  return { program: "notify-send", args: ["--app-name=desk", "--"] };
}

export async function deliver(a: AlertEvent, ch: Channels, deps: DeliveryDeps): Promise<Delivered> {
  const out: Delivered = [];
  const env = { DESK_ALERT_TITLE: a.title, DESK_ALERT_BODY: a.body, DESK_ALERT_STATE: a.state, DESK_ALERT_EVIDENCE: a.evidence };
  if (ch.terminal !== false) {
    deps.print(formatForTerminal(a));
    out.push({ channel: "terminal", ok: true, detail: "printed" });
  }
  if (ch.desktop) {
    const d = desktopCommand(deps.platform);
    // notify-send takes its text as arguments, after `--` so that it is never read as an option; the other two read the environment.
    const args = deps.platform === "darwin" || deps.platform === "win32" ? d.args : [...d.args, a.title, a.body];
    const r = deps.run(d.program, args, env);
    out.push({ channel: "desktop", ok: r.status === 0, detail: r.error ?? (r.status === 0 ? "shown" : `exit ${r.status}`) });
  }
  if (ch.command && ch.command.length > 0) {
    const r = deps.run(ch.command[0]!, ch.command.slice(1), env);
    out.push({ channel: "command", ok: r.status === 0, detail: r.error ?? (r.status === 0 ? "ran" : `exit ${r.status}`) });
  }
  if (ch.webhook) out.push(await webhook(a, ch.webhook, deps));
  return out;
}

async function webhook(a: AlertEvent, url: string, deps: DeliveryDeps): Promise<Delivered[number]> {
  const attempts = deps.webhookAttempts ?? 3;
  let last = "";
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), deps.webhookTimeoutMs ?? 5000);
      const res = await deps.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "desk", state: a.state, title: a.title, body: a.body, evidence: a.evidence, key: a.key, at: a.ts }), signal: ctl.signal });
      clearTimeout(timer);
      if (res.ok) return { channel: "webhook", ok: true, detail: `HTTP ${res.status}` };
      last = `HTTP ${res.status}`;
      // A client error will not get better by asking again.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
    } catch (e) {
      last = (e as Error).name === "AbortError" ? "timed out" : (e as Error).message;
    }
    if (i < attempts) await deps.sleep(250 * 2 ** (i - 1));
  }
  return { channel: "webhook", ok: false, detail: `${last} (gave up after ${attempts} attempt${attempts === 1 ? "" : "s"})` };
}
