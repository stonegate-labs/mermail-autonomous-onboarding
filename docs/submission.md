# Submission preparation

## Description

Mermail Autonomous Onboarding is a portable Agent Skill that gives an API signup its own service/account inbox binding. A deterministic TypeScript state machine discovers or provisions the mailbox, captures a baseline, correlates fresh verification mail, rejects ambiguity and unsafe content, and consumes only the expected code or validated link. Redacted evidence shows each stage without disclosing credentials or verification values.

The repeatable demo joins a local HTTP SaaS to delayed email delivery. An executable REST fixture tests the reviewed Mermail wire contract; separate opt-in acceptance checks real mailbox and safe-read capabilities. No payment or wallet signature is initiated.

## Links and client

- Repository: https://github.com/stonegate-labs/mermail-autonomous-onboarding
- Project review PR: `PROJECT_PR_URL` (replace after publication).
- Required upstream PR to https://github.com/Nudgen-Marketing/mermail-skills: `UPSTREAM_PR_URL`.
- English 2–5 minute video posted on X, tagging `@Mermailapp`: `DEMO_X_URL`.
- AI client demonstrated: `RECORDED_CLIENT_AND_VERSION` (fill from the actual recording).

## Judging highlights

- Quality: one progressive `SKILL.md`, narrow modules, documented contracts and fail-closed behavior.
- Working demo: actual local HTTP signup and verification, with delayed delivery and redacted continuation evidence.
- Reusability: Node 22, no runtime dependencies, deterministic tests, a trusted target interface and opt-in live acceptance.
- Useful capability: service/account binding and attempt correlation prevent stale or competing mail from completing the wrong signup.

## Completion checklist and known limits

The [official listing](https://superteam.fun/earn/listing/build-and-demo-a-mermail-agent-skill), reviewed 2026-09-13, requires an English submission, a public PR **targeting the Mermail Skills repository**, a video showing the skill trigger, actual Mermail use, completed workflow and final result, plus a short description and AI client. A PR to this project's `main` is the implementation review artifact and is not the required upstream submission. No special license requirement was found; this implementation uses MIT.

Before external submission, record real acceptance with an authorized dedicated test message, complete the actual-client recording, publish the video, prepare the upstream package according to that repository's contribution rules, and replace the link placeholders. Do not submit with placeholders or represent the simulated inbox as live Mermail. Upstream PR creation and video posting are not claimed by this implementation branch.

Live acceptance was unavailable without credentials. The default correlation profile requires target-reflected attempt markers; arbitrary SaaS templates need a reviewed adapter/profile. Unknown sender authentication blocks default artifact consumption. Evidence is deliberately content-free and cannot prove cryptographic delivery or provider authentication. See [acceptance](acceptance.md) for exact gates and source review.
