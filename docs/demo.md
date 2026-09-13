# Reproducible 2–5 minute demonstration

Use a clean terminal with no credential environment displayed, no debug HTTP tracing, and a neutral working-directory prompt. Record only the documented commands and redacted output. Never display shell history, secret-manager screens, raw email, browser cookies or developer network requests.

1. **0:00–0:25 — Trigger the skill.** Show the prompt: “Use mermail-autonomous-onboarding to demonstrate autonomous API signup using the deterministic local target, then report redacted evidence.” Have the client read `SKILL.md`.
2. **0:25–1:15 — Complete signup.** Run `npm ci` if needed, then `npm run demo`. Explain that the local SaaS receives an HTTP signup, generates a verification email at runtime, and exposes it after a deterministic delay. Point to the baseline before signup, polling, one correlated message, extraction and successful continuation. The code remains hidden.
3. **1:15–1:55 — Show reuse and link safety.** Run `npm run demo -- --link --reuse`. Point to `mailbox_reused`, the link mode and final success. The initial link is validated locally and its value is consumed only by the fixed loopback verification endpoint. No external link is opened.
4. **1:55–2:40 — Show the safety gates.** Run `npm test`. Highlight the passing stale-message, competing-message, prompt injection, unsafe-link and payment/signing tests. There are no live credentials in the tests.
5. **2:40–3:30 — Real integration, when configured.** Run `npm run acceptance:live -- --required` with credentials already injected privately and a dedicated test message selected. Show only the capability JSON. Clearly distinguish actual Mermail list/reuse/read from the local end-to-end simulation. Without credentials, show the honest skip and do not claim real Mermail acceptance or a bounty-complete video.

Expected demo events are `mailbox_created` or `mailbox_reused`, `baseline_recorded`, `signup_started`, bounded `poll` events, `email_correlated`, `artifact_extracted`, `continuation_started`, and `succeeded`. The final result is `status: success`. Exact virtual timings are repeatable, and no OTP/code or URL token is printed.

The bounty requires actual Mermail use in the video, an English 2–5 minute recording posted on X tagging `@Mermailapp`, and an upstream Mermail Skills PR. A local-only recording is a reproducible development demo, not fulfillment of those external publication requirements. This repository supplies the script and executable demo; no video publication is claimed.
