import { readFileSync, statSync } from "node:fs";

import { hashJson } from "../../runtime/canonical.ts";
import { policyToDoc } from "../policy/doc.ts";
import { parsePolicyYaml } from "../policy/parse.ts";
import type { Policy } from "../policy/types.ts";
import { GateError } from "./types.ts";

export interface PolicyView {
  policy: Policy;
  version: number;
  digest: string;
}

/** Where the gate reads its policy. `current` throws when the policy cannot be read: the gate then refuses everything. */
export interface PolicySource {
  current(): PolicyView;
}

function view(policy: Policy): PolicyView {
  return { policy, version: policy.version, digest: hashJson(policyToDoc(policy)) };
}

export function fixedPolicy(policy: Policy): PolicySource {
  const v = view(policy);
  return { current: () => v };
}

/**
 * A policy file, re-read when its size or modification time changes. A file that has become unreadable or
 * invalid is an error on every call, not the last good copy: a policy the owner broke must not keep
 * allowing what the broken edit was meant to stop.
 */
export function filePolicy(path: string): PolicySource {
  let stamp = "";
  let cached: PolicyView | undefined;
  return {
    current() {
      try {
        const st = statSync(path);
        const next = `${st.size}:${st.mtimeMs}`;
        if (cached === undefined || next !== stamp) {
          cached = view(parsePolicyYaml(readFileSync(path, "utf8")));
          stamp = next;
        }
        return cached;
      } catch (error) {
        cached = undefined;
        stamp = "";
        throw new GateError("E_POLICY_UNAVAILABLE", `policy ${path} cannot be used: ${error instanceof Error ? error.message : String(error)}`, 503);
      }
    },
  };
}
