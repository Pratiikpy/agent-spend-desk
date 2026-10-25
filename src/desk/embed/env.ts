import { jsonlEgress } from "../security/egress.ts";
import { profileOf } from "../security/net.ts";
import { CassetteEmbedder, DEFAULT_EMBED_MODEL, LiveEmbedder, ReplayOrRecordEmbedder, type Embedder } from "./port.ts";

export interface EmbedderChoice {
  embedder: Embedder | null;
  /** In words, where the vectors come from: shown beside the model route, never a claim the run did not make. */
  label: string;
}

/**
 * Which embedder a run uses. In sample mode the recorded vectors, which need no key and no network. Live, only when `DESK_EMBED=on`, because it sends the text of questions and of
 * the owner's notes to the embedding endpoint (NVIDIA's, with the NVIDIA settings or `DESK_EMBED_*`), and the Desk sends nothing off the machine that it was not told to; it records
 * what the endpoint returns when `record` is on so that a later sample-mode run can replay it. With none of these, no embedder: Scout Intent and the owner's memory keep their
 * built-in text comparison, and say so. `force` is for the commands whose whole purpose is to call the endpoint (recording vectors).
 */
export function embedderFromEnv(env: Record<string, string | undefined>, cassetteDir: string, opts: { sampleMode: boolean; record?: boolean; noModel?: boolean; force?: boolean }): EmbedderChoice {
  if (opts.noModel) return { embedder: null, label: "no embedder (--no-model): the built-in text comparison runs" };
  const model = env["DESK_EMBED_MODEL"] ?? DEFAULT_EMBED_MODEL;
  if (opts.sampleMode) return { embedder: new CassetteEmbedder(cassetteDir, model), label: `recorded ${model} vectors (sample mode)` };
  if (!opts.force && env["DESK_EMBED"]?.trim().toLowerCase() !== "on") return { embedder: null, label: "embeddings are off: the built-in text comparison runs (DESK_EMBED=on sends questions and notes to the embedding endpoint)" };
  const baseUrl = env["DESK_EMBED_BASE_URL"] ?? env["NVIDIA_BASE_URL"];
  const apiKey = env["DESK_EMBED_API_KEY"] ?? env["NVIDIA_API_KEY"];
  if (!baseUrl || !apiKey) return { embedder: null, label: "no embedding endpoint configured: the built-in text comparison runs" };
  const egressPath = env["DESK_EGRESS_LOG"] ?? "data/desk/egress.jsonl";
  const live = new LiveEmbedder({ baseUrl, apiKey, model, profile: profileOf(env), ...(egressPath === "off" ? {} : { onEgress: jsonlEgress(egressPath) }) });
  return { embedder: opts.record ? new ReplayOrRecordEmbedder(live, cassetteDir) : live, label: `${model} through ${new URL(baseUrl).hostname}${opts.record ? ", recording" : ""}` };
}
