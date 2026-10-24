// No imports from the rest of the project: the hook runs this file with plain Node type stripping, and every
// millisecond of start-up is paid on each tool call.

export interface GateClientResult {
  status: number;
  body: unknown;
}

/** The gate is on this machine. The bearer token is sent only to a loopback address, so a wrong DESK_GATE_URL cannot send it elsewhere. */
function assertLoopback(baseUrl: string): void {
  let host = "";
  try {
    host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    throw new Error(`E_EGRESS_UNDECLARED: ${baseUrl.slice(0, 60)} is not an address`);
  }
  if (!(host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host))) {
    throw new Error(`E_EGRESS_UNDECLARED: the gate is on this machine, and ${host} is not a loopback address`);
  }
}

/** Call the gate with a deadline. A timeout, a refused connection or a gate address that is not on this machine rejects: the caller must treat that as "block". */
export async function callGate(baseUrl: string, token: string, path: string, body: unknown, timeoutMs: number): Promise<GateClientResult> {
  assertLoopback(baseUrl);
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text.length === 0 ? null : JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: parsed };
}
