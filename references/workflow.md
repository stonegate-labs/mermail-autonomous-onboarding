# Workflow and target integration

## Trusted configuration

`src/model.ts` defines `Policy`, `Inbox`, `Target`, `Result` and the evidence schema. `onboard(inbox, target, policy)` in `src/orchestrator.ts` runs the state machine without an LLM. It clones the policy before calling external code. `options.clock` and `options.attemptId` are injection points for deterministic tests; production uses real time and a random UUID. Never reuse a test attempt ID for production.

The explicit `mailboxEmail` is a durable binding to one service and third-party account. `scopeName({service, account})` derives the expected mailbox display name from that pair. Store the binding in trusted deployment configuration. Display names are a conservative policy marker, not cryptographic ownership evidence. Existing mailboxes without this exact binding are intentionally not adopted automatically. Use stable, non-personal account identifiers. Do not run concurrent attempts against the same binding; coordinate that in the caller across processes.

Creation requires `allowCreate: true`, no exact address match, and server permission. There is one POST with an intent-derived idempotency key. An uncertain response triggers one exact-address reconciliation read; no write retry. Disabled, mismatched or ambiguous existing boxes stop the attempt. A mailbox newly provisioned but not receive-ready also stops; do not provision another address.

## Message contract

The shipped extractor supports a deliberately strict plain-text template. The target must echo a fresh non-secret attempt ID in both places:

```text
Subject: <configured subject> [<attempt ID>]

Service: <configured service>
Attempt: <attempt ID>
<configured artifact label>: <verification artifact>
```

The angle-bracket text denotes schema fields, not literal email content. Do not paste a real verification artifact into a fixture or prompt. Codes have a configured length and digit or uppercase-alphanumeric alphabet. Links require one configured label, exact HTTPS origin and path, one token parameter, and a bounded URL-safe token. Extra query parameters, userinfo, ports, fragments, percent encoding, path normalization tricks and unapproved destinations fail closed. Nothing automatically opens the link.

Adapt incompatible email templates in reviewed code with corresponding adversarial tests. A target that cannot echo attempt markers is unsupported by this default profile. Sender/subject substring matching or choosing the newest message is not an acceptable fallback. The exact recipient is checked independently of the mailbox API path. Display-name address forms are rejected rather than parsed heuristically. Domain-only sender matching accepts the exact domain, excluding subdomains and suffix lookalikes.

## States, bounds and ambiguity

The sequence is discover/provision → metadata baseline → signup → bounded polling → safe re-read → extraction → continuation → success. A typed error ends as `failed` or `blocked`. There is no automatic restart or re-submission of signup/verification writes.

The baseline contains authoritative Mermail `id` values, including non-clean metadata. The adapter walks at most ten 100-message pages; incomplete snapshots, changing totals and repeated IDs fail closed. Sorting/pagination are not an atomic server snapshot: use a dedicated low-volume mailbox and serialize attempts. Timestamp and attempt-marker checks independently protect against delayed old mail. Do not treat the email's date as authenticated freshness evidence.

Polls examine all metadata candidates. A single matching candidate is retained through the observation window so a later competitor can stop consumption. The final snapshot runs at the cutoff, with up to ten seconds of bounded I/O grace; timestamps after the cutoff remain excluded. Afterward, the selected detail is re-read and must be unchanged. An indistinguishable competing message under another ID is ambiguous even if it contains the same code. Repeated snapshots of an unchanged ID do not cause repeated continuation. Duplicate IDs inside a snapshot are an error.

The arrival window is at most five minutes. Preparation is separately bounded by the configured timeout; final reads/continuation have a ten-second phase budget. Each operation has a ten-second maximum and an abort signal. The orchestrator operation budget covers mailbox reads, provisioning, snapshots, detail reads and target calls. Mermail independently caps each adapter instance at 200 HTTP requests, two MB per decoded response and 1,000 messages per snapshot. These are local safety limits, not Mermail plan limits. Polling retries only transport, HTTP 429 and HTTP 5xx read failures, with capped exponential backoff and `Retry-After`; a server delay beyond the window stops. Preparation and writes are not automatically retried.

## Implementing a target

```ts
import { Mermail } from '../src/mermail.js';
import { onboard } from '../src/orchestrator.js';
import type { Target, Policy } from '../src/model.js';

// Supply these from reviewed application code and trusted configuration.
declare const target: Target;
declare const policy: Policy;
const inbox = new Mermail(process.env.MERMAIL_API_KEY!);
const result = await onboard(inbox, target, policy);
console.log(JSON.stringify(result)); // Only the allowlisted result is loggable.
```

`start` must initiate only the authorized signup and return the next action. `continue` receives the artifact in memory and must submit it only to a fixed service destination. Implementations must honor `AbortSignal`, bound response size, disable automatic redirects and avoid logging request bodies, headers, URLs or exceptions. For link verification, validate the initial URL and each redirect before any request; the safest adapter rejects redirects entirely. Extract a token locally and construct the service's fixed endpoint when its documented contract allows it. Use idempotency/session binding if the target supports it; after an uncertain signup or continuation response, reconcile through a documented read instead of repeating the mutation.

`Target` is trusted application code, not a sandbox for arbitrary scripts. It must return `payment`, `wallet_signature` or `unavailable` before a prohibited/impossible action. The orchestrator maps these to `blocked`; `requiredAction` is present only for actual payment/signing. There is no authorize-and-pay switch. A separate explicitly authorized implementation would be required for those actions. A caller processing multiple independent tasks should retain the blocked result and continue the others.

## Evidence and privacy

Evidence contains ordered fixed event names, elapsed milliseconds and counts. It intentionally omits mailbox addresses, message IDs, email content, artifact values, URL tokens, arbitrary target strings and raw errors. Capture it with the reviewed code revision and command to reproduce a run. It is a behavioral audit trail, not a cryptographic delivery receipt or proof that a remote provider authenticated a message. Secret-bearing artifacts necessarily exist briefly in process memory; JavaScript cannot guarantee secure memory erasure. Disable debugger snapshots, heap dumps and verbose HTTP tracing around live runs.
