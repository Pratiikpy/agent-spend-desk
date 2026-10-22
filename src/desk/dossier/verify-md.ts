/** The VERIFY.md shipped inside every dossier: one page, readable by someone who has never seen the Desk. */
export const VERIFY_MD = `# How to check this dossier

This folder is a signed record of what the Desk computed and the rows it computed it from. You do not need the Desk,
a network connection or an account to check it.

1. Get the signer's public key from the person who sent you this dossier, by a channel other than this folder, and
   save it as \`pins.json\` (\`desk keys pin\` prints it).
2. Run \`desk-verify <this folder> --pins pins.json\`.

The verifier prints one line per level and an overall PASS, FAIL or INDETERMINATE. Without \`--pins\` the overall
result is always INDETERMINATE, because nothing proves who signed it.

| Level | What it checks |
|---|---|
| V0 | The folder holds exactly the files a dossier has, with safe names and sane sizes |
| V1 | Every file is well formed, in canonical JSON, with no unknown field |
| V2 | Every file matches the hash in the manifest; every row hashes to its row_hash and links to the row before it |
| V3 | The statement is signed by a pinned key and commits to the manifest |
| V4 | Every cited row is included in the signed checkpoint (RFC 9162 inclusion proof) |
| V5 | Every quote is found in its evidence at the stated place |
| V6-D | Each number is recomputed from the cited rows, price snapshots and policy versions, and equals the shown value |
| V7-D | The restrict-only check is run again on the bundled policy versions and gives the recorded result |
| V8-D | Every figure in every displayed sentence matches a recomputed claim, with the right cost class |
| VA | An approval receipt, if any, is signed and names the same action as this dossier |

## What PASS means

The rows are the rows the Desk's log committed to, the numbers follow from the rows by the stated computations, and
the policy check reproduces.

## What PASS does not mean

It does not mean the agent logs were truthful, that estimated dollars equal the invoice, that a judge model's score
is correct, or that the signer did not log false rows consistently. A signature proves who vouches for the record,
not that the record is right. Estimated dollars are list-price estimates from logged tokens, never a bill.
`;
