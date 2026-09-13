import { FlowError, type Inbox, type Mail, type Mailbox } from './model.js';

type ObjectValue = Record<string, unknown>;
function segment(id: string): string {
  if (!id || id === '.' || id === '..') throw new FlowError('invalid_config');
  return encodeURIComponent(id);
}
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new FlowError('invalid_response');
  return value as ObjectValue;
}
function string(o: ObjectValue, key: string): string {
  const v = o[key];
  if (typeof v !== 'string' || !v || v.length > 16_384)
    throw new FlowError('invalid_response');
  return v;
}
function mailbox(value: unknown): Mailbox {
  const o = object(value);
  return {
    id: string(
      o,
      typeof o.public_id === 'string' && o.public_id ? 'public_id' : 'id',
    ),
    email: string(o, 'email'),
    name: string(o, 'name'),
    ready:
      o.disabled_at === null &&
      o.can_receive === true &&
      o.receiving_status === 'ready',
  };
}
function mail(value: unknown): Mail {
  const o = object(value);
  for (const field of [
    'content_omitted',
    'content_truncated',
    'agent_safe_content',
  ]) {
    if (o[field] !== undefined && typeof o[field] !== 'boolean')
      throw new FlowError('invalid_response');
  }
  const auth =
    o.sender_authentication === undefined
      ? undefined
      : object(o.sender_authentication).status;
  if (auth !== undefined && !['pass', 'fail', 'unknown'].includes(String(auth)))
    throw new FlowError('invalid_response');
  if (o.body !== undefined && typeof o.body !== 'string')
    throw new FlowError('invalid_response');
  return {
    id: string(o, 'id'),
    sender: string(o, 'sender'),
    recipient: string(o, 'recipient'),
    subject: string(o, 'subject'),
    date: string(o, 'date'),
    ...(typeof o.body === 'string' ? { body: o.body } : {}),
    clean: o.scan_status === 'clean',
    safe: o.agent_safe_content === true,
    omitted: o.content_omitted === true,
    truncated: o.content_truncated === true,
    authentication: auth === 'pass' || auth === 'fail' ? auth : 'unknown',
  };
}

export class Mermail implements Inbox {
  #key: string;
  #requests = 0;
  constructor(
    key: string,
    private readonly transport: typeof fetch = fetch,
  ) {
    if (!key.startsWith('sk-proj-') || /\s/.test(key))
      throw new FlowError('invalid_config');
    this.#key = key;
  }

  private async request(
    path: string,
    signal: AbortSignal,
    body?: unknown,
    key?: string,
  ): Promise<unknown> {
    if (++this.#requests > 200) throw new FlowError('request_budget');
    try {
      const response = await this.transport(
        `https://console.mermail.app/api/v1${path}`,
        {
          method: body === undefined ? 'GET' : 'POST',
          redirect: 'error',
          signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
          headers: {
            'x-api-key': this.#key,
            Accept: 'application/json',
            ...(body === undefined
              ? {}
              : { 'Content-Type': 'application/json' }),
            ...(key ? { 'Idempotency-Key': key } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        const code =
          response.status === 401
            ? 'unauthorized'
            : response.status === 402
              ? 'credits_exhausted'
              : response.status === 403
                ? 'forbidden'
                : response.status === 429
                  ? 'rate_limited'
                  : response.status >= 500
                    ? 'remote_failure'
                    : 'invalid_response';
        const retry = response.headers.get('retry-after');
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : 0;
        throw new FlowError(code, Math.min(seconds * 1000, 86_400_000));
      }
      // Bound the decoded stream too; Content-Length alone does not bound chunked data.
      const reader = response.body?.getReader();
      if (!reader) throw new FlowError('invalid_response');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 2_000_000) throw new FlowError('invalid_response');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch {
        throw new FlowError('invalid_response');
      }
    } catch (error) {
      if (error instanceof FlowError) throw error;
      throw new FlowError('transport'); // Never return remote text, URLs, or original exception.
    }
  }

  async listMailboxes(signal: AbortSignal): Promise<Mailbox[]> {
    const result = await this.request('/mailboxes', signal);
    if (!Array.isArray(result) || result.length > 1000)
      throw new FlowError('invalid_response');
    return result.map(mailbox);
  }
  async createMailbox(
    email: string,
    name: string,
    key: string,
    signal: AbortSignal,
  ): Promise<Mailbox> {
    return mailbox(
      await this.request(
        '/mailboxes',
        signal,
        {
          email,
          name,
          settings: {
            agentInbox: {
              mode: 'verification',
              automationsEnabled: false,
              requireCleanScanForAutomation: true,
            },
          },
        },
        key,
      ),
    );
  }
  async listEmails(id: string, signal: AbortSignal): Promise<Mail[]> {
    const all: Mail[] = [];
    let expectedTotal: number | undefined;
    for (let page = 1; page <= 10; page++) {
      const query = new URLSearchParams({
        metadata_only: 'true',
        agent_safe_content: 'true',
        include_held: 'true',
        threaded: 'false',
        page: String(page),
        limit: '100',
        sortColumn: 'date',
        sortDirection: 'DESC',
      });
      const result = await this.request(
        `/mailboxes/${segment(id)}/emails?${query}`,
        signal,
      );
      const envelope = Array.isArray(result) ? undefined : object(result);
      const items: unknown = envelope ? envelope.emails : result;
      if (!Array.isArray(items) || items.length > 100)
        throw new FlowError('invalid_response');
      if (envelope) {
        const total = envelope.totalCount;
        if (!Number.isSafeInteger(total) || (total as number) < 0)
          throw new FlowError('invalid_response');
        if (expectedTotal !== undefined && total !== expectedTotal)
          throw new FlowError('snapshot_incomplete');
        expectedTotal = total as number;
      }
      all.push(
        ...items.map((item: unknown) => {
          const normalized = mail(item);
          delete normalized.body; // Metadata snapshots never retain content even if server over-returns.
          return normalized;
        }),
      );
      if (new Set(all.map((m) => m.id)).size !== all.length)
        throw new FlowError('duplicate_message');
      if (expectedTotal !== undefined && all.length > expectedTotal)
        throw new FlowError('snapshot_incomplete');
      if (items.length < 100) {
        if (expectedTotal !== undefined && all.length !== expectedTotal)
          throw new FlowError('snapshot_incomplete');
        return all;
      }
      if (expectedTotal === all.length) return all;
    }
    throw new FlowError('snapshot_incomplete');
  }
  async getSafeEmail(
    id: string,
    emailId: string,
    signal: AbortSignal,
  ): Promise<Mail> {
    const query =
      'agent_safe_content=true&require_scan_status=clean&max_body_chars=16384&include_held=true';
    return mail(
      await this.request(
        `/mailboxes/${segment(id)}/emails/${segment(emailId)}?${query}`,
        signal,
      ),
    );
  }
  async getSafeContext(
    id: string,
    emailId: string,
    signal: AbortSignal,
  ): Promise<Mail> {
    const result = object(
      await this.request(
        `/mailboxes/${segment(id)}/emails/${segment(emailId)}/context?limit=1&include_held=true`,
        signal,
      ),
    );
    object(result.thread); // Never mine thread history for another attempt's artifact.
    return mail(result.email);
  }
}
