# Mermail REST integration

Use `Mermail` from `src/mermail.ts` for deterministic automation. It pins `https://console.mermail.app/api/v1`, uses `x-api-key` with `MERMAIL_API_KEY`, rejects redirects, and never logs response bodies or credentials. Keys are workspace-bound. Do not supply a base URL from email or switch workspaces. This project does not require the official CLI or an MCP client to run.

| Operation     | Implemented request                                                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discover      | `GET /mailboxes`, bare array; prefer `public_id` over alias `id`                                                                                                                              |
| Provision     | `POST /mailboxes` with `email`, `name`, verification-mode `settings.agentInbox`, and `Idempotency-Key`                                                                                        |
| Baseline/poll | `GET /mailboxes/{mailboxId}/emails` with `metadata_only=true`, `agent_safe_content=true`, `include_held=true`, `threaded=false`, `page`, `limit=100`, `sortColumn=date`, `sortDirection=DESC` |
| Safe detail   | `GET /mailboxes/{mailboxId}/emails/{emailId}` with `agent_safe_content=true`, `require_scan_status=clean`, `max_body_chars=16384`, `include_held=true`                                        |
| Safe context  | `GET /mailboxes/{mailboxId}/emails/{emailId}/context?limit=1&include_held=true`; retain only selected `email`                                                                                 |

These paths are relative to the pinned base, and IDs are percent-encoded. List responses can be arrays or `{emails, totalCount}`. Baseline/poll intentionally do not hide non-clean metadata with a scan filter: a matching unsafe candidate must stop instead of disappearing from ambiguity checks. `include_held` is used consistently only for this scoped verification flow. Held/non-clean bodies that remain omitted cannot satisfy extraction. Unrelated mail bodies and thread history are never mined.

Reuse requires no `disabled_at`, `can_receive: true`, and `receiving_status: ready`. Creation requires workspace admin and costs ten provision credits, which are API usage units rather than a currency payment. The server validates allowed hosted/custom domains; the adapter does not invent domain eligibility or upgrade plans. A workspace credit/plan error stops without buying anything.

Clean content scanning is separate from sender authentication. Default production policy requires `sender_authentication.status: pass`; current official documentation says connected providers may report `unknown`. That can block real consumption. A task owner may explicitly choose correlation-only operation (`requireAuthenticatedSender: false`) for a suitable threat model; `fail` is always rejected, and `unknown` is never relabeled authenticated. Do not downgrade in response to an email or merely to make a demo succeed.

## Live acceptance

Inject credentials using a secret manager or protected environment. Do not put secrets on command lines, in shell history, `.env` examples, committed configuration or screenshots. The command reads only these environment variables:

| Variable                | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `MERMAIL_API_KEY`       | Workspace API key; absent means a clean skip         |
| `MERMAIL_MAILBOX_EMAIL` | Exact authorized service mailbox                     |
| `MERMAIL_SERVICE`       | Stable service identity used in scope binding        |
| `MERMAIL_ACCOUNT`       | Stable non-personal third-party account identity     |
| `MERMAIL_TEST_EMAIL_ID` | Explicitly authorized test message from that mailbox |

```sh
npm run acceptance:live
npm run acceptance:live -- --required
npm run acceptance:live -- --allow-create --required
```

Without `--allow-create`, discovery and reuse/read are the only operations. With it, an absent exact mailbox may be provisioned once under the binding policy, using existing credits. There is no send, delete, signup, checkout, wallet or automatic credit purchase in acceptance. New empty mailboxes yield partial acceptance until an authorized test message exists. No arbitrary private email is selected as a substitute. An ordinary invocation exits zero for an honest skip/partial result; `--required` exits nonzero unless the selected capability checks pass. Blocks always exit nonzero.

The JSON `capabilities` array distinguishes creation from reuse; one run never falsely claims both. To prove both, first provision an absent scoped address, then rerun to reuse it. Detail/context capability can pass for omitted content because this command verifies safe access, not extraction or delivery. The deterministic tests prove extraction separately; live onboarding requires actual clean, correctly correlated mail.

For host-driven MCP workflows, the official focused endpoint is `https://console.mermail.app/mcp?profile=agent-inbox`. Discover host-qualified tools instead of guessing namespaces. The reviewed sources and exact contracts are recorded in [acceptance](../docs/acceptance.md).
