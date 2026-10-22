# Prior art 02: data channels (Agent Reach, LlamaIndex, Haystack)

Date of study: 2026-10-13. Scope: how existing projects acquire, check, bound and secure external data, and what a
"source channel" layer for our TypeScript product should copy and add. Product constraint: it must run fully offline
(`SAMPLE_MODE` cassettes) and live (GLEIF, SEC EDGAR, OFAC SDN list, Wikidata, CourtListener, RSS, Jina Reader).

Conventions used below.

- `AR` = the Agent Reach repo (read-only clone, outside this repo). Paths after `AR:` are relative to its root.
- `LI` = `research/track-1-fragmented-intelligence/llama_index`.
- `HS` = `research/track-1-fragmented-intelligence/haystack`.
- Every claim cites a path and, where useful, a symbol. "Inspection" means read from source, not executed.
- No third-party code was executed. The one exception is a copy of the AR credential-scrub regex that I ran in a scratch
  interpreter against a synthetic URL (section 1.7). Live HTTP probes in section 5 are mine, dated 2026-10-13, and are
  observations of third-party services that can change.
- NOT VERIFIED means I could not establish it from a cited source or a probe.

## 0. Verdict first (what the product owner needs to know)

The instruction was "for data we will use what the Agent Reach repo is doing". Read literally, that is not possible,
because Agent Reach does not contain a data-fetching layer for structured public records.

1. **The Agent Reach `Channel` contract is `can_handle` + `check` only.** There is no `read` or `search` in the base
   class (`AR: agent_reach/channels/base.py`, class `Channel`). The package says so itself: after installation "agents
   call upstream tools directly" (`AR: agent_reach/core.py` docstring; `AR: agent_reach/integrations/mcp_server.py`
   docstring). The only `read()` is on the web channel (`AR: agent_reach/channels/web.py`, `WebChannel.read`); V2EX's
   `search()` is a stub that always returns an error entry (`AR: agent_reach/channels/v2ex.py`, `V2EXChannel.search`).
2. **What Agent Reach is good at is everything around fetching:** honest health probes, a three-valued status that
   refuses to claim "ok" it cannot prove, credential-boundary discipline in the doctor, URL host matching, a public-URL
   policy, symlink-safe private file writes, and a hermetic contract-test suite. Those are worth copying as patterns.
3. **What it does not have, and we must build:** typed fetch results, provenance hashing, a content-addressed cache,
   per-source rate-limit / robots / licence metadata, record/replay cassettes, conditional requests, DNS-pinned SSRF
   defence, streaming size caps, and a machine-gateable doctor (it exits 0 regardless of health).
4. **No existing source covers our structured sources.** Agent Reach has no GLEIF, EDGAR, OFAC, Wikidata or
   CourtListener code. LlamaIndex has an SEC reader that is the best fetch discipline of the three (rate limit + declared
   user agent) but is undermined by silent fallbacks (section 2.3). Haystack has a solid generic fetcher but no URL
   safety (section 3.3).

Recommendation (best first): build our own `SourceChannel` layer that takes Agent Reach's health/security disciplines,
Haystack's content-derived document ids and typed component contract, and LlamaIndex's content-hash transformation
cache, and adds the missing evidence, cassette and licence machinery (section 4 and 6). Use Jina Reader only as the
last-resort generic web backend, never for the structured sources.

---

## 1. Agent Reach

### 1.1 What it is

- An "installer, doctor, and configuration tool" that routes an AI agent to upstream platform tools (gh, yt-dlp,
  twitter-cli, OpenCLI, Jina Reader, mcporter/Exa) (`AR: agent_reach/core.py` docstring; `AR: agent_reach/cli.py` module docstring: "installer, doctor, and configuration tool").
- 16 registered channels (`AR: agent_reach/channels/__init__.py`, `ALL_CHANNELS`), a skill that tells the agent which
  upstream command to run (`AR: agent_reach/skill/SKILL_en.md`, `AR: agent_reach/skill/references/*.md`), and a
  one-tool MCP server (`AR: agent_reach/integrations/mcp_server.py`).
- Python >= 3.10, version 1.5.0 (`AR: pyproject.toml`).
- Platforms are mostly Chinese social networks and developer platforms. None of our target sources are present.

### 1.2 Architecture (file-cited)

**The Channel contract** (`AR: agent_reach/channels/base.py`, `Channel(ABC)`):

| Member | Meaning |
|---|---|
| `name`, `description` | Stable id and display name. Uniqueness and non-emptiness asserted in `AR: tests/test_channel_contracts.py::test_channel_registry_contract`. |
| `backends: List[str]` | Ordered candidate list; `backends[0]` is preferred, the rest are fallbacks. "Switching backends means reordering this list, not rewriting code" (module docstring). |
| `tier: int` | 0 = zero-config, 1 = needs a free key or login, 2 = needs setup. Asserted `in {0,1,2}`. |
| `active_backend: Optional[str]` | The backend serving the channel right now, set by `check()`, `None` when nothing is proven usable. |
| `can_handle(url) -> bool` | Abstract. Does this URL belong to this platform. |
| `ordered_backends(config)` | Candidates in probe order after applying the user override. |
| `check(config) -> (status, message)` | Status is one of `ok`, `warn`, `off`, `error`. Default implementation returns `ok` and sets `active_backend = backends[0]`. |

There is **no** `read`, `search` or `fetch` abstract method. Ad hoc methods exist on individual channels and are not
part of any contract: `WebChannel.read`, `V2EXChannel.get_hot_topics/get_topic/get_user/search`,
`XueqiuChannel.get_stock_quote/search_stock`, `YouTubeChannel.transcribe`.

**Tiers in the registry** (from the `name`/`backends`/`tier` class attributes in `AR: agent_reach/channels/*.py`):

| Tier | Channels (backends, in order) |
|---|---|
| 0 | `github` (gh CLI), `youtube` (yt-dlp), `rss` (feedparser), `exa_search` (Exa via mcporter), `web` (Jina Reader), `v2ex` (V2EX public API) |
| 1 | `twitter` (twitter-cli, OpenCLI, bird CLI legacy), `reddit` (OpenCLI, rdt-cli), `bilibili` (bili-cli, OpenCLI, Bilibili search API), `xiaohongshu` (OpenCLI, xiaohongshu-mcp, xhs-cli), `xiaoyuzhou` (groq-whisper, ffmpeg), `xueqiu` (Xueqiu API with cookie), `facebook` and `instagram` (OpenCLI via `AR: agent_reach/channels/_opencli_site.py`, `OpenCLISiteChannel`) |
| 2 | `linkedin` (mcp-server-linkedin, Jina Reader), `boss` (boss-agent-cli over CDP) |

**Ordered backends and user override.**

- `Channel.ordered_backends` reads `config.get(f"{self.name}_backend")` and promotes the first candidate where
  `b == override or b.startswith(override)` to the front. Unknown values are ignored "so a stale override can never hide
  working backends" (`AR: agent_reach/channels/base.py`). Tested in
  `AR: tests/test_channel_contracts.py::test_ordered_backends_override_moves_backend_to_front` (override `bird`
  selects `bird CLI (legacy)`; override `no-such-tool` leaves order unchanged) and `::test_ordered_backends_contract`
  (result is always a permutation of `backends`).
- The config source is `Config.get` (`AR: agent_reach/config.py`): the YAML file is consulted first, then the upper-cased
  environment variable (`twitter_backend` -> `TWITTER_BACKEND`). **The file wins over the environment**, the opposite of
  the usual 12-factor expectation. The docstring in `base.py` advertises the env var without saying it loses to the file.
- Only channels whose `check()` iterates `ordered_backends(config)` honour the override (`twitter.py`, `reddit.py`,
  `bilibili.py` do). Single-backend channels ignore it.

**Backend selection algorithm** (pattern shared by `AR: agent_reach/channels/twitter.py`, `reddit.py`, `bilibili.py`):

1. Probe every candidate in order and collect `(backend, status, message)`; a candidate that is not installed returns
   `None` and is skipped.
2. First `ok` wins and becomes `active_backend`.
3. If none is `ok`, the first `warn` is reported, **but `active_backend` stays `None`**.
4. If only broken candidates exist, report `error` with all messages joined; if nothing is installed, report `off`.
5. Bilibili additionally appends "[alternate backend broken]" notes when a fallback succeeds
   (`AR: agent_reach/channels/bilibili.py`, `broken_notes`), so a broken primary is never hidden by a working fallback.

The two-pass comment in `twitter.py` records the bug this fixes: an installed-but-not-logged-in primary used to block a
fully working fallback.

**Cross-channel backend.** `AR: agent_reach/backends/opencli.py` models OpenCLI (one browser-session runtime serving
several channels) as `OpenCLIStatus(installed, broken, daemon_running, extension_connected, extension_installed,
unpacked_extension_files, version, hint)` with a `ready` property that is true **only** when the live daemon reports
the browser extension connected. Files on disk are explicitly "not proof".

**Core objects.** `AR: agent_reach/core.py` (`AgentReach.doctor`, `doctor_report`), `AR: agent_reach/doctor.py`
(`check_all`, `format_report`), `AR: agent_reach/config.py` (`Config`), `AR: agent_reach/probe.py` (`probe_command`).
Channels are module-level singleton instances in `ALL_CHANNELS`, and `check()` mutates `active_backend` on them
(concurrency hazard; the doctor has a guard for stale state, section 1.4).

### 1.3 The real health probe (why `shutil.which` is not proof)

`AR: agent_reach/probe.py`, `probe_command(cmd, args=("--version",), timeout=10, retries=0, package, env, remove_env)`
returns `ProbeResult(status, output, hint)` with status in `ok | missing | broken | timeout | error`.

- `missing`: `shutil.which(cmd)` is `None`.
- `broken`: `which()` found a file but exec failed (`FileNotFoundError`/`OSError`) or exit code was 126 or 127. The
  documented cause is a **stale venv shebang after a system Python upgrade**: pipx/uv shims stay on PATH, `which()`
  returns them, and they cannot run. The hint is a concrete reinstall prescription (`reinstall_hint`:
  `uv tool install --force <pkg>` or `pipx reinstall <pkg>`).
- `timeout`: `subprocess.TimeoutExpired`.
- `error`: ran, exited non-zero.
- Retries re-run the command verbatim with no backoff, and only for `timeout`/`error`; `missing`/`broken` return
  immediately because they cannot heal between attempts. The docstring restricts probes to side-effect-free commands.
- The child environment is built from `utf8_subprocess_env()` (`AR: agent_reach/utils/process.py`), with per-probe
  additions (`env`) and removals (`remove_env`) that never mutate the parent process.
- Tests: `AR: tests/test_probe.py` (`test_broken_shebang_detected_as_broken`, `test_exit_127_classified_as_broken`,
  `test_retries_help_transient_failures`, `test_probe_child_env_can_add_and_remove_without_mutating_parent`).

Probes are designed around **side effects**, which is the part worth copying:

- `AR: agent_reach/channels/github.py`: `gh --version` is run with `GH_TELEMETRY=false`, `DO_NOT_TRACK=true` and update
  notifiers off, because gh 2.92 writes a device-id file even for `--version`. `gh auth status` is deliberately never
  run (it would write that file).
- `AR: agent_reach/backends/opencli.py`: `opencli doctor` auto-starts a daemon and current OpenCLI mutates `~/.opencli`
  before `daemon status`, so the probe runs `--version` only and reads live state from the daemon's loopback
  `http://127.0.0.1:19825/status`, with proxies bypassed (`ProxyHandler({})`), a 2 s cap and a 64 KiB cap.
- `AR: agent_reach/channels/twitter.py`: upstream `twitter status` silently falls back to reading browser cookies on
  invalid credentials, so the doctor refuses to run it and only inspects explicit credentials. Same reasoning for
  `rdt status` in `AR: agent_reach/channels/reddit.py` and for xiaohongshu.

**Honest three-way outcome.** Where a real end-to-end check would break the doctor's own no-side-effect or
no-credential-read rules, the channel returns `warn` with an explicit "not verified live" message and leaves
`active_backend = None` (`github.py`, `twitter.py`, `reddit.py`, `exa_search.py`, `linkedin.py`,
`_opencli_site.py`). The skill states the consequence: "`active_backend: null` means Doctor deliberately skipped a live
probe ... not that no backend exists" and tells the agent to verify with a read-only task command before relying on it
(`AR: agent_reach/skill/SKILL_en.md`, standing rule 1). Success is "non-empty content", not exit code
(`AR: agent_reach/skill/references/video.md`, `finance.md`).

**Critique of the probe design.**

- Inconsistent depth: `v2ex`, `xueqiu` and `bilibili` make real HTTP calls in `check()`; `rss` only does
  `import feedparser`; `web` returns `ok` unconditionally with a comment that it does no network probe
  (`AR: agent_reach/channels/web.py`, `WebChannel.check`). The channel agents lean on most is the one never probed.
- Consequence: tier-0 `github` can **never** report `ok` in this commit: every post-probe branch of
  `GitHubChannel.check` returns `warn` (`AR: agent_reach/channels/github.py`). The report's headline `ok/total`
  (`format_report`) is therefore structurally low even on a perfect machine.
- There is no per-task canary. "Verified" means "the CLI starts", never "this request returns this content". YouTube's
  check explicitly says it does not request a video (`video.md`, retry-chain preface).
- Probes run sequentially inside `check_all`; there is no global time budget, so worst-case doctor time is the sum of
  per-probe timeouts (inspection; not measured).

### 1.4 Doctor design and credential scrubbing

`AR: agent_reach/doctor.py`:

- `check_all(config)` calls each channel's `check`, wrapped so "a single misbehaving channel must never take the whole
  report down": an exception becomes `status="error"`, `message="体检异常：..."`, and `active_backend=None` (the
  stale-state guard, tested in `AR: tests/test_doctor.py::test_stale_active_backend_does_not_leak_into_errored_result`).
- **Every message is passed through `scrub_url_credentials` at the output boundary**, covering expected messages and
  exception text alike. Tested in `AR: tests/test_doctor.py::test_channel_exception_credentials_are_scrubbed` and
  `::test_channel_success_message_credentials_are_scrubbed`.
- Result shape per channel (the machine contract): `{status, name, message, tier, backends, active_backend}`, emitted by
  `agent-reach doctor --json` (`AR: agent_reach/cli.py`, `_cmd_doctor`, `--json` flag).
- `format_report` groups by tier, prints `ok/total`, shows the active backend only when a channel has more than one
  backend, collapses inactive optional channels into one line, and warns on POSIX when `config.yaml` is group/other
  readable.
- The doctor opens config **read-only** (`Config(read_only=True)`) and is verified zero-write:
  `AR: tests/test_home_isolation.py::test_doctor_leaves_sandbox_home_unchanged` asserts the sandbox home is still empty
  after a run, and `AR: tests/test_doctor.py::test_real_doctor_path_is_zero_write_and_never_runs_risky_status_commands`
  runs the real collector with a fake `subprocess.run` that fails the test on `auth status`, `status`, `daemon status`
  or any mcporter call.
- Credential boundary tests: `AR: tests/test_doctor_credential_boundaries.py` installs `_forbid_subprocess` and asserts
  Twitter, Reddit and XiaoHongShu checks never execute the upstream CLI, never create missing credential files and never
  refresh them.

**Scrubbing** (`AR: agent_reach/utils/text.py`, `scrub_url_credentials`): three regexes redact URL userinfo
(`scheme://user:pw@`), bare `user:pw@host`, and query/fragment values whose key is one of `access_token`, `auth_token`,
`token`, `bearer`, `api_key`, `key`, `password`, `passwd`, `secret`, `signature`, `sig`, `session(id)`, `cookie`,
`credential`. Also applied in the MCP error path and in V2EX/Xueqiu messages. `Config.to_dict` masks by substring
(`key`, `token`, `password`, `proxy`, `cookie`, `secret`, `session`, `csrf`, `auth`, `cred`, `ct0`...)
(`AR: agent_reach/config.py`).

**Scrubber gaps.**

- I ran a copy of the query-secret regex on a synthetic URL: `X-Amz-Security-Token=...` and `X-Amz-Signature=...` are
  **not redacted**, because the key list is anchored at the character after `?`/`&` and does not match prefixed names.
  This matters to us: OFAC's SDN download redirects to a pre-signed object-store URL (section 5).
- By inspection, `Authorization: Bearer ...` headers and `Cookie: a=b` header strings in free text are not covered by
  these three patterns.
- Recommendation: scrub by structured key allowlist on parsed URLs and headers, never by regex over free text alone.

**MCP surface.** `AR: agent_reach/integrations/mcp_server.py`: one tool, `get_status`, built on `Config(read_only=True)`.
Unknown tool names return a string. Exceptions return `Error: <scrubbed>`. `mcp` is an optional dependency and absence
exits with an install hint. Tests: `AR: tests/test_mcp_server.py` (`test_mcp_status_uses_read_only_config`,
`test_mcp_status_exception_credentials_are_scrubbed`).
Defect by inspection: `get_status` returns `eyes.doctor_report()`, which is the **Rich-markup text report**
(`[bold cyan]...[/bold cyan]`), not the structured result; the `json.dumps` branch for dict/list results is never
reached. An MCP client gets markup, not data. The MCP server exposes no read, search, probe or per-channel tool.

### 1.5 URL security policy (SSRF handling)

Two distinct mechanisms in `AR: agent_reach/utils/url.py`.

**(a) Host matching for routing and credential scoping**: `host_matches(url, *domains)` / `domain_matches`. Accepts only
`http`/`https`, no userinfo, valid port (accessing `.port` forces malformed authorities to fail closed), and an exact
host or a true subdomain. Defeats `x.com.evil.test`, `notx.com`, `x.com@evil.test`, `user:pass@x.com`, `ftp://`,
trailing-dot hosts are normalised. Used by the `can_handle` of the platform channels (github, youtube, reddit, twitter, bilibili, v2ex, xueqiu, linkedin, OpenCLI sites...); `rss` and `exa_search` do not use it (`rss` uses a substring test, section 1.8). Tested by
`AR: tests/test_url_security.py` (`test_credential_channels_accept_exact_hosts_and_subdomains`,
`test_credential_channels_reject_lookalikes_and_userinfo`, `test_fixed_domain_channels_reject_suffix_lookalikes_and_userinfo`,
`test_host_matches_rejects_invalid_ports`).

**(b) Public-URL gate before a fetch**: `normalize_public_http_url(url)`, used only by `WebChannel.read`
(`AR: agent_reach/channels/web.py`; grep shows no other caller). Rules, in order:

1. Reject empty, backslash, whitespace and control characters.
2. Prepend `https://` when there is no `://`.
3. Reject malformed authority or out-of-range port.
4. Reject non-http(s), empty host, userinfo, `%` in host (zone ids, percent-encoded hosts).
5. Reject a fixed block list of names (`localhost`, `metadata.google.internal`, `instance-data`, `internal`, `lan`,
   `local`, `localdomain`, `home.arpa`, `ip6-localhost`, ...) and suffixes (`.internal`, `.local`, `.lan`, `.localhost`,
   `.home.arpa`, `.localdomain`).
6. Reject single-label hosts unless they are IP literals.
7. Parse IP literals including **legacy IPv4 spellings** via `socket.inet_aton` (decimal `2130706433`, hex `0x7f000001`,
   octal `0177.0.0.1`, short `127.1`, `0`) and reject anything where `ipaddress` `.is_global` is false.

Test matrix (`AR: tests/test_web_channel.py::test_read_rejects_non_public_urls_before_network`): `file://`, `ftp://`,
localhost, `intranet`, `home.arpa`, GCP metadata host, `127.0.0.1`, `127.1`, `169.254.169.254`, `192.168.1`, `0`,
`2130706433`, `0x7f000001`, `0177.0.0.1`, `2852039166`, `0xA9FEA9FE`, `[::1]`, `[::ffff:127.0.0.1]`, `localhost.`,
backslash trick, userinfo; asserts `urlopen` is **not called** (`mock_open.assert_not_called()`).

**What this does and does not buy.**

- Not covered: **no DNS resolution** (a public-looking hostname that resolves to a private address passes), **no redirect
  re-validation**, no DNS pinning. This is acceptable in Agent Reach only because the actual fetch is performed by the
  third party `r.jina.ai`, not by the local process (`WebChannel.read` requests `https://r.jina.ai/<url>`). The policy
  therefore protects against asking a remote service to fetch internal targets and against leaking userinfo; it does
  **not** make a local fetcher safe. Copying `normalize_public_http_url` into a direct fetcher without the missing
  pieces would be unsafe.
- Privacy consequence: the target URL is disclosed to Jina on every call.
- V2EX uses the stricter and better pattern for fixed sources: a **per-source allowlist** (`https` only, host in
  `{v2ex.com, www.v2ex.com}`, port 443, no userinfo, path must start with `/api/`), applied in `_validate_api_url`
  before both the urllib path and the curl fallback; query strings are built with `urlencode`
  (`_v2ex_url`) so caller values cannot alter the query; the curl fallback uses `--proto =https`, `--max-filesize`,
  and `--max-time` (`AR: agent_reach/channels/v2ex.py`). Xueqiu path parameters use `urllib.parse.quote(symbol, safe="")`.

### 1.6 File-permission and secret-storage handling

`AR: agent_reach/utils/paths.py` and `AR: agent_reach/config.py`:

- `ensure_no_symlink_path`: `lstat` every component of an absolute path and raise `PrivatePathError` on any symlink.
- `make_private_dir`: `mkdir(mode=0o700)`, re-check for symlinks, then on POSIX open with
  `O_DIRECTORY | O_NOFOLLOW` and `fchmod(0o700)`.
- `atomic_write_private_text` and `config._atomic_write_yaml`: `tempfile.mkstemp` **beside the target**, `fchmod(0o600)`
  before any data is written, write, `flush`, `fsync`, re-check parent and target for symlinks, `os.replace` (atomic,
  replaces a late-appearing symlink rather than following it), `chmod 600`, directory `fsync`. Temp file removed on any
  failure (`except BaseException`).
- `read_small_text_no_follow`: refuses symlinks in every component, opens with `O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC`,
  requires a regular file (`S_ISREG`), enforces `max_bytes` both by `fstat` size and by bounded read, re-checks symlinks
  after reading. Used for gh `hosts.yml`, rdt `credential.json`, mcporter config and the yt-dlp config (each with a
  1 MiB cap).
- `Config`: reads never create files or directories; the private directory is created on first write; `read_only=True`
  makes `save/set/delete` raise `ConfigReadOnlyError`; `set` rolls back the in-memory value if the save fails.
- `home_dir()` honours an explicit `HOME` even on Windows (where `expanduser` ignores it) so credential paths obey the
  test and container isolation boundary.
- Least-privilege cookie extraction (`AR: agent_reach/cookie_extract.py`): one explicit platform per call; only named
  cookies (for Xueqiu only `xq_a_token`); lookalike cookie domains rejected via `domain_matches`; an explicit browser
  profile that does not exist fails rather than falling back.
- Tests: `AR: tests/test_private_file_writes.py` (0600 mode, old file preserved on replace failure, target/parent/ancestor
  symlink refusal, oversized existing session refusal, install is safe by default, `--system` flag explicitly enables
  writes), `AR: tests/test_cookie_security.py`, `AR: tests/test_paths.py`, `AR: tests/test_config.py`.

**Limits.** The 0700/0600 guarantees are gated on `os.name != "nt"`; on Windows no ACL is applied (inspection). The
symlink checks are check-then-open for intermediate components; `O_NOFOLLOW` covers only the final component, and the
post-read re-check narrows but does not eliminate the race (inspection; not exploited or measured).

### 1.7 Retry chains in the skill references

The "retry chains" are **prose for the LLM**, not code, and so cannot be unit-tested the way the probes are.

| Where | Chain |
|---|---|
| `AR: agent_reach/skill/references/video.md` (YouTube subtitles) | 1) `yt-dlp --write-sub --write-auto-sub`; 2) if bot check or empty/no subtitle file and OpenCLI connected, `opencli youtube transcript`; 3) if OpenCLI returns `Caption URL returned empty response`, retry **at most 3 times** (expiring caption URLs, "do not treat an empty response as 'no subtitles'"); 4) otherwise `agent-reach transcribe` (download audio, Whisper). Success = non-empty content. |
| `AR: agent_reach/skill/references/social.md` (Twitter search) | 1) retry once; 2) `pipx upgrade twitter-cli` then retry; 3) `opencli twitter search`; 4) fall back to stable commands (`feed`, `user-posts`). |
| `AR: agent_reach/skill/references/finance.md` (Xueqiu) | HTTP 400 is a session/cookie problem, not "symbol not found"; `whoami` OK but `stock` failing is an adapter problem, not a login problem; empty fields with exit 0 are not success. |
| `AR: agent_reach/skill/references/video.md` (Bilibili) | Never use yt-dlp for Bilibili (412 risk control); bili-cli for metadata/search, OpenCLI for subtitles, public search API as zero-config fallback. |
| `AR: agent_reach/skill/SKILL_en.md` | Standing rules: health-check first for login-backed platforms; announce the backend used; on failure follow the references and "never guess commands"; broad research = combine platforms in parallel. |

Code-level retry exists in exactly two places, neither on the data path: `probe_command` (section 1.3) and
`AR: agent_reach/cli.py::_github_get_with_retry` (update check: exponential backoff 1, 2, 4 s, honours `Retry-After`
for rate limits, classifies 429/403-with-zero-remaining/5xx). V2EX's only retry is a targeted fallback: a Python TLS
"unexpected EOF" is retried through system `curl`, and **certificate verification errors are explicitly never retried**
(`AR: agent_reach/channels/v2ex.py::_get_json`, `_is_unexpected_tls_eof`).

### 1.8 Platforms and backends, with failure modes

Failure modes are those visible in code or the references; none were exercised by me.

| Channel | Backend(s) | How `check()` decides | Failure modes visible in source |
|---|---|---|---|
| `web` | Jina Reader (`r.jina.ai`) | Always `ok`, no probe | `read()`: 30 s timeout; 5 MiB cap via `resp.read(max+1)`; anti-bot challenge detection on the first 4096 bytes (needs `Warning: ... requiring captcha` plus a challenge marker, or Cloudflare "Attention Required" plus ray id); strict UTF-8 decode (non-UTF-8 raises); **no retry, no HTTP error handling** (a 429 raises `HTTPError`); the keyless Jina rate limit is unmanaged (observed 20 req/min in section 5); the URL is disclosed to a third party. |
| `github` | gh CLI | `gh --version` probe, then inspects `hosts.yml` / `GH_TOKEN` / `GITHUB_TOKEN` / config key | Never reports `ok` (all branches `warn`); rate limit difference (60/h anonymous, 5000/h with token) documented in `cli.py` setup text only. |
| `youtube` | yt-dlp | Executes `yt-dlp --version`; checks deno/node; reads yt-dlp config for `--js-runtimes`; version gate (>= 2025.11.12) | Missing JS runtime, stale yt-dlp, bot checks, empty captions; no per-video probe. |
| `rss` | feedparser | `import feedparser` only | No fetch performed. `can_handle` is a substring test on the whole URL (`/feed`, `/rss`, `.xml`, `atom`), so `https://example.com/atomic` matches (inspection). |
| `exa_search` | Exa via mcporter | Reads mcporter config files; never contacts Exa | Best result is `warn`; editor `imports` are not expanded "to avoid widening the credential-read boundary". |
| `v2ex` | public JSON API | Real GET, 10 s timeout, 1 MiB cap | TLS EOF handled by curl fallback; `search()` is a stub; network/proxy failure reports `warn`. |
| `bilibili` | bili-cli, OpenCLI, public search API | Executes `bili --version`; OpenCLI daemon state; real search API call | yt-dlp removed (412); bili-cli upstream stalled since 2026-03 per the source comment. |
| `xueqiu` | cookie-backed API | Real quote request | Module-global cookie jar and `_cookies_initialized` flag (shared mutable state; reset by an autouse fixture in `AR: tests/conftest.py`); HTTP 400 means session problem. |
| `twitter` | twitter-cli, OpenCLI, bird (legacy) | Inspects explicit credentials only | Upstream auto-reads browser cookies on invalid credentials; search endpoint volatile (GraphQL changes); datacenter IPs risk bans per `social.md`. |
| `reddit` | OpenCLI, rdt-cli | Reads rdt `credential.json`, 7-day TTL | No zero-config path: anonymous `.json` blocked, API self-service closed (docstring, "live-verified 2026-06"). |
| `facebook`, `instagram` | OpenCLI | OpenCLI status; never runs a platform command | Needs desktop Chrome with a logged-in session. |
| `linkedin` | mcp-server-linkedin, Jina Reader | Reads mcporter config | Best result `warn`. |
| `xiaohongshu`, `xiaoyuzhou`, `boss` | various | Not read line by line by me | NOT VERIFIED beyond the table in section 1.2. |

### 1.9 Tests: how channels are tested

- 35 test files under `AR: tests/`. `AR: test.sh` builds a clean venv in a temp home, runs a read-only doctor, then the
  suite.
- **Contract tests** (`AR: tests/test_channel_contracts.py`), run over every registered channel:
  - registry non-empty, unique names, non-empty `name`/`description`, `backends` is a list, `tier in {0,1,2}`;
  - `check()` returns `(status, message)` with status in `{ok,warn,off,error}` and a non-blank message while
    `shutil.which` is patched to return `None` ("deps mostly absent") and `urllib.request.urlopen` raises `URLError`;
  - `active_backend` is `None` or `str` before and after `check()`;
  - `ordered_backends` is a permutation of `backends`, with and without config; override promotes; unknown override
    is ignored;
  - `can_handle` returns `bool` for a sample URL per channel.
  Not asserted anywhere I read: `active_backend is not None` implies `status == "ok"`; `can_handle` correctness (that is
  covered separately by `test_url_security.py`).
- **Hermeticity**: autouse fixture `isolated_home` in `AR: tests/conftest.py` redirects `HOME`, `USERPROFILE`,
  `XDG_CONFIG_HOME`, `APPDATA`, `LOCALAPPDATA` and `Config.CONFIG_DIR/FILE` per test; another autouse fixture clears the
  Xueqiu cookie jar. External processes and sockets are faked with `monkeypatch` of `shutil.which`, `subprocess.run` and
  `urllib.request.urlopen`, or of module-private helpers (`bilibili._search_api_ok`, `v2ex._get_json`).
- **No record/replay and no live tests.** A search for `vcr`, `cassette`, `respx`, `responses` in `AR: tests/` finds
  nothing relevant. HTTP behaviour is covered only by hand-written fakes, so a real upstream response-shape change would
  not be caught by the suite.
- Security tests worth copying as a list of cases: `test_url_security.py`, `test_web_channel.py` (SSRF matrix, size
  limit at exactly the cap, oversize rejection, antibot detection with a fixed scan window, "single generic antibot terms
  must not trigger"), `test_scrub_credentials.py`, `test_cookie_security.py`, `test_private_file_writes.py`,
  `test_doctor_credential_boundaries.py`, `test_home_isolation.py`.

### 1.10 Licence and commit

- MIT, "Copyright (c) 2025 Agent Eyes" (`AR: LICENSE`).
- Commit `a19a171fa980a0785849596492e0af4db800c82f` ("feat: new Boss Zhipin channel (job search + JD full text)"), dated
  2026-09-16; working tree clean at time of study. Package version 1.5.0 (`AR: pyproject.toml`).

### 1.11 ADOPT (as patterns, re-implemented in TypeScript)

1. **Ordered backends + `active_backend` set only by proof**, user override that can only reorder and ignores unknown
   values. Add the missing precedence rule: environment overrides file, or document the opposite.
2. **`probe_command`-style classification**: `missing | broken | timeout | error | ok`, with prescriptive remediation
   text, side-effect-free canaries, and "retry only what can heal".
3. **Probe by the narrowest side-effect-free request** and state in the result what was executed versus inspected
   versus assumed.
4. **Doctor as an output boundary**: per-channel exception isolation, stale-state guard, scrub at the boundary, read-only
   config, zero-write test.
5. **Credential-boundary tests**: a `forbid(subprocess/fetch)` fixture asserting what the doctor must never call.
6. **Host matching by parsed hostname** (exact or true subdomain, no userinfo, valid port), with the lookalike test list.
7. **Per-source URL allowlist** (V2EX pattern) applied before every transport, plus structured query building.
8. **Symlink-safe, atomic, owner-only writes** and bounded reads for every file we create (cache, cassettes, config).
9. **Contract-test suite over the registry**, run with all dependencies absent and the network forced to fail.
10. **Retry chains with explicit stop criteria** ("max 3", "non-empty content is success", "HTTP 400 is not 'not found'"),
    but encoded as data/code we can test, not prose.
11. **Anti-bot / challenge page detection** on a bounded prefix with high-confidence markers only (and tests that single
    generic words do not trigger it).

### 1.12 BEAT (what Agent Reach lacks)

1. A real fetch contract: typed request, typed `Result` union, no empty-success. Agent Reach's `read` returns a bare
   `str` or raises.
2. **Provenance hashing** of every fetched body (nothing in `AR: agent_reach/` hashes content).
3. **Content-addressed cache** with conditional requests (`ETag`/`Last-Modified`). A grep of `AR: agent_reach/` for
   robots, rate-limit, licence, cache, etag, sha256 and hash matched only `boss.py` (a WebSocket handshake `sha1`),
   `reddit.py` (a `modhash` string) and `cli.py` (the update-check retry); I found no fetch cache, but `boss.py` was not
   read in full.
4. **Per-source metadata**: rate-limit, robots/terms stance, licence, attribution, auth tier. Agent Reach has `tier` only.
   Rate-limit awareness exists only in the update check.
5. **Record/replay cassettes** and a strict offline mode.
6. **A gateable doctor**: `main` calls `_cmd_doctor(args)`, which returns `None` and contains no `sys.exit`, so unhealthy channels never change the exit status (inspection; not run); the JSON has no schema version, timestamp,
   latency, evidence type or limits; the MCP tool returns markup.
7. **Canary probes that exercise the real request** (we can, because our sources are keyless public APIs and caching
   makes the cost trivial). Agent Reach could not, because its sources are login-gated.
8. **Direct-fetch SSRF defence**: DNS resolution, address pinning, per-hop redirect validation, streaming caps and
   decompression-bomb limits.
9. **Concurrency-safe channel state**: no mutable `active_backend` on singletons.
10. **Locale-neutral messages** (messages are Chinese-only: judges and reviewers read English).
11. **Scrubber coverage** for pre-signed URL parameters, `Authorization` and `Cookie` headers (section 1.4).

### 1.13 NOT VERIFIED (Agent Reach)

- I did not execute Agent Reach, run its tests or run `agent-reach doctor`; all behavioural statements are from source
  and test reading. The suite's pass/fail state is NOT VERIFIED.
- Not read in full: `AR: agent_reach/channels/boss.py`, `xiaohongshu.py`, `xiaoyuzhou.py`, `AR: agent_reach/cookie_extract.py`
  (beyond its header), `AR: agent_reach/transcribe.py`, most of `AR: agent_reach/cli.py`, `AR: agent_reach/skill/references/career.md`,
  the non-Twitter parts of `social.md`.
- Doctor wall-clock time with real tools installed: NOT MEASURED.
- Whether `ipaddress.ip_address("::ffff:127.0.0.1").is_global` is false on every supported Python version: the test expects
  a rejection, so it holds on the interpreter the project's CI uses; the cross-version behaviour is NOT VERIFIED.
- Upstream claims inside Agent Reach docs (Reddit API closure, Bilibili 412, bili-cli stalled) are quoted from its
  comments and are NOT VERIFIED by me.

---

## 2. LlamaIndex

### 2.1 What it is

A data framework for LLM apps: readers that turn sources into `Document`s, ingestion/transformation pipelines, indices,
retrievers and query engines. Study limited to connectors/readers, ingestion/cache, the retriever contract and sampled
integrations; the rest of the tree was not read. `llama-index-core` version 0.14.25 (`LI: llama-index-core/pyproject.toml`);
about 150 reader packages under `LI: llama-index-integrations/readers/`.

### 2.2 Architecture (file-cited)

**Reader contract** (`LI: llama-index-core/llama_index/core/readers/base.py`):

- `BaseReader`: `lazy_load_data(...) -> Iterable[Document]` (raises `NotImplementedError` by default), `load_data` =
  `list(lazy_load_data)`, async variants via `asyncio.to_thread` ("override for real async").
- `BasePydanticReader(BaseReader, BaseComponent)`: serialisable, with `is_remote: bool` flagging remote vs local sources.
- `ResourcesReaderMixin`: `list_resources`, `get_resource_info`, `load_resource`, `load_resources`,
  `list_resources_with_info`, and **`get_permission_info`** (per-resource permissions) with async twins. This is the
  closest thing in the three repos to "enumerate then fetch one".
- `ReaderConfig`: a reader plus its args, serialisable (`to_dict`, `read`). `load_reader` (`readers/loading.py`) restores a
  reader only from a **closed registry** (`ALL_READERS`, currently just `StringIterableReader`), refusing unknown
  `class_name`s.
- File reader: `LI: llama-index-core/llama_index/core/readers/file/base.py` (`SimpleDirectoryReader`) uses fsspec,
  `exclude_hidden`, `raise_on_error`, per-file metadata (`creation_date`, `last_modified_date`, path) via
  `default_file_metadata_func`.

**Document model** (`LI: llama-index-core/llama_index/core/schema.py`):

- `BaseNode.id_` defaults to `uuid.uuid4()` (**identity is random, not content-derived**); `metadata` is a flat dict;
  `excluded_embed_metadata_keys` and `excluded_llm_metadata_keys` control which metadata is shown to the embedder and
  to the LLM (`MetadataMode.ALL | EMBED | LLM | NONE`).
- Content hashing exists but is separate from identity: `TextNode.hash = sha256(text + metadata)`; `Document.hash`
  hashes metadata plus each resource; abstract `BaseNode.hash`.
- Relationships: `NodeRelationship.SOURCE | PREVIOUS | NEXT | PARENT | CHILD` with `RelatedNodeInfo(node_id, node_type,
  metadata, hash)`. This is the lineage chunk -> source document.

**Ingestion pipeline and cache** (`LI: llama-index-core/llama_index/core/ingestion/pipeline.py`, `cache.py`):

- `get_transformation_hash(nodes, transformation)` = `sha256(concat(node.get_content(MetadataMode.ALL)) +
  remove_unstable_values(str(transformation.to_dict())))`. **The cache key is derived from input content plus
  transformation configuration**, with memory-address noise stripped by regex. This is a clean content-addressed
  memoisation of a pure function.
- `IngestionCache(collection, cache: BaseKVStore)` with `put/get/clear/persist/from_persist_path`; default backing
  `SimpleKVStore`, persistable via fsspec. `persist` on a non-`SimpleCache` just prints a warning (`print`, not
  logging).
- `DocstoreStrategy`: `UPSERTS`, `DUPLICATES_ONLY`, `UPSERTS_AND_DELETE`, using stored per-document hashes
  (`_handle_duplicates`, `_handle_upserts`) so unchanged documents are skipped and changed ones replaced.

**Retriever contract** (`LI: llama-index-core/llama_index/core/base/base_retriever.py`): `BaseRetriever.retrieve(str |
QueryBundle) -> List[NodeWithScore]` (public, instrumented with `@dispatcher.span` and callback events) delegating to the
abstract `_retrieve`; async twin `aretrieve`/`_aretrieve`; recursive retrieval through `IndexNode` objects. Retrievers in
core: `LI: llama-index-core/llama_index/core/retrievers/` (auto-merging, fusion, recursive, router, transform).

**Rate limiting** (`LI: llama-index-core/llama_index/core/rate_limiter.py`): `BaseRateLimiter` with `acquire`/`async_acquire`,
token-bucket and sliding-window (60 s) implementations, **for LLM and embedding calls only**; not wired to readers.

**Sampled integrations** (`LI: llama-index-integrations/readers/`):

- `llama-index-readers-web` has about 24 sub-readers (`simple_web`, `async_web`, `rss`, `rss_news`, `sitemap`, `whole_site`,
  `trafilatura_web`, `readability_web`, and managed scrapers: `firecrawl_web`, `browserbase_web`, `zyte_web`, `zenrows_web`,
  `scrapfly_web`, `spider_web`, `oxylabs_web`, `olostep_web`, `hyperbrowser_web`, `agentql_web`...). The pattern: one thin
  class per scraping backend, same `load_data(urls) -> List[Document]` shape.
- `SimpleWebPageReader` (`.../web/simple_web/base.py`): `requests.get(url, headers=None, timeout=60)`; failures are
  **swallowed** (`continue`) unless `fail_on_error`; document id is `str(uuid.uuid4())`; metadata `{"url": url}`; no
  status check unless `fail_on_error`; no size cap; no SSRF guard; no user agent; no retry (inspection).
- `RssReader` (`.../web/rss/base.py`): `feedparser.parse(url)` (the library fetches), doc id from `entry.id` or `entry.link`,
  metadata `title/link/date`; mutates the process-global `feedparser.USER_AGENT` when a UA is supplied.
- `SECFilingsLoader` (`llama-index-readers-sec-filings/.../sec_filings/base.py`, `sec_filings.py`): 10-K/10-Q only
  (`assert filing_type in [...]`), thread pool plus process pool, and in `SECExtractor.get_filing`:
  `@sleep_and_retry @limits(calls=10, period=1)` with a docstring citing SEC's access rules, plus a session whose
  `User-Agent` is `"{company} {email}"` taken from args or `SEC_API_ORGANIZATION` / `SEC_API_EMAIL` (asserted non-empty).

### 2.3 Failure and bounds handling

- Readers raise `NotImplementedError` for unsupported modes; file reader has `raise_on_error`.
- `SimpleWebPageReader`: timeout 60 s default; **silent skip** on any exception when `fail_on_error=False` (the default),
  so a caller cannot tell "empty" from "failed" (inspection).
- SEC reader, silent degradation: if `ratelimit` is not importable the decorators are replaced by no-ops
  (`LI: .../sec_filings.py`, `try: from ratelimit import limits, sleep_and_retry except ImportError: ... fake_decorator`),
  so the documented 10 req/s protection **disappears without a warning**. Its timeout helper uses `signal.SIGALRM`
  (POSIX main thread only). `SECFilingsLoader.__init__` runs `os.makedirs("data", exist_ok=True)` in the current directory
  as a constructor side effect, and `load_data` writes JSON files there.
- Pipeline transform errors are covered by tests (`test_pipeline_with_transform_error`) but no retry/backoff policy exists
  in core for readers.

### 2.4 Security handling

- `LI: SECURITY.md` limits bug-bounty scope to `llama-index-core`, `llama-index-embeddings-openai`,
  `llama-index-llms-openai` and `llama-index-cli`; reader packages are out of that scope.
- `load_reader` restricts deserialisation to a closed registry (good); `SimpleWebPageReader` has no URL policy, so SSRF and
  local-file-scheme handling are the caller's job (inspection). Search for network allow/deny logic in the sampled readers
  found none.

### 2.5 Tests

- `LI: llama-index-core/tests/ingestion/test_cache.py` (hash, put/get, new hash after transform misses),
  `test_pipeline.py` (about 30 tests: dedup within a batch, upserts, parallel cache populated and reused, error in a
  transform, async parity, persist/load), `LI: llama-index-core/tests/readers/` (json, string iterable, file reader),
  `LI: llama-index-core/tests/test_rate_limiter.py`.
- The SEC reader's only test is an inheritance check:
  `LI: llama-index-integrations/readers/llama-index-readers-sec-filings/tests/test_readers_sec_filings.py::test_class`
  asserts `BaseReader` is in the MRO. No behavioural, rate-limit or UA test exists there.
- No cassette / VCR mechanism in core tests (search for `vcr`, `cassette`, `respx` found only unrelated pyproject hits).

### 2.6 Licence and commit

MIT, "Copyright (c) Jerry Liu" (`LI: LICENSE`). Commit `5b7b6e323e1da3edd787a2104a89257c14f026d0`, dated 2026-10-12.

### 2.7 ADOPT

1. **Transformation cache keyed by `sha256(input content + transformation config)`**
   (`get_transformation_hash`): use the same idea for parse/extract stages, keyed additionally by `parserVersion`.
2. **Per-document hash for change detection** and the `DUPLICATES_ONLY` / `UPSERTS` strategies for refreshing sources.
3. **`ResourcesReaderMixin` shape** (`list_resources`, `get_resource_info`, `load_resource`, `get_permission_info`) as the
   model for "enumerate, describe, then fetch one" (for example list filings for a CIK, then fetch one).
4. **`is_remote` flag** on readers: a cheap way to gate network use in `SAMPLE_MODE`.
5. **`MetadataMode`-style views** of the same record (what the LLM sees vs what the embedder sees vs what is audited).
6. **SEC etiquette in code**: declared UA from configuration, bounded call rate.
7. **Closed-registry deserialisation** for any persisted channel configuration.
8. `NodeRelationship.SOURCE` lineage as the minimal shape of "claim -> chunk -> source document".

### 2.8 BEAT

- Content-derived identity (their `id_` is `uuid4`, so the same page fetched twice is two documents unless the docstore
  hash path is used).
- Failures must be explicit values, not swallowed.
- Rate limiting must be mandatory and fail closed (no silent no-op decorator), and portable (no `SIGALRM`).
- Readers must not write into the working directory.
- Behavioural tests with recorded responses for every connector.
- URL policy in the reader itself.

### 2.9 NOT VERIFIED (LlamaIndex)

Only the paths cited above were read; the other ~150 reader packages, indices, query engines and vector stores were not
inspected. Whether `ratelimit` is a hard or optional dependency of the SEC package at install time: NOT VERIFIED (the
import fallback suggests optional). Behaviour of `feedparser.parse(url)` regarding timeouts and size limits: NOT VERIFIED.

---

## 3. Haystack

### 3.1 What it is

deepset's pipeline framework: typed components wired into a directed graph, document stores, retrievers, converters,
fetchers. Version `3.4.0-rc0` (`HS: VERSION.txt`). Study limited to the component contract, `Document`/`ByteStream`,
`LinkContentFetcher`, caching, retriever protocols, serialisation security, breakpoints and tracing.

### 3.2 Architecture (file-cited)

**Component contract** (`HS: haystack/core/component/component.py`, `sockets.py`, `types.py`):

- A class decorated with `@component` implements `run(**inputs) -> dict`, with outputs declared by
  `@component.output_types(name=type, ...)` (or `component.set_output_types`). `ComponentMeta` builds input and output
  **sockets** from the `run` signature and the declared output types at instance creation.
- If `run_async` exists it must be a coroutine and must have the **same parameters and the same output types** as `run`;
  mismatches raise `ComponentError` (`ComponentMeta._parse_and_set_input_sockets`, `_parse_and_set_output_sockets`,
  `_compare_run_methods_signatures`).
- Optional `warm_up()` for expensive init, called by the pipeline before graph execution; the module docstring warns the
  pipeline does not track which components it already warmed, so `warm_up` must be idempotent (`LinkContentFetcher` is,
  with a test). `to_dict`/`from_dict` (`default_to_dict`, `default_from_dict`) for serialisation.
- `Pipeline` (`HS: haystack/core/pipeline/base.py`, `pipeline.py`): `connect()` type-checks sockets; scheduling in
  `component_checks.py`; `max_runs_per_component=100` default guards loops (`PipelineMaxComponentRuns`).
- Snapshots and breakpoints (`HS: haystack/core/pipeline/breakpoint.py`, `HS: haystack/dataclasses/breakpoints.py`):
  `Breakpoint(component_name, visit_count)` pauses a run by raising; `PipelineSnapshot` captures inputs and component
  visit state and can **resume**; file saving is off by default (`HAYSTACK_PIPELINE_SNAPSHOT_SAVE_ENABLED`) and a
  `snapshot_callback` can redirect it. This is a pause/resume mechanism, not an HTTP record/replay.

**Document and ByteStream** (`HS: haystack/dataclasses/document.py`, `byte_stream.py`):

- `Document(id, content, blob, meta, score, embedding, sparse_embedding)`. If `id` is empty it is
  `Document._create_id()`: **`sha256` of content, blob bytes, mime type, `json.dumps(meta, sort_keys=True, default=str)`,
  embedding and sparse embedding**. Identity is content-derived, so identical content+meta gives an identical id.
  Corollary: any volatile value in `meta` (fetch timestamp) changes the id.
- `ByteStream(data, meta, mime_type)` is the raw fetched payload; `meta` is excluded from its hash (`field(hash=False)`).

**Fetcher** (`HS: haystack/components/fetchers/link_content.py`, `LinkContentFetcher`):

- `httpx` sync and async clients built lazily in `warm_up`/`warm_up_async`, closed by `close`/`close_async`.
- Defaults: `timeout=3`, `retry_attempts=2`, `follow_redirects=True`, `raise_on_failure=True`, HTTP/2 optional.
- Retries: `tenacity` with `wait_exponential(multiplier=1, min=2, max=10)`, retrying on **any** `httpx.HTTPStatusError`
  (so 4xx as well as 5xx, because `raise_for_status()` raises for both) or `httpx.RequestError`; **user agent rotates per
  failed attempt** from a configurable list; the rotation cursor is local to each call so concurrent fetches do not
  interfere. The async path re-implements the loop with a different backoff formula (`min(2 * 2 ** (attempt-1), 10)`).
- Header merge order: client defaults, component defaults (`accept`, `User-Agent: haystack/LinkContentFetcher/<ver>`,
  `Accept-Language`, `referer: https://www.google.com/`), user headers, rotating UA.
- Content handlers resolved by exact then `fnmatch` content-type (`text/*` decoded text; `text/html`, `application/*`,
  `image/*`, `audio/*`, `video/*` raw bytes). Output: `ByteStream` per URL with `meta = {content_type, url}` and
  `mime_type` set.
- Multiple URLs run in a `ThreadPoolExecutor` (sync) or `asyncio.gather` (async).

**Caching** (`HS: haystack/components/caching/cache_checker.py`): `CacheChecker(document_store, cache_field)` splits
`items` into `hits` (documents already in the store whose metadata field equals the item) and `misses`. It is a cache
lookup by metadata field in a `DocumentStore`, not a response cache and not content-addressed by the body.

**Stores and retrievers** (`HS: haystack/document_stores/types/protocol.py`, `policy.py`,
`HS: haystack/components/retrievers/types/protocol.py`): `DocumentStore` Protocol (`count_documents`, `filter_documents`,
`write_documents(policy)`, `delete_documents`) with `DuplicatePolicy` `NONE | SKIP | OVERWRITE | FAIL`; structural
`TextRetriever.run(query, filters, top_k)` and `EmbeddingRetriever.run(query_embedding, filters, top_k)` protocols
returning `{"documents": [...]}`.

**Tracing** (`HS: haystack/tracing/tracer.py`): `Span.set_content_tag` only records when `HAYSTACK_CONTENT_TRACING_ENABLED`
is set: content (queries, documents, answers) is treated as sensitive and is off by default.

### 3.3 Failure and bounds handling

- `LinkContentFetcher` raises on failure only when `raise_on_failure=True` and there is a single URL; with several URLs
  failures are logged and dropped (sync) or turned into empty streams (async, `raise_on_failure=False`).
- **Silent empty shell**: on failure with `raise_on_failure=False`, `_fetch` returns `ByteStream(data=b"")` with
  `meta = {"content_type": "text/html", "url": url}` (the default content type), with no error field. A failed fetch and
  a genuinely empty page are indistinguishable downstream (inspection).
- No response size cap, no decompression limit, no robots handling, no conditional requests, no cache of bodies.
- Pipeline loops are capped at 100 runs per component (`max_runs_per_component`, `HS: haystack/core/pipeline/base.py`).

### 3.4 Security handling

- **`HS: SECURITY.md` declares URL, path, filter and query validation out of scope**: "Validation and sanitization of
  input, for example URLs, file paths, filter expressions, and queries, are the responsibility of the application". There
  is therefore no SSRF defence in `LinkContentFetcher`, and redirects are followed by default.
- Spoofing-adjacent defaults: a `referer` of `https://www.google.com/` and UA rotation on failure. Fine for a generic
  scraper; wrong for a service that must be a polite, identifiable client of SEC, GLEIF or Wikimedia.
- Serialisation hardening (`HS: haystack/core/serialization_security.py`): an allowlist of importable modules
  (`haystack`, `haystack_integrations`, `haystack_experimental`, `builtins`, `typing`, `collections`) extendable per call,
  programmatically or via `HAYSTACK_DESERIALIZATION_ALLOWLIST`; denylists for dangerous builtins and callables; a check on
  the resolved object's real module (to defeat re-exported gadgets such as `haystack.utils.auth.os`); `unsafe=True` and
  `HAYSTACK_UNSAFE_DESERIALIZATION` as an explicit, process-frozen off switch. This is the most careful
  "load a config someone wrote" design of the three repos.
- Telemetry: opt-out through `HAYSTACK_TELEMETRY_ENABLED` (`HS: haystack/telemetry/_telemetry.py`).

### 3.5 Tests

- `HS: test/components/fetchers/test_link_content_fetcher.py` (about 30 tests): unit tests patch
  `haystack.components.fetchers.link_content.httpx.Client.get` with `Mock` responses (text, html, binary, bad request with
  and without exception, retry counts, header merge precedence, UA rotation independent per URL, lifecycle and
  idempotent warm-up, async paths). Live tests are marked `@pytest.mark.integration` and
  `@pytest.mark.flaky(reruns=3, reruns_delay=5)` against real URLs.
- Sample components for pipeline tests: `HS: haystack/testing/sample_components/`. Reusable document-store test mixins:
  `HS: haystack/testing/document_store.py`.
- No recorded-response (cassette) layer; offline tests depend on hand-built mocks.

### 3.6 Licence and commit

Apache-2.0 (`HS: LICENSE`; SPDX headers in sources). Commit `ffb8a58a7c862c1e276320d17b87a81a86f7e29f`, dated 2026-10-13,
`VERSION.txt` = `3.4.0-rc0`.

### 3.7 ADOPT

1. **Content-derived document id with sorted-key canonical JSON for metadata**, but with volatile fetch metadata kept
   outside the hashed part (see section 4).
2. **Typed component contract**: declared outputs, `run`/`run_async` signature parity enforced at construction, `warm_up`
   for expensive init, `to_dict`/`from_dict`. Translate to a TypeScript interface plus a constructor-time conformance check.
3. **`DocumentStore` Protocol with an explicit duplicate policy.**
4. **Per-call retry state** (UA rotation cursor local to the call, not the component) to stay correct under concurrency.
5. **Content-type handler registry** resolved exact-then-glob.
6. **Content tracing off by default**, enabled by env var; spans carry hashes and metadata, not bodies.
7. **Snapshot/resume** as a model for resuming a long multi-source run from a saved state.
8. **Serialisation allowlist plus real-module check** for any channel configuration loaded from disk.
9. `max_runs_per_component`-style hard loop cap for agent/channel loops.

### 3.8 BEAT

- Failures as typed results (never an empty `ByteStream` that looks successful).
- Per-source rate budgets and `Retry-After` handling instead of blind exponential retry on 4xx.
- SSRF-safe fetch (the framework refuses responsibility; we cannot).
- Size caps and streaming.
- Honest, identifiable User-Agent with a contact; no referer spoofing, no UA rotation.
- Single backoff implementation for sync and async paths.
- A real record/replay layer.

### 3.9 NOT VERIFIED (Haystack)

Only the paths cited above were read (no converters, embedders, agents, generators). Whether `follow_redirects=True`
interacts with a custom `client_kwargs` transport in ways that add protection: NOT VERIFIED. `HS: haystack/hooks/` and
`HS: haystack/skill_stores/` were listed but not read.

---

## 4. Synthesis: what to take from where

| Concern | Source of the pattern | Gap we must close |
|---|---|---|
| Ordered backends, `activeBackend` by proof, override | AR `Channel.ordered_backends`, two-pass selection | Env-vs-file precedence; typed status with evidence type |
| Real health probe, remediation text | AR `probe_command` | Per-task canary on the real request; sources are keyless so we can |
| Doctor as scrubbed output boundary, zero-write | AR `check_all`, `test_doctor.py` | Exit codes, schema version, structured MCP output |
| Credential boundary tests | AR `test_doctor_credential_boundaries.py` | Add "no outbound call in SAMPLE_MODE" assertion |
| Host matching | AR `host_matches` | Port to WHATWG `URL` |
| Per-source allowlist | AR `V2EX._validate_api_url` | Make it the universal rule; generic web uses the stricter pinned fetcher |
| Private file writes | AR `atomic_write_private_text` | Windows ACL story |
| Contract tests with deps absent | AR `test_channel_contracts.py` | Run against cassettes as well; assert evidence integrity |
| Content-derived ids | HS `Document._create_id` | Separate stable identity from volatile fetch metadata |
| Content-hash transform cache | LI `get_transformation_hash` | Include parser version |
| Resource enumeration | LI `ResourcesReaderMixin` | Add licence/permission per resource |
| Typed component contract | HS `@component` | TypeScript conformance test |
| Declared UA and call rate for SEC | LI `SECExtractor.get_filing` | Never degrade silently |
| Sensitive-content tracing off by default | HS `set_content_tag` | Hash-only trace lines by default |
| Provenance, content-addressed blobs, cassettes, licence metadata, robots | None of the three | Build (section 6) |

---

## 5. Public sources: what I observed on 2026-10-13

All probes were single, low-volume GET/HEAD/ranged-GET requests with a descriptive User-Agent and no credentials, from
this development machine. They are observations, not guarantees. Where I fetched a vendor's documentation page it is named.

| Source | Request (shape only) | Observed | Auth / etiquette | Licence |
|---|---|---|---|---|
| GLEIF API v1 | `GET https://api.gleif.org/api/v1/lei-records/<LEI>`, `.../lei-records?filter[entity.legalName]=<name>`, `.../fuzzycompletions?field=entity.legalName&q=<text>` | 200, `application/vnd.api+json`; record has `lei, entity, registration, bic, mic, ocid, qcc, gem, spglobal, conformityFlag`; response `cache-control: private, must-revalidate`, no `ETag` seen | None needed. Rate limit: NOT VERIFIED | CC0: GLEIF's LEI Data Terms of Use page states data "provided under the CC0 licence" and refers to "reservations of the licence" in a Section IV I did not read. Golden Copy / concatenated file pages exist; direct download URLs NOT VERIFIED |
| SEC EDGAR (data host) | `GET https://data.sec.gov/submissions/CIK<10-digit>.json`, `.../api/xbrl/companyfacts/CIK<10-digit>.json` | 200 `application/json` with a descriptive UA; **403 without a UA**; company facts for one large filer was about 3.8 MB; no `ETag`/`Last-Modified` seen on the submissions response | SEC's access page (fetched 2026-10-13): "Current max request rate: 10 requests/second", declare a `User-Agent` with company name and contact email, "moderate requests" | US government filings; reuse terms not read. NOT VERIFIED |
| SEC EDGAR (www host) | `GET https://www.sec.gov/files/company_tickers.json`, `.../cgi-bin/browse-edgar?...&output=atom` | **403** for my probe UA (descriptive text, no contact email) | A compliant UA (name plus real contact) may pass; NOT VERIFIED | NOT VERIFIED |
| SEC full-text search | `GET https://efts.sec.gov/LATEST/search-index?q=<phrase>&forms=10-K` | 200 `application/json` (about 58 KB) | I found no support statement in the pages I read; treat as unsupported/unstable. NOT VERIFIED as a public API | NOT VERIFIED |
| OFAC SDN list | `GET https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML` | **302** to a short-lived pre-signed object-store URL (query includes `X-Amz-Expires`, `X-Amz-Security-Token`, `X-Amz-Signature`); target served ranged GET (206) with `ETag`, `Last-Modified` (Fri 2026-10-09), total 29,167,737 bytes, XML root `sdnList` with `Publish_Date 10/09/2026` and `Record_Count 19416`. The legacy URL `https://www.treasury.gov/ofac/downloads/sdn.xml` returns 302 to the service URL | None. Other formats (CSV, Advanced XML): a link to "Explanatory documentation for Advanced Sanctions Data Model" exists on the OFAC service page; the file endpoints are NOT VERIFIED | Public-domain status of the list: NOT VERIFIED (no fetched page stated it) |
| Wikidata | `GET https://www.wikidata.org/w/api.php?action=wbsearchentities&...`, `GET https://www.wikidata.org/wiki/Special:EntityData/<QID>.json`, `GET https://query.wikidata.org/sparql?query=...` (with `Accept: application/sparql-results+json`) | 200 on all three; entity JSON carries `last-modified` and `cache-control: private, s-maxage=0, max-age=0, must-revalidate` | UA policy and rate limits: NOT VERIFIED (descriptive UA used) | CC0 for structured data: Wikidata:Licensing page states main/Property/Lexeme/EntitySchema namespaces are "released into the public domain under Creative Commons Zero" |
| CourtListener REST v4 | `GET https://www.courtlistener.com/api/rest/v4/search/?q=<q>&type=o` and `GET .../api/rest/v4/dockets/?docket_number=<n>` | search: **200 anonymously** (JSON with `count`, `next`, `results`); dockets: **401** anonymously | Docs (fetched 2026-10-13) describe token authentication via the `Authorization` header and say authenticated users are limited to 5 requests per minute, 50 per hour, 125 per day by default, with a usage API; anonymous limits NOT VERIFIED | Data/reuse terms: NOT VERIFIED |
| Federal Register API (extra, not requested) | `GET https://www.federalregister.gov/api/v1/documents.json?per_page=1` | 200 anonymously | Limits and licence NOT VERIFIED | NOT VERIFIED |
| Jina Reader | `GET https://r.jina.ai/<absolute URL>` | 200 `text/plain` for `example.com`; response headers `x-ratelimit-limit: 20, 20;w=60`, `x-ratelimit-remaining: 19`, `x-usage-tokens` | Keyless tier shows 20 requests per 60 s on this response | Output licence is that of the page; Jina terms NOT VERIFIED. The target URL is sent to a third party |
| RSS / Atom | generic | No feed URL was verified. `sec.gov` Atom (`getcurrent`) returned 403 for my UA | NOT VERIFIED per feed | per feed |

---

## 6. Source-channel layer spec for our product

Goals: one interface for every external data source; identical code path live, recorded and replayed; every returned fact
carries evidence that a judge can verify offline; failures are values; the doctor tells the truth.

### 6.1 Principles

1. **Evidence, not text.** A fetch returns an `Evidence<T>` (hashes, timings, source, licence, parsed data), never a bare
   string.
2. **One transport, three modes.** `live`, `record`, `replay`. `SAMPLE_MODE=true` forces `replay` with the network layer
   physically disabled; a cassette miss is a hard, named error, never a silent live call.
3. **Failures are data.** `FetchResult` is a discriminated union; there is no "empty success".
4. **Allowlist first.** Each channel declares the exact origins and path prefixes it may call. The generic web channel is
   the only one allowed to reach arbitrary public hosts, and it goes through the pinned, redirect-validating fetcher.
5. **Prove health, say what was proven.** Each probe reports whether it executed a real request, inspected configuration,
   or replayed a cassette.
6. **Never degrade silently.** If a protection (rate limiter, SSRF guard, size cap) cannot initialise, the channel refuses
   to run (contrast with the SEC reader's no-op decorator fallback).

### 6.2 Interface (TypeScript-flavoured pseudocode)

```ts
type Tier = 0 | 1 | 2;                       // 0 keyless, 1 free key, 2 needs setup (AR tier semantics)
type Mode = 'live' | 'record' | 'replay';    // SAMPLE_MODE=true => 'replay' + egress blocked
type HealthStatus = 'ok' | 'degraded' | 'unverified' | 'off' | 'error';
// ok         : canary executed (live or replay) and matched expectations
// degraded   : working through a fallback backend or a stale cache
// unverified : installed/configured but no canary could be run (AR's "warn")
// off        : not configured (missing key/dependency)
// error      : present but broken, with a remediation string

interface SourceMeta {
  id: string;                                // 'gleif' | 'sec-edgar' | 'ofac-sdn' | 'wikidata' | 'courtlistener' | 'rss' | 'web'
  title: string;
  tier: Tier;
  homepage: string;
  termsUrl: string;                          // page the licence/etiquette claims come from
  licence: { id: string; verifiedOn: string | null; attributionRequired: boolean; redistributable: boolean | 'unknown' };
  auth: { kind: 'none' | 'user-agent' | 'api-key' | 'token'; envVar?: string; uaTemplate?: string };
  rateLimit: { source: 'documented' | 'observed' | 'unknown'; maxRps: number; burst: number; perMinute?: number;
               perDay?: number; docUrl?: string; ourBudgetRps: number };   // ourBudgetRps <= maxRps/2
  robots: 'not-applicable-api' | 'honour' | 'unknown';
  allowedOrigins: { origin: string; pathPrefixes: string[]; methods: ('GET' | 'HEAD')[] }[];
  maxBodyBytes: number;                      // streaming cap, enforced after decompression too
  timeouts: { connectMs: number; headersMs: number; totalMs: number };
  freshness: { ttlSeconds: number; staleIfErrorSeconds: number };
  notVerified: string[];                     // human-readable list of unproven claims, surfaced by doctor
}

interface Backend { name: string; priority: number; requires?: string[]; }   // ordered; first proven wins

interface SourceChannel<Q, R> {
  readonly meta: SourceMeta;
  readonly backends: readonly Backend[];                       // AR: ordered candidates
  activeBackend(): string | null;                              // set only by a successful probe (AR rule)
  canHandle(ref: string | URL): boolean;                       // parsed-host matching, never substring
  probe(ctx: ChannelContext): Promise<Probe>;                  // real canary request, side-effect free
  fetch(q: Q, ctx: ChannelContext): Promise<FetchResult<R>>;
  search?(text: string, opts: SearchOpts, ctx: ChannelContext): Promise<FetchResult<R[]>>;
  list?(scope: unknown, ctx: ChannelContext): Promise<FetchResult<ResourceInfo[]>>;  // LI ResourcesReaderMixin
}

type FetchResult<R> =
  | { ok: true;  evidence: Evidence<R> }
  | { ok: false; error: FetchError; evidence?: Partial<Evidence<unknown>> };   // partial evidence of the failed attempt

type FetchError =
  | { kind: 'blocked-by-policy'; rule: 'allowlist' | 'ssrf' | 'robots' | 'size' | 'sample-mode-egress' }
  | { kind: 'rate-limited'; retryAfterMs: number | null; budgetExhausted: boolean }
  | { kind: 'auth-required' | 'forbidden' | 'not-found' | 'gone' }
  | { kind: 'upstream-error'; httpStatus: number }
  | { kind: 'timeout' | 'network' | 'tls' }                     // 'tls' never retried on certificate errors (AR V2EX rule)
  | { kind: 'parse-error'; parserVersion: string; bodySha256: string }
  | { kind: 'challenge-page'; detector: string }                // AR anti-bot detection, high-confidence markers only
  | { kind: 'cassette-miss'; requestKey: string; hint: string } // replay mode only
  | { kind: 'empty-unexpected' };                               // 200 with no records where the schema requires some

interface Evidence<R> {
  evidenceId: string;            // 'ev_' + base32(sha256(requestKey + '\n' + bodySha256))
  channel: string; backend: string;
  request: { method: 'GET' | 'HEAD'; urlRedacted: string; paramsCanonical: string; requestKey: string };
  response: { httpStatus: number; contentType: string; contentEncoding: string | null;
              bodySha256: string;           // hash of the decoded bytes the parser saw
              byteLength: number; etag: string | null; lastModified: string | null;
              sourcePublishedAt: string | null;      // e.g. OFAC <Publish_Date>, GLEIF lastUpdateDate
              redirectChain: { fromRedacted: string; status: number; toRedacted: string }[] };
  fetch: { mode: Mode; servedFrom: 'network' | 'cache-fresh' | 'cache-revalidated-304' | 'cache-stale-if-error' | 'cassette';
           startedAt: string; durationMs: number; attempts: number; rateLimitWaitMs: number };
  licence: { id: string; termsUrl: string; attributionRequired: boolean };
  parsed: { schemaVersion: string; parserVersion: string; recordsSha256: string; value: R };
  spans?: { jsonPointer?: string; byteRange?: [number, number]; quote?: string }[];   // for "explain why" citations
}

interface ChannelContext {
  mode: Mode; clock: () => Date; rng: () => number;              // injected for deterministic tests
  transport: Transport; cache: BlobCache; limiter: RateLimiter; secrets: SecretStore;
  log: (line: TraceLine) => void;                                // hashes/metadata only; bodies only if CONTENT_TRACE=1 (HS rule)
}
```

Registry rules (enforced by a constructor-time conformance check, HS `ComponentMeta` idea): unique `id`; `meta` complete
(no empty `licence.id`, `termsUrl`, `allowedOrigins`); `ourBudgetRps <= maxRps / 2`; every `Backend.name` unique; `probe`
and `fetch` both present; `canHandle` returns boolean for the URL fuzz corpus.

Backend override (resolves the AR ambiguity): `SOURCE_<ID>_BACKEND` environment variable **beats** the config file,
reorders only, ignores unknown names with a doctor warning (not silently).

### 6.3 Transport and policy pipeline (per request)

1. Build the request from the channel's template; canonicalise (sorted query, WHATWG-normalised URL) to get `requestKey`.
2. **Allowlist** check against `meta.allowedOrigins` (V2EX pattern): scheme `https`, exact host, port 443, no userinfo,
   path prefix. Generic web channel instead runs the public-URL gate **plus** DNS resolution, rejection of any non-global
   address, connection pinned to the vetted IP, and manual redirect handling with the full gate re-applied on every hop
   (max 5). Credentials are never forwarded to a different origin on redirect.
3. Mode switch: `replay` => look up `requestKey` in the cassette; `SAMPLE_MODE` additionally installs an egress guard so
   any socket attempt throws `sample-mode-egress`.
4. Cache lookup (section 6.4); on a stale entry send `If-None-Match` / `If-Modified-Since`.
5. Rate limiter (per-source token bucket, concurrency cap, honours `Retry-After`, jittered backoff, **no retry on
   4xx except 429**, no retry on TLS certificate errors).
6. Streaming read with a byte cap on both the wire and the decompressed size; abort on overflow with `blocked-by-policy`.
7. Challenge-page detector on a bounded prefix (AR rule); empty-where-nonempty-required check.
8. Hash the decoded bytes (`bodySha256`), write the blob, write the index entry, emit a trace line.
9. Parse with a pure, versioned parser; hash the canonical parsed records (`recordsSha256`).
10. Credential redaction by **structured allowlist** on parsed URL components and headers (`Authorization`, `Cookie`,
    and any query key matching the deny list including `X-Amz-*` and `*-Signature`), not by regex over free text.

### 6.4 Cache format (content-addressed)

```
<cacheRoot>/                      # created 0700; files 0600; symlink-refusing; atomic temp+rename (AR paths.py rules)
  blobs/sha256/ab/cdef...         # raw decoded response bytes, immutable, named by their own SHA-256
  index/<requestKey>.json         # small mutable pointer
  meta.json                       # { schemaVersion, createdBy, toolVersion }
```

`index/<requestKey>.json`:

```json
{
  "schemaVersion": 1,
  "requestKey": "sha256:...",
  "channel": "sec-edgar",
  "urlRedacted": "https://data.sec.gov/submissions/CIK0000320193.json",
  "latest": {
    "bodySha256": "sha256:...", "byteLength": 123456, "httpStatus": 200, "contentType": "application/json",
    "etag": null, "lastModified": null, "sourcePublishedAt": null,
    "fetchedAt": "2026-10-13T12:00:00Z", "validatedAt": "2026-10-13T12:00:00Z"
  },
  "history": [{ "bodySha256": "sha256:...", "fetchedAt": "..." }]
}
```

`requestKey = sha256(canonicalJSON({ channel, method, urlCanonical, headersAllowlisted, bodySha256 }))`; the allowlisted
headers are only those that change the response (`Accept`), never credentials. Cache validity: `fresh` inside
`ttlSeconds`; `revalidate` with conditional headers afterwards; `stale-if-error` up to `staleIfErrorSeconds`, reported in
`Evidence.fetch.servedFrom`. Integrity: a read recomputes the blob hash; mismatch evicts the entry and refetches. Identity
of a document is `evidenceId`/`bodySha256`, **never** includes fetch timestamps (the Haystack caveat).

### 6.5 Cassette format (record/replay)

Directory `cassettes/<scenario>/` committed to the repo for `SAMPLE_MODE`:

```
cassettes/<scenario>/
  manifest.json
  entries/<requestKey>.json
  blobs/<sha256>                 # same naming as the cache; small, trimmed, licence-checked
```

`manifest.json`:

```json
{
  "schemaVersion": 1, "scenario": "kyb-demo-1", "recordedAt": "2026-10-13T12:00:00Z", "toolVersion": "0.1.0",
  "sources": [{ "channel": "gleif", "licence": "CC0-1.0", "termsUrl": "https://www.gleif.org/en/meta/lei-data-terms-of-use",
                "redistributable": true }],
  "entries": [{ "requestKey": "sha256:...", "bodySha256": "sha256:...", "excerpt": null }],
  "manifestSha256": "sha256:..."
}
```

`entries/<requestKey>.json`: `{ request: { method, urlRedacted, paramsCanonical }, response: { httpStatus, contentType,
headersAllowlisted, bodySha256, redirectChain }, recordedAt, latencyMs, excerpt?: { rule, fullBodySha256, fullByteLength } }`.

Rules:

- **Strict replay**: a request whose `requestKey` is absent fails with `cassette-miss` and the exact key and a hint to
  re-record; no fallthrough to the network. Tested by asserting zero socket calls.
- **Record** redacts through the same structured redactor; recording refuses to write an entry containing a header or query
  value matching the deny list.
- **Excerpts must be declared.** The OFAC list is about 29 MB (section 5), so a committed fixture is a trimmed subset. It
  carries `excerpt.rule` and the full-file hash, and any screening result built on it must print
  "SAMPLE excerpt of list published <date>, not a complete screening" in the evidence. Never present an excerpt as the list.
- **Redistribution gate**: record only sources whose `licence.redistributable` is `true` with a verified `termsUrl`
  (GLEIF CC0 and Wikidata CC0 are established in section 5; SEC, OFAC and CourtListener reuse terms are NOT VERIFIED and
  must be confirmed before their bodies are committed; third-party web pages fetched through Jina are never committed).
- **Drift check** (`doctor --drift`, live only): re-run each cassette's canary request and compare structure (key set,
  record count range) against the cassette, reporting source drift without failing `SAMPLE_MODE`.
- Cassette integrity: `manifestSha256` over the sorted entry hashes, verified at load; the sample-mode banner prints the
  scenario name and `recordedAt` so a judge sees the data is recorded.

### 6.6 Doctor output format

Command: `doctor [--json] [--live|--replay] [--channel <id>] [--drift]`. Exit codes: `0` all required channels `ok`;
`1` any required channel `error`; `2` degraded or unverified required channel; `3` configuration error. (Agent Reach
exits 0 in all cases.)

JSON (`doctor.schema.json`, versioned):

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-13T12:00:00Z",
  "toolVersion": "0.1.0",
  "mode": "live",
  "sampleMode": false,
  "summary": { "ok": 5, "degraded": 0, "unverified": 1, "off": 1, "error": 0, "total": 7, "requiredOk": true },
  "channels": [{
    "id": "gleif", "tier": 0, "required": true,
    "status": "ok", "activeBackend": "gleif-api-v1",
    "backends": [{ "name": "gleif-api-v1", "status": "ok", "evidence": "executed", "checkedAt": "2026-10-13T12:00:00Z", "latencyMs": 212 }],
    "canary": { "kind": "live-request", "requestKey": "sha256:...", "httpStatus": 200, "bodySha256": "sha256:...", "assertions": ["data.type == 'lei-records'"] },
    "limits": { "budgetRps": 2, "remaining": null, "resetAt": null, "source": "unknown" },
    "licence": { "id": "CC0-1.0", "verifiedOn": "2026-10-13", "redistributable": true },
    "message": "GLEIF API reachable; canary record parsed.",
    "remediation": null,
    "notVerified": ["API rate limit"]
  }]
}
```

`evidence` is one of `executed` (a real request or process ran), `replayed` (cassette canary), `inspected` (config or
files read, nothing run), `assumed` (nothing checked). The status rule: **`ok` requires `executed` or `replayed`**.

Text rendering (English; localisable):

```
Source channels  mode=live  2026-10-13T12:00:00Z
ok          gleif         gleif-api-v1   executed   212 ms   CC0-1.0
ok          sec-edgar     data.sec.gov   executed   341 ms   UA: set
unverified  courtlistener -              inspected           no token configured; anonymous search only
off         rss           -                                  no feeds configured
summary 5 ok, 1 unverified, 1 off  (required: ok)   exit 0
```

### 6.7 Public sources to wire (with auth needs)

Status column uses only what section 5 observed or a fetched vendor page stated.

| Channel id | Endpoints to wire (shape only, from section 5) | Auth | Etiquette / limits | Licence | Status |
|---|---|---|---|---|---|
| `gleif` | `lei-records/<LEI>`, `lei-records?filter[entity.legalName]=`, `fuzzycompletions` on `api.gleif.org/api/v1` | none | rate limit NOT VERIFIED; set our own conservative budget | CC0 (LEI Data Terms of Use) | endpoints observed 200 |
| `sec-edgar` | `data.sec.gov/submissions/CIK<10>.json`, `data.sec.gov/api/xbrl/companyfacts/CIK<10>.json` | none; descriptive `User-Agent` with real contact required (`SEC_USER_AGENT` env, refuse to run without it) | 10 req/s documented maximum; budget 5 req/s or lower | reuse terms NOT VERIFIED | endpoints observed 200 with UA, 403 without |
| `sec-edgar` (www host files and Atom) | `www.sec.gov/files/company_tickers.json`, Atom `getcurrent` | same UA | same | NOT VERIFIED | **403 with my probe UA**; do not rely until tested with a compliant UA |
| `sec-fulltext` | `efts.sec.gov/LATEST/search-index` | same UA | not documented in what I read | NOT VERIFIED | observed 200; NOT VERIFIED as supported. Optional; mark experimental |
| `ofac-sdn` | `sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML` (follow one 302 to the signed object URL) | none | use `ETag`/`Last-Modified` on the signed target; download once per publish date; cache by `Publish_Date` | NOT VERIFIED | observed 29,167,737 bytes, 19,416 records, publish date 10/09/2026. Redact `X-Amz-*` in all logs |
| `wikidata` | `w/api.php?action=wbsearchentities`, `wiki/Special:EntityData/<QID>.json`, `query.wikidata.org/sparql` | none; descriptive `User-Agent` | limits NOT VERIFIED | CC0 (Wikidata:Licensing) | endpoints observed 200 |
| `courtlistener` | `api/rest/v4/search/` (anonymous worked), other v4 endpoints need a token (dockets returned 401) | optional token (`COURTLISTENER_TOKEN`), sent as the documented `Authorization` header | documented authenticated limit 5/min, 50/hour, 125/day; plan around it with caching | NOT VERIFIED | observed |
| `rss` | any configured feed URL via the pinned fetcher plus a feed parser (no feed verified) | none | conditional GET (`ETag`/`Last-Modified`), one fetch per TTL | per feed | NOT VERIFIED per feed |
| `web` (Jina Reader) | `r.jina.ai/<absolute URL>` | none keyless | keyless response header showed 20 requests per 60 s; handle 429 with `Retry-After`; disclose that URLs go to a third party; never for private documents | page's own licence | observed |
| `web-direct` | arbitrary public URL via our pinned fetcher | none | robots honoured; identifiable UA | page's own licence | design only |

Not wired because not verified or not requested: Federal Register (observed 200, terms NOT VERIFIED), OFAC CSV/Advanced
XML (endpoints NOT VERIFIED), GLEIF Golden Copy bulk downloads (URLs NOT VERIFIED).

### 6.8 Contract-test plan (what must exist before the layer is called done)

Run over the whole registry, with dependencies absent and egress blocked, then again against cassettes:

1. Registry: unique ids; complete `SourceMeta`; `ourBudgetRps <= maxRps / 2`; `notVerified` surfaced in doctor output.
2. `canHandle` corpus: exact host, true subdomain, `host.evil.test`, `evil.test@host`, `user:pw@host`, `ftp://`, bad port,
   trailing dot, uppercase (AR `test_url_security.py` cases).
3. Policy: the AR SSRF matrix (including legacy IPv4 spellings and IPv6) **plus** hostname-resolves-to-private (stub DNS),
   redirect-to-private, redirect-to-other-origin credential stripping, oversize body, decompression bomb, slow body,
   non-UTF-8 body. Assert the transport is never reached when blocked.
4. `SAMPLE_MODE`: any socket attempt throws; replay of every cassette entry; `cassette-miss` names the key; no file written
   outside the cache/cassette dirs; temp home left empty after the doctor (AR `test_home_isolation.py`).
5. Evidence integrity: recompute `bodySha256` from the blob, `recordsSha256` from the parsed value, `evidenceId`; tamper
   with a blob and expect eviction and refetch (live) or hard failure (replay).
6. Failure union: each `FetchError.kind` produced by a stubbed upstream (429 with `Retry-After`, 403, 404, 5xx, timeout,
   TLS certificate failure never retried, challenge page, 200-empty-where-records-expected, malformed JSON/XML).
   Assert no success result with empty `parsed.value` unless the schema allows it.
7. Rate limiting: budget enforced across concurrent callers; limiter failure to initialise aborts the channel.
8. Redaction: URL userinfo, `Authorization`, `Cookie`, `X-Amz-Security-Token`, `X-Amz-Signature`, generic `token`/`key`
   in query, in doctor output, MCP output, error messages, cassettes and trace lines.
9. File safety: 0700/0600 on POSIX, symlinked cache dir refused, partial write never visible (kill during write), Windows
   behaviour documented and tested for the supported subset.
10. Doctor: exit codes; JSON validates against the schema; `ok` impossible with `evidence` of `inspected`/`assumed`;
    one channel throwing does not abort the report; stale `activeBackend` never leaks (AR guard).
11. Live smoke (opt-in, tagged): one canary per source with a recorded expectation and the drift report; tolerant of
    upstream outages (reported as `error` with remediation, never failing the offline suite).

### 6.9 What this spec does not cover (open items)

- Licence and reuse terms for SEC, OFAC and CourtListener content, which gate committing their bodies as cassettes:
  NOT VERIFIED.
- Anonymous rate limits for GLEIF, Wikidata and CourtListener: NOT VERIFIED.
- Whether a compliant SEC User-Agent unblocks the `www.sec.gov` endpoints: NOT VERIFIED.
- Windows file-permission behaviour for the cache: design deferred; the AR code does not apply ACLs either.
- Choice of RSS feeds and a feed parser for TypeScript: not decided here.
- Which fields of each source the product actually needs (depends on the undecided use case, `docs/open-questions.md`).
