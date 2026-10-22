# NVIDIA: Integration Notes

**Status: use "wherever it contributes". Optional by wording, but the sponsor explanation must state where NVIDIA technology contributes. Facts about the offering: NOT VERIFIED.**

Organizer framing: "NVIDIA: cloud provider" (Power Day, date TBC). Context: `docs/intel/03-sponsor-by-sponsor-expectations.md`.

## Verified facts

| Fact | Value | Source | Date verified |
|---|---|---|---|
| What NVIDIA provides in this hackathon (credits, endpoints, models) | | | |
| How we get access | | | |
| Auth model and credential name(s) | | | |
| Limits and costs | | | |
| Failure modes observed | | | |

## Decision: does NVIDIA genuinely contribute?

Answer with evidence, not wishes. Judges discount "unsupported claims of value."

- [ ] Yes, it is used for: ...
- [ ] No, and the sponsor explanation will say so plainly and why.

Decision date and reasoning go to `docs/DECISIONS.md`.

## Day-one connection test (if used)

- [ ] `tests/test_nvidia_connection.py` (or equivalent)
- [ ] Fallback when unavailable

## Evidence

- [ ] Trace or screenshot of NVIDIA technology executing inside an agent run

## Verified call, 2026-10-16

Source: a live request from this machine with the participant's own key from build.nvidia.com (key in `.env` as `NVIDIA_API_KEY`, never copied elsewhere).

- Endpoint: `https://integrate.api.nvidia.com/v1/chat/completions`, OpenAI-compatible, bearer key. Result: HTTP 200 and a correct one-word reply.
- Model id sent: `nvidia/nemotron-3.5-super-vl-120b-a12b` (the id shown on the build.nvidia.com sample code; a vision-language Super model). The response named the served model `private/nvidia/nemotron-3.5-super-120b-a12b`.
- Sample parameters on the site: temperature 1, top_p 0.95, max_tokens 16384, `seed` 42, `parallel_tool_calls` true, streaming, and `chat_template_kwargs: {"enable_thinking": true}` (reasoning arrives in `delta.reasoning_content`). A request with `enable_thinking` false returned `reasoning_content: null`.
- Env names used here: `NVIDIA_API_KEY`, `NVIDIA_BASE_URL`, `NVIDIA_MODEL`.
- NOT VERIFIED: rate limits and quota for this key, the Nano and Ultra model ids, tool calling and streaming behaviour in our own client, and whether the hackathon route through Meterless uses the same models.
