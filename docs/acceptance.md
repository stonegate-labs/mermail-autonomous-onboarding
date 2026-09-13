# Acceptance and source review

Review date: **2026-09-13**. Baseline: `8af0271b56ac784030a779494bccdc33fc4346ba`. Development and verification use `feature/phase1.5/mermail-autonomous-onboarding`; no work is developed or tested on `main`.

## Authoritative sources

All required Mermail pages were retrieved directly over HTTPS and read before the adapter was implemented. The web reader failed to open the Mermail URLs; direct Node HTTPS retrieval returned HTTP 200. No third-party source was used to infer a Mermail contract. The listing's full description was read from its server-rendered page data because the web text view omitted it.

| Exact URL                                                                          | Reviewed use                                                                           |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| https://docs.mermail.app/llms.txt                                                  | Official discovery index and endpoint references                                       |
| https://docs.mermail.app/ai/overview.md                                            | Deterministic integration choice and trust boundaries                                  |
| https://docs.mermail.app/ai/agent-email-inbox.md                                   | Scoped reuse/create, baseline IDs, readiness, sender/recipient correlation             |
| https://docs.mermail.app/ai/mcp.md                                                 | Focused profile, host namespaces, safe fields and unknown sender authentication        |
| https://docs.mermail.app/ai/skills.md                                              | Portable skill packaging, host-dependent integration and safety context                |
| https://docs.mermail.app/ai/cli.md                                                 | Official CLI distinction, environment authentication and bounded wait behavior         |
| https://docs.mermail.app/api-reference/mailboxes/list-mailboxes.md                 | GET path, bare array, workspace scope, `public_id`, readiness fields                   |
| https://docs.mermail.app/api-reference/mailboxes/create-mailbox.md                 | Required `email`/`name`, settings, admin permission, idempotency and provision credits |
| https://docs.mermail.app/api-reference/emails/list-emails.md                       | Pagination, array/envelope response, metadata/safe controls and sort fields            |
| https://docs.mermail.app/api-reference/emails/get-email.md                         | Safe body controls, scan omission, truncation and authentication fields                |
| https://docs.mermail.app/api-reference/emails/get-safe-email-and-thread-context.md | Selected email, bounded thread page and always-safe context semantics                  |
| https://superteam.fun/earn/listing/build-and-demo-a-mermail-agent-skill            | Actual demo/video requirements and required upstream PR destination                    |

### Discrepancies and deliberate decisions

- The specific list-email page says arrays may be returned, although its schema focuses on the envelope. The adapter accepts both and validates complete pagination.
- Some generated response examples contain a body with `scan_status: null`, despite safe-read prose describing omission for non-clean mail. Specific safe-read controls govern implementation: omitted, non-clean, truncated or non-safe content never satisfies extraction.
- General AI guidance calls for fresh confirmation at several third-party action boundaries. That is workflow/host guidance, not an HTTP contract. This task explicitly authorizes ordinary onboarding and verification; the skill continues those actions within host policy, and stops for actual payment/signing or technically unavailable compliant automation. It does not implement security bypass or unrestricted terms acceptance.
- Content-scan status does not authenticate a sender. The official AI/API pages report that current providers can return authentication `unknown`; the default extraction gate requires `pass`. Live capability acceptance does not misrepresent an access check as authenticated delivery.
- This project's npm commands are its own scripts. They are not invented Mermail CLI commands or MCP tools. REST endpoint contracts take precedence over broader descriptive examples.

## Automated coverage

`npm run check` runs strict TypeScript static/type checks, Prettier verification and the Node test suite. `npm test` builds and runs all deterministic tests. No live keys or external service connections are required. Runtime artifacts in fake messages are generated in memory; no recorded OTP, token or credential fixture is committed.

| Gate            | Test coverage                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mailbox policy  | Exact reuse; allowed/disabled creation; service/account mismatch; disabled/ambiguous boxes; uncertain-create reconciliation without write retries                        |
| Baseline        | Captured before signup; existing IDs excluded even with fresh dates; incomplete snapshots fail before signup                                                             |
| Correlation     | Delayed delivery; stale/future/malformed dates; exact sender/domain; wrong recipient/mailbox/service/attempt; display-name and domain-suffix spoofing                    |
| Ambiguity       | Multiple IDs including identical artifacts; delayed/cutoff competitors; duplicate IDs; repeated polls consume once; changed detail identity/content                      |
| Extraction      | OTP and safe URL success; missing/malformed/multiple artifact lines; absent/oversized/control-character bodies; clean/safe/omitted/truncated gates                       |
| Authentication  | Pass; unknown rejected by default; explicit correlation-only choice; fail always rejected                                                                                |
| Poll bounds     | Timeout, exact-cutoff delivery, capped backoff, transient list/detail retry, `Retry-After`, request budget, hanging operation cancellation                               |
| Untrusted input | Email instruction injection is inert; unsafe scheme/origin/path/query/userinfo/fragment/port/encoding links rejected                                                     |
| Privacy         | Allowlisted result excludes artifact, address, provider metadata and raw exception content; HTTP failures expose fixed reasons only                                      |
| Action boundary | Actual-payment and wallet-signature signals at start/continuation block without activating account; unavailable automation; independent work still succeeds              |
| REST contract   | Pinned origin/header, verification settings, idempotency, encoded IDs, dot-segment rejection, safe read/context controls, pagination shapes/caps and malformed wire data |
| Integration     | Real loopback HTTP signup and verification for OTP and link; REST-wire fixture joined to HTTP SaaS and deterministic delivery                                            |

The suite currently contains **94 passing tests**. The local OTP/create and link/reuse demos succeed. Dependency installation reported zero known vulnerabilities in the installed development dependency tree. This is not a claim of a comprehensive security audit.

## Clean-clone verification

Verified on 2026-09-13 from a fresh HTTPS clone of the feature branch at implementation commit `f2801c50bd78e00b7aee3a02a716e9b319b6e067`, using Node `22.23.1` and npm `10.9.8`. No dependencies or build output were copied into the clone. Its working tree remained clean after verification.

| Exact command   | Result                                                                       |
| --------------- | ---------------------------------------------------------------------------- |
| `npm ci`        | Exit 0; four packages installed, five audited, zero reported vulnerabilities |
| `npm run check` | Exit 0; strict type/static checks and formatting passed; 94 tests passed     |
| `npm test`      | Exit 0; 94 passed, zero failed/cancelled/skipped                             |
| `npm run build` | Exit 0                                                                       |

The [GitHub Actions run](https://github.com/stonegate-labs/mermail-autonomous-onboarding/actions/runs/34728660624) also passed all four commands plus both demos on `ubuntu-latest` and `windows-latest`, using Node 22. The skill frontmatter and 13 local documentation references were checked independently. Public artifact scanning found no private paths, machine identity, real credential patterns or unrelated project references.

## Live acceptance status

**Not run against Mermail: credentials absent.** The actual `npm run acceptance:live` command reports `skipped` with instructions to inject `MERMAIL_API_KEY`; it makes no network request in that state. This is not a live pass. No payment or wallet signature was needed or attempted.

With credentials, the command can verify list access, exact service/account reuse or one opt-in creation, email listing and safe detail/context reads of an explicitly selected test message. Each capability is reported separately. Creation is only proven by a run reporting `create_mailbox`, and a subsequent run can prove reuse. No arbitrary mailbox is created as a connection test. Empty or unconfigured mailboxes produce partial acceptance. `--required` makes absent/incomplete acceptance nonzero. See [live procedure](../references/mermail.md).

Still requiring a live environment: workspace permissions and credit availability, accepted hosted/custom address, receiving readiness, actual delivery, current wire behavior, and third-party continuation through a reviewed target adapter. The local fixture is not evidence for those claims. Default strict authentication may block consumption even when live access succeeds. A public video and upstream Mermail Skills PR are submission-stage artifacts, as documented in [submission preparation](submission.md).
