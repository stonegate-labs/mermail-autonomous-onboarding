# Mermail autonomous onboarding

A portable Agent Skill and small TypeScript library for using a service-scoped inbox during API/SaaS onboarding. It prevents a common automation failure: consuming a stale, unrelated or ambiguous verification email as though it belonged to the current signup.

The skill discovers or provisions one scoped mailbox, records a baseline before signup, correlates new mail, extracts only an expected code or safe link, and continues through a trusted target adapter. It produces a redacted event trail. The bounded demo runs a real local HTTP signup/verification server with deterministic in-memory email delivery; no paid service or credentials are needed.

## Install and quickstart

Use Node 22 (current maintained 22.x; verified on 22.23.1) and npm. Clone the review branch:

```sh
git clone --branch feature/phase1.5/mermail-autonomous-onboarding https://github.com/stonegate-labs/mermail-autonomous-onboarding.git
cd mermail-autonomous-onboarding
npm ci
npm run demo
npm run demo -- --link --reuse
```

To install as an Agent Skill, place the **whole repository folder** in the skill discovery directory configured by your Agent Skills-compatible client, or point the client to `SKILL.md`. Retain the package, source and reference files alongside it and run `npm ci` there. It works without a platform plugin or an LLM-specific SDK. In Codex, Claude Code, Cursor or another compatible client, ask: “Use mermail-autonomous-onboarding to run the local API signup demonstration.” See [SKILL.md](SKILL.md) for trigger examples and progressive loading.

## Demo

`npm run demo` visibly reports `mailbox_created → baseline_recorded → signup_started → poll → email_correlated → artifact_extracted → continuation_started → succeeded`. `--reuse` starts with an existing scoped mailbox. `--link` exercises strict verification URL extraction. JSON output is explicitly marked `local_fake_saas`; artifact values never appear. Virtual time makes delayed delivery and backoff repeatable. The loopback HTTP server uses an ephemeral port and closes after each run.

The [recording script](docs/demo.md) includes a short narration and exact commands. Real Mermail capability checks are separate:

```sh
npm run acceptance:live
```

Without `MERMAIL_API_KEY`, this cleanly reports `skipped`. With credentials, start with list access; provide the explicit service/account mailbox binding and authorized test message for reuse/read. `--allow-create` is an additional opt-in for one absent mailbox; `--required` makes incomplete acceptance nonzero. See [the integration reference](references/mermail.md). No live acceptance has been claimed without credentials.

## Architecture

| Component                             | Responsibility                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `SKILL.md`, `references/`             | Reusable entry point; load only the workflow/integration material needed                 |
| `src/mermail.ts`                      | Official REST contract, safe projections, bounded pagination and HTTP I/O                |
| `src/policy.ts`                       | Exact service/account mailbox binding, reuse/create reconciliation and action boundaries |
| `src/polling.ts`                      | Operation budget, cancellation and retry/backoff policy                                  |
| `src/extraction.ts`                   | Exact correlation, safety gates, code and HTTPS URL validation                           |
| `src/orchestrator.ts`, `src/model.ts` | State machine, trusted target interface and typed results                                |
| `src/evidence.ts`                     | Allowlisted redacted event projection                                                    |
| `src/fake.ts`                         | Deterministic inbox, virtual clock and local HTTP SaaS                                   |
| `test/integration.test.ts`            | Executable Mermail wire fixture joined to the HTTP demo target                           |

There are no production dependencies. TypeScript performs strict type/static checks; Prettier checks formatting; Node's test runner executes deterministic unit and integration tests. Tests run in one process with isolated fixture instances, including on hosts that disallow child test processes.

## Safety model and scope

Email is untrusted data. It cannot modify the target, policy, workspace, commands, destination or payment/signing permissions. Only one narrowly expected artifact reaches the trusted target adapter, in memory. The default profile requires a fresh attempt marker in subject and body, an exact service marker, sender/recipient matching, a clean scan and sender authentication. Ambiguity, duplicate IDs, changed content, malformed/truncated bodies and unsafe URLs fail closed. Unknown sender authentication is never treated as a pass.

The code observes the entire configured arrival window and re-reads before continuation; it never silently chooses the newest email. Evidence contains only fixed events, elapsed times and counts. It is suitable for demonstrations without exposing credentials, mailbox addresses, codes or link tokens. No email content is passed to a model, shell or command executor.

The target adapter must signal an actual payment or wallet signature before initiating it. Those return machine-readable `blocked` results and this code has no payment/signing capability. Ordinary account setup and verification proceed under the user's authorization. CAPTCHA/terms steps call for compliant automation, supported alternatives, or `automation_unavailable`; security bypass and deceptive automation are not supported. Independent tasks may continue after any block.

This is a reusable orchestration foundation with a strict template and a working bounded demo, not universal browser automation. A real SaaS needs a reviewed target adapter and correlation profile; a service that does not echo the required nonce is not supported by the default profile. Dedicated mailboxes and serialized attempts are required. Current Mermail providers can report unknown sender authentication, which the default extraction policy rejects. See [workflow limits](references/workflow.md) and [acceptance evidence](docs/acceptance.md).

## Exact verification commands

```sh
npm ci
npm run check
npm test
npm run build
```

`check` runs strict type/static checks, format verification and the tests. Tests require neither credentials nor external network services; the HTTP fixture binds only to loopback. Live acceptance is deliberately excluded from CI. A Node 22 Linux/Windows workflow runs the four gates on pushes and pull requests.

MIT licensed. See [submission preparation](docs/submission.md) for bounty requirements and outstanding public demo links.
