import { randomUUID } from 'node:crypto';
import {
  FlowError,
  failure,
  realClock,
  type Clock,
  type Evidence,
  type Inbox,
  type Mail,
  type Policy,
  type Result,
  type Target,
} from './model.js';
import { ensureMailbox, validatePolicy, boundary } from './policy.js';
import { correlates, extract } from './extraction.js';
import { record } from './evidence.js';
import { Budget, retryable, delayFor } from './polling.js';

export async function onboard(
  inbox: Inbox,
  target: Target,
  input: Policy,
  options: { clock?: Clock; attemptId?: string } = {},
): Promise<Result> {
  const clock = options.clock ?? realClock;
  const begun = clock.now();
  const evidence: Evidence[] = [];
  const emit = (event: Evidence['event'], count?: number) =>
    record(evidence, event, clock.now() - begun, count);
  try {
    // Snapshot trusted configuration so callbacks/email cannot mutate policy mid-flow.
    const p = structuredClone(input);
    validatePolicy(p);
    const attemptId = options.attemptId ?? randomUUID();
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(attemptId))
      throw new FlowError('invalid_config');
    const budget = new Budget(clock, p.maxOperations);
    let deadline = begun + p.timeoutMs;
    const guarded: Inbox = {
      listMailboxes: () => budget.call(deadline, (s) => inbox.listMailboxes(s)),
      createMailbox: (e, n, k) =>
        budget.call(deadline, (s) => inbox.createMailbox(e, n, k, s)),
      listEmails: (b) => budget.call(deadline, (s) => inbox.listEmails(b, s)),
      getSafeEmail: (b, id) =>
        budget.call(deadline, (s) => inbox.getSafeEmail(b, id, s)),
    };
    const placeholderSignal = new AbortController().signal;
    const { mailbox, created } = await ensureMailbox(
      guarded,
      p,
      placeholderSignal,
    );
    emit(created ? 'mailbox_created' : 'mailbox_reused');
    const baselineMail = await guarded.listEmails(
      mailbox.id,
      placeholderSignal,
    );
    const baseline = new Set(baselineMail.map((m) => m.id));
    if (baseline.size !== baselineMail.length)
      throw new FlowError('duplicate_message');
    emit('baseline_recorded', baseline.size);
    const start = clock.now();
    deadline = start + p.timeoutMs;
    const arrivalDeadline = deadline;
    boundary(
      await budget.call(deadline, (s) =>
        target.start(
          { email: mailbox.email, attemptId, service: p.service },
          s,
        ),
      ),
    );
    emit('signup_started');
    // Polls may finish after the arrival cutoff. Give all observation I/O a
    // fixed grace window, including the final snapshot and candidate reads;
    // this never extends the timestamps eligible for correlation.
    deadline = arrivalDeadline + 10_000;
    const candidates = new Map<string, Mail>();
    const unresolved = new Set<string>();
    const seen = new Map<string, string>();
    let backoff = p.initialBackoffMs;
    let successfulPoll = false;
    while (true) {
      const finalPoll = clock.now() >= arrivalDeadline;
      // Always take a final snapshot, even when the preceding poll crossed
      // the cutoff. The shared I/O deadline is never renewed while polling.
      let wait = backoff;
      try {
        const messages = await guarded.listEmails(
          mailbox.id,
          placeholderSignal,
        );
        successfulPoll = true;
        emit('poll', messages.length);
        const ids = new Set<string>();
        for (const m of messages) {
          if (!m.id || ids.has(m.id)) throw new FlowError('duplicate_message');
          ids.add(m.id);
          if (baseline.has(m.id)) continue;
          const fingerprint = JSON.stringify(m);
          const prior = seen.get(m.id);
          if (prior !== undefined && prior !== fingerprint)
            throw new FlowError('message_changed');
          seen.set(m.id, fingerprint);
          if (
            !correlates(
              m,
              p,
              attemptId,
              start,
              Math.min(clock.now(), arrivalDeadline),
            )
          ) {
            if (prior === undefined) emit('message_rejected');
            continue;
          }
          if (!candidates.has(m.id)) unresolved.add(m.id);
        }
        // Record the whole snapshot before fallible detail I/O. An observed
        // matching ID remains unresolved even if subsequent lists omit it.
        for (const id of unresolved) {
          const detail = await guarded.getSafeEmail(
            mailbox.id,
            id,
            placeholderSignal,
          );
          if (
            detail.id !== id ||
            !correlates(
              detail,
              p,
              attemptId,
              start,
              Math.min(clock.now(), arrivalDeadline),
            )
          )
            throw new FlowError('message_changed');
          extract(detail, p, attemptId); // Validate all candidates, without logging/persisting the value.
          candidates.set(id, detail);
          unresolved.delete(id);
          if (candidates.size > 1) throw new FlowError('ambiguous');
          emit('email_correlated');
        }
      } catch (error) {
        if (!retryable(error)) throw error;
        if (finalPoll) throw new FlowError('timeout');
        successfulPoll = false;
        wait = delayFor(backoff, error);
        emit('retry');
      }
      if (finalPoll) break;
      const remaining = arrivalDeadline - clock.now();
      if (!successfulPoll && wait > remaining) throw new FlowError('timeout');
      if (remaining > 0) await clock.sleep(Math.min(wait, remaining));
      backoff = Math.min(backoff * 2, p.maxBackoffMs);
    }
    if (!successfulPoll || candidates.size !== 1 || unresolved.size !== 0)
      throw new FlowError('timeout');
    const chosen = [...candidates.values()][0]!;
    // Re-read after the observation window: fail closed if the accepted content changed.
    deadline = clock.now() + 10_000;
    const final = await guarded.getSafeEmail(
      mailbox.id,
      chosen.id,
      placeholderSignal,
    );
    if (JSON.stringify(chosen) !== JSON.stringify(final))
      throw new FlowError('message_changed');
    let artifact = extract(final, p, attemptId);
    emit('artifact_extracted');
    emit('continuation_started');
    try {
      const outcome = await budget.call(deadline, (s) =>
        target.continue({ attemptId, artifact, kind: p.artifact.kind }, s),
      );
      boundary(outcome);
      if (outcome !== 'success') throw new FlowError('verification_failed');
    } finally {
      artifact = '';
      candidates.clear();
    }
    emit('succeeded');
    return { status: 'success', evidence };
  } catch (error) {
    const reason = failure(error);
    emit('stopped');
    const requiredAction =
      reason === 'payment_required'
        ? 'actual_payment'
        : reason === 'wallet_signature_required'
          ? 'actual_wallet_signature'
          : undefined;
    const blocked =
      requiredAction !== undefined ||
      [
        'automation_unavailable',
        'credits_exhausted',
        'unauthorized',
        'forbidden',
        'creation_disabled',
        'mailbox_unavailable',
      ].includes(reason);
    return {
      status: blocked ? 'blocked' : 'failed',
      reason,
      ...(requiredAction ? { requiredAction } : {}),
      evidence,
    };
  }
}
