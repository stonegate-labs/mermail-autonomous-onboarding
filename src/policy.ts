import { createHash } from 'node:crypto';
import {
  FlowError,
  type Inbox,
  type Mailbox,
  type Policy,
  type Action,
} from './model.js';

export function address(value: string): string {
  if (typeof value !== 'string') throw new FlowError('invalid_config');
  const normalized = value.trim().toLowerCase();
  if (
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(
      normalized,
    ) ||
    normalized.length > 254 ||
    normalized.includes('..')
  ) {
    throw new FlowError('invalid_config');
  }
  return normalized;
}

export function scopeName(policy: Pick<Policy, 'service' | 'account'>): string {
  return (
    'onboarding-' +
    createHash('sha256')
      .update(JSON.stringify([policy.service, policy.account]))
      .digest('hex')
      .slice(0, 24)
  );
}

export function validatePolicy(p: Policy): void {
  if (
    typeof p.allowCreate !== 'boolean' ||
    typeof p.requireAuthenticatedSender !== 'boolean'
  )
    throw new FlowError('invalid_config');
  for (const text of [p.service, p.account, p.subject, p.artifact.label]) {
    if (
      typeof text !== 'string' ||
      !text ||
      text.length > 200 ||
      /[\r\n\x00-\x1f]/.test(text)
    )
      throw new FlowError('invalid_config');
  }
  address(p.mailboxEmail);
  if ('address' in p.sender) address(p.sender.address);
  else if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/i.test(p.sender.domain))
    throw new FlowError('invalid_config');
  for (const n of [
    p.timeoutMs,
    p.initialBackoffMs,
    p.maxBackoffMs,
    p.maxOperations,
  ]) {
    if (!Number.isSafeInteger(n) || n <= 0)
      throw new FlowError('invalid_config');
  }
  if (
    p.timeoutMs > 300_000 ||
    p.maxBackoffMs < p.initialBackoffMs ||
    p.maxOperations > 500
  )
    throw new FlowError('invalid_config');
  if (p.artifact.kind === 'code') {
    if (
      !Number.isInteger(p.artifact.length) ||
      !['digits', 'alphanumeric'].includes(p.artifact.alphabet) ||
      p.artifact.length < 4 ||
      p.artifact.length > 32
    )
      throw new FlowError('invalid_config');
  } else {
    let u: URL;
    try {
      u = new URL(p.artifact.origin);
    } catch {
      throw new FlowError('invalid_config');
    }
    if (
      u.protocol !== 'https:' ||
      u.origin !== p.artifact.origin ||
      u.username ||
      u.password ||
      u.port ||
      !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname) ||
      !/^\/[a-zA-Z0-9/_-]*$/.test(p.artifact.path) ||
      !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(p.artifact.tokenParameter)
    )
      throw new FlowError('invalid_config');
  }
}

export function boundary(action: Action | 'success'): void {
  if (action === 'payment') throw new FlowError('payment_required');
  if (action === 'wallet_signature')
    throw new FlowError('wallet_signature_required');
  if (action === 'unavailable') throw new FlowError('automation_unavailable');
  if (action !== 'success' && action !== 'verification')
    throw new FlowError('invalid_response');
}

export async function ensureMailbox(
  inbox: Inbox,
  p: Policy,
  signal: AbortSignal,
): Promise<{ mailbox: Mailbox; created: boolean }> {
  validatePolicy(p);
  const email = address(p.mailboxEmail);
  const name = scopeName(p);
  function choose(boxes: Mailbox[]): Mailbox | undefined {
    const matches = boxes.filter((b) => address(b.email) === email);
    if (matches.length > 1) throw new FlowError('mailbox_ambiguous');
    const box = matches[0];
    if (box && (!box.ready || box.name !== name))
      throw new FlowError('mailbox_unavailable');
    return box;
  }
  const existing = choose(await inbox.listMailboxes(signal));
  if (existing) return { mailbox: existing, created: false };
  if (!p.allowCreate) throw new FlowError('creation_disabled');
  const key = createHash('sha256')
    .update(JSON.stringify([email, name]))
    .digest('hex');
  let created: Mailbox;
  try {
    created = await inbox.createMailbox(email, name, key, signal);
  } catch (error) {
    if (
      error instanceof FlowError &&
      ['unauthorized', 'forbidden', 'credits_exhausted'].includes(error.code)
    )
      throw error;
    // One reconciliation read; never retry a provisioning write.
    const recovered = choose(await inbox.listMailboxes(signal));
    if (recovered) return { mailbox: recovered, created: false };
    throw new FlowError('create_uncertain');
  }
  const checked = choose([created]);
  if (!checked) throw new FlowError('invalid_response');
  return { mailbox: checked, created: true };
}
