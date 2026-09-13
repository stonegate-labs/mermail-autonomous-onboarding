import {
  FlowError,
  type ArtifactPolicy,
  type Mail,
  type Policy,
} from './model.js';
import { address } from './policy.js';

export function correlates(
  m: Mail,
  p: Policy,
  attemptId: string,
  start: number,
  end: number,
): boolean {
  let from: string;
  let to: string;
  try {
    from = address(m.sender);
    to = address(m.recipient);
  } catch {
    return false;
  }
  const senderMatches =
    'address' in p.sender
      ? from === address(p.sender.address)
      : from.split('@')[1] === p.sender.domain.toLowerCase();
  const time = Date.parse(m.date);
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      m.date,
    ) &&
    senderMatches &&
    to === address(p.mailboxEmail) &&
    Number.isFinite(time) &&
    time >= start &&
    time <= end &&
    m.subject === `${p.subject} [${attemptId}]`
  );
}

export function extract(m: Mail, p: Policy, attemptId: string): string {
  if (!m.clean || !m.safe || m.omitted || m.truncated)
    throw new FlowError('unsafe_content');
  if (
    m.authentication === 'fail' ||
    (p.requireAuthenticatedSender && m.authentication !== 'pass')
  )
    throw new FlowError('sender_unauthenticated');
  if (
    typeof m.body !== 'string' ||
    m.body.length > 16_384 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(m.body)
  )
    throw new FlowError('malformed_email');
  const lines = m.body.split(/\r?\n/);
  if (
    lines.filter((l) => l === `Service: ${p.service}`).length !== 1 ||
    lines.filter((l) => l === `Attempt: ${attemptId}`).length !== 1
  )
    throw new FlowError('malformed_email');
  const prefix = `${p.artifact.label}: `;
  const values = lines
    .filter((l) => l.startsWith(prefix))
    .map((l) => l.slice(prefix.length));
  if (values.length > 1) throw new FlowError('ambiguous');
  const value = values[0];
  if (!value) throw new FlowError('missing_artifact');
  if (p.artifact.kind === 'link') return safeLink(value, p.artifact);
  const alphabet = p.artifact.alphabet === 'digits' ? '[0-9]' : '[A-Z0-9]';
  if (!new RegExp(`^${alphabet}{${p.artifact.length}}$`).test(value))
    throw new FlowError('malformed_email');
  return value;
}

export function safeLink(
  value: string,
  p: Extract<ArtifactPolicy, { kind: 'link' }>,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FlowError('unsafe_link');
  }
  const keys = [...url.searchParams.keys()];
  const token = url.searchParams.get(p.tokenParameter);
  if (
    value !== url.href ||
    /[\\\s%]/.test(value) ||
    url.protocol !== 'https:' ||
    url.origin !== p.origin ||
    url.pathname !== p.path ||
    url.username ||
    url.password ||
    url.hash ||
    keys.length !== 1 ||
    keys[0] !== p.tokenParameter ||
    !token ||
    !/^[a-zA-Z0-9_-]{16,256}$/.test(token)
  )
    throw new FlowError('unsafe_link');
  return url.href;
}
