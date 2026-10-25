# Sigstore bundles of signed dossiers (DF-102), 2026-10-25

A signed dossier is already an in-toto Statement v1 in a DSSE envelope (`statement.dsse.json`), signed with the owner's Ed25519 key. A Sigstore bundle wraps that same envelope in the shape the Sigstore tools read, so an auditor who has `cosign` and the signer's public key can check a dossier without any program of ours.

## What it does

`desk bundle make <dossier folder>` writes `statement.sigstore.json`, a Sigstore bundle v0.3: the dossier's own payload and signature (the envelope's key id is left empty, so the bundle claims nothing about who signed it that the key does not), the key's id as a hint, an empty transparency-log list, and, when `--tsa URL` names an RFC 3161 authority, a timestamp over the SHA-256 of the signature. `desk bundle verify <bundle> --key signer.pub [--folder DOSSIER] [--tsa-ca CA.pem]` checks it offline: the media type, the signature over the DSSE pre-authentication encoding against the key given (Ed25519 or ECDSA), that the statement is in-toto v1 with the predicate type asked for, that each file named has the sha-256 the statement gives its subject, that the statement's Merkle root is the dossier checkpoint's, and each timestamp (read always, and checked against an authority's CA with `openssl ts -verify` when a CA is given). Any failure prints `ATTESTATION_VERIFICATION_FAILED` and the reason and exits 1; a missing file or key exits 2.

The timestamp request is a TimeStampReq written by hand (RFC 3161 section 2.4.1: SHA-256 imprint, a fresh nonce, the authority's certificate requested). The authority sees a hash of the signature and nothing else.

What the bundle is not, said in its own check output: it has no transparency-log (Rekor) entry and no certificate from a certificate authority, because both need a public service and an identity, and a dossier is signed with a key its owner holds. A verifier is told to skip the log (`--insecure-ignore-tlog`), and the check prints "nothing says this dossier was logged".

## What was run

- The real month dossier on this machine (`data/desk/dossiers/month-2026-09`), bundled and checked with **cosign v3.1.4** (the official release binary, downloaded to a scratch folder): `cosign verify-blob-attestation --key month.pub --bundle month.sigstore.json --new-bundle-format --type urn:desk:dossier:v1 --insecure-ignore-tlog manifest.json` printed `Verified OK`. The Desk's own `desk bundle verify` agreed.
- `tests/desk/sigstore.test.ts` (11 tests): the bundle's shape; a pass against the key and the manifest; fail-closed on a wrong key, an altered payload, an altered signature, a manifest with a byte added, a manifest the statement is not about, a different predicate type, a wrong media type, a bundle that is not an object, no signature, a payload that is not base64, and a key that is not a key; an ECDSA signature accepted and an RSA key refused; **cosign** (when `DESK_COSIGN` points at it) verifying a fixture dossier's bundle and refusing it after a byte of the manifest, and then after a bit of the signature, was changed; the request read by `openssl ts -query` as a SHA-256 request for the right digest with a nonce and the certificate requested; a timestamp granted by a **real authority** (a CA, a timestamping certificate and an HTTP endpoint answering with `openssl ts -reply`), put in the bundle and verified by `openssl ts -verify` over this signature, and refused over another dossier's signature and against a different authority's CA; an authority that answers 503 yielding no bundle and exit 1; the status of a response read as granted, refused and not a response; and the command line, in and out of process, with the exit codes.
- `desk prove` runs `sigstore-bundle-of-the-month-dossier-verifies-and-fails-closed` on the closed sample month.

## Not covered

- **A public timestamp authority.** The timestamps were made by an authority built for the tests, never by a public one (that would send a hash to a third party, and was not done). The request format is the one openssl reads; whether a particular public authority accepts it was not tried.
- **cosign and timestamps.** cosign verified the bundle without a timestamp. Checking a bundle with a timestamp in cosign (it wants a trusted root listing the authority) was not tried; openssl checked the timestamp.
- **Transparency log and certificates.** None. There is no keyless signing and no Rekor entry.
- **ECDSA.** The Desk signs with Ed25519. ECDSA bundles are accepted by the checker and were verified by cosign only for Ed25519 and, in the scratch trial, ECDSA; the Desk does not produce them.
- **Policy audit trails and canary verdicts as their own attestation types.** Month dossiers and policy-change dossiers carry the dossier statement; a separate predicate type for each of the others was not made.
- **The `dossier_attestations` table.** Not made: the bundle is a file beside the dossier.
