import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A real RFC 3161 timestamp authority for tests: a certificate authority, a timestamping certificate, and an HTTP endpoint that answers a TimeStampReq with a TimeStampResp made
 * by `openssl ts -reply`. Nothing is faked: the replies are the ones an authority makes, and `openssl ts -verify` is what checks them.
 */
export function opensslAvailable(): boolean {
  return spawnSync("openssl", ["version"], { windowsHide: true }).status === 0;
}

const run = (cwd: string, args: string[], input?: Buffer): { status: number | null; stdout: Buffer; stderr: string } => {
  const r = spawnSync("openssl", args, { cwd, windowsHide: true, input, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr?.toString("utf8") ?? "" };
};

export interface LocalTsa {
  url: string;
  caPem: string;
  dir: string;
  requests: number;
  /** Make the authority refuse every request, as one that is down or not allowed would. */
  refuse: boolean;
  close(): Promise<void>;
}

export async function startLocalTsa(): Promise<LocalTsa> {
  const dir = mkdtempSync(join(tmpdir(), "desk-tsa-"));
  const ok = (r: { status: number | null; stderr: string }, what: string): void => {
    if (r.status !== 0) throw new Error(`openssl could not ${what}: ${r.stderr.slice(0, 200)}`);
  };
  ok(run(dir, ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-subj", "/CN=desk test ca", "-days", "2"]), "make a CA");
  ok(run(dir, ["req", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", "tsa.key", "-out", "tsa.csr", "-subj", "/CN=desk test tsa"]), "make a request");
  writeFileSync(join(dir, "ext.cnf"), "extendedKeyUsage = critical,timeStamping\nbasicConstraints = CA:FALSE\n");
  ok(run(dir, ["x509", "-req", "-in", "tsa.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "tsa.pem", "-days", "2", "-extfile", "ext.cnf"]), "sign the authority's certificate");
  writeFileSync(join(dir, "tsa.cnf"), ["[tsa]", "default_tsa = tsa_config", "[tsa_config]", "dir = .", "serial = ./tsa.serial", "crypto_device = builtin", "signer_cert = ./tsa.pem", "certs = ./ca.pem", "signer_key = ./tsa.key", "signer_digest = sha256", "default_policy = 1.2.3.4.1", "other_policies = 1.2.3.4.5", "digests = sha256", "accuracy = secs:1", "ordering = yes", "tsa_name = yes", "ess_cert_id_alg = sha256", ""].join("\n"));
  writeFileSync(join(dir, "tsa.serial"), "01\n");
  mkdirSync(dir, { recursive: true });
  const state = { requests: 0, refuse: false };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      state.requests += 1;
      if (state.refuse) {
        res.statusCode = 503;
        res.end("down");
        return;
      }
      writeFileSync(join(dir, "q.tsq"), Buffer.concat(chunks));
      const r = run(dir, ["ts", "-reply", "-queryfile", "q.tsq", "-config", "tsa.cnf", "-out", "r.tsr"]);
      if (r.status !== 0) {
        res.statusCode = 400;
        res.end(r.stderr);
        return;
      }
      res.setHeader("content-type", "application/timestamp-reply");
      res.end(readFileSync(join(dir, "r.tsr")));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/tsa`,
    caPem: readFileSync(join(dir, "ca.pem"), "utf8"),
    dir,
    get requests() { return state.requests; },
    get refuse() { return state.refuse; },
    set refuse(v: boolean) { state.refuse = v; },
    close: () => new Promise<void>((r) => server.close(() => r())),
  } as LocalTsa;
}
