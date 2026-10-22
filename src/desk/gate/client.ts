// No imports from the rest of the project: the hook runs this file with plain Node type stripping, and every
// millisecond of start-up is paid on each tool call.

export interface GateClientResult {
  status: number;
  body: unknown;
}

/** Call the gate with a deadline. A timeout or a refused connection rejects: the caller must treat that as "block". */
export async function callGate(baseUrl: string, token: string, path: string, body: unknown, timeoutMs: number): Promise<GateClientResult> {
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
