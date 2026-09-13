import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import {
  FlowError,
  type Clock,
  type Inbox,
  type Mail,
  type Mailbox,
  type Policy,
  type Target,
  type Action,
} from './model.js';
import { scopeName } from './policy.js';

export class VirtualClock implements Clock {
  time = Date.parse('2026-01-01T00:00:00.000Z');
  sleeps: number[] = [];
  now(): number {
    return this.time;
  }
  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.time += ms;
  }
}

export function demoPolicy(kind: 'code' | 'link' = 'code'): Policy {
  return {
    service: 'Example SaaS',
    account: 'demo-account',
    mailboxEmail: 'example-demo@mermail.app',
    allowCreate: true,
    sender: { address: 'verify@example.test' },
    subject: 'Verify Example SaaS',
    artifact:
      kind === 'code'
        ? { kind, label: 'Code', length: 6, alphabet: 'digits' }
        : {
            kind,
            label: 'Verify',
            origin: 'https://example.test',
            path: '/verify',
            tokenParameter: 'token',
          },
    requireAuthenticatedSender: true,
    timeoutMs: 1000,
    initialBackoffMs: 100,
    maxBackoffMs: 300,
    maxOperations: 60,
  };
}

export class FakeInbox implements Inbox {
  boxes: Mailbox[] = [];
  messages: { mailboxId: string; at: number; mail: Mail }[] = [];
  creates = 0;
  reads = 0;
  lists = 0;
  constructor(readonly clock: Clock) {}
  async listMailboxes(): Promise<Mailbox[]> {
    return structuredClone(this.boxes);
  }
  async createMailbox(email: string, name: string): Promise<Mailbox> {
    this.creates++;
    const box = {
      id: `fake-mailbox-${this.creates}`,
      email,
      name,
      ready: true,
    };
    this.boxes.push(box);
    return structuredClone(box);
  }
  async listEmails(mailboxId: string): Promise<Mail[]> {
    this.lists++;
    return this.messages
      .filter((m) => m.mailboxId === mailboxId && m.at <= this.clock.now())
      .map((m) => {
        const copy = structuredClone(m.mail);
        delete copy.body;
        return copy;
      });
  }
  async getSafeEmail(mailboxId: string, id: string): Promise<Mail> {
    this.reads++;
    const found = this.messages.find(
      (m) =>
        m.mailboxId === mailboxId &&
        m.mail.id === id &&
        m.at <= this.clock.now(),
    );
    if (!found) throw new FlowError('invalid_response');
    return structuredClone(found.mail);
  }
  reuse(p: Policy): void {
    this.boxes.push({
      id: 'fake-existing',
      email: p.mailboxEmail,
      name: scopeName(p),
      ready: true,
    });
  }
}

export class FakeSaaS implements Target {
  starts = 0;
  continuations = 0;
  active = false;
  delayMs = 200;
  startAction: Action = 'verification';
  continuationAction: Action | 'success' = 'success';
  transform: (m: Mail) => Mail[] = (m) => [m];
  #expected = '';
  #attempt = '';
  constructor(
    readonly inbox: FakeInbox,
    readonly policy: Policy,
  ) {}

  async start(input: {
    email: string;
    attemptId: string;
    service: string;
  }): Promise<Action> {
    this.starts++;
    if (this.startAction !== 'verification') return this.startAction;
    if (
      input.service !== this.policy.service ||
      input.email !== this.policy.mailboxEmail ||
      this.#attempt
    )
      throw new FlowError('invalid_config');
    this.#attempt = input.attemptId;
    // Synthetic artifacts exist only at runtime, never as committed fixture values.
    const digest = createHash('sha256')
      .update(`synthetic-only:${input.attemptId}`)
      .digest('hex');
    this.#expected =
      this.policy.artifact.kind === 'code'
        ? String(parseInt(digest.slice(0, 8), 16) % 1_000_000).padStart(6, '0')
        : `https://example.test/verify?token=${digest}`;
    const at = this.inbox.clock.now() + this.delayMs;
    const mail: Mail = {
      id: `fake-message-${this.starts}`,
      sender: 'verify@example.test',
      recipient: input.email,
      subject: `${this.policy.subject} [${input.attemptId}]`,
      date: new Date(at).toISOString(),
      body: `Service: ${input.service}\nAttempt: ${input.attemptId}\n${this.policy.artifact.label}: ${this.#expected}`,
      clean: true,
      safe: true,
      omitted: false,
      truncated: false,
      authentication: 'pass',
    };
    const box = this.inbox.boxes.find((b) => b.email === input.email);
    if (!box) throw new FlowError('invalid_config');
    for (const m of this.transform(mail))
      this.inbox.messages.push({ mailboxId: box.id, at, mail: m });
    return 'verification';
  }
  async continue(input: {
    attemptId: string;
    artifact: string;
    kind: 'code' | 'link';
  }): Promise<Action | 'success'> {
    this.continuations++;
    if (
      input.attemptId !== this.#attempt ||
      !this.#expected ||
      input.artifact !== this.#expected ||
      input.kind !== this.policy.artifact.kind ||
      this.active
    )
      throw new FlowError('verification_failed');
    if (this.continuationAction !== 'success') return this.continuationAction;
    this.#expected = '';
    this.active = true;
    return 'success';
  }
}

// Local HTTP demo exercises the full signup/verify request path. No SMTP,
// outbound delivery, account purchase, wallet, or third-party credentials.
export async function serveFakeSaaS(
  saas: FakeSaaS,
): Promise<{ target: Target; close(): Promise<void> }> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        if (
          req.method !== 'POST' ||
          !['/signup', '/verify'].includes(req.url ?? '')
        )
          throw new FlowError('invalid_config');
        let data = '';
        for await (const chunk of req) {
          data += String(chunk);
          if (data.length > 4096) throw new FlowError('invalid_config');
        }
        const input: unknown = JSON.parse(data);
        if (!input || typeof input !== 'object')
          throw new FlowError('invalid_config');
        const o = input as Record<string, unknown>;
        if (typeof o.attemptId !== 'string')
          throw new FlowError('invalid_config');
        let action: Action | 'success';
        if (req.url === '/signup') {
          if (typeof o.email !== 'string' || typeof o.service !== 'string')
            throw new FlowError('invalid_config');
          action = await saas.start({
            email: o.email,
            service: o.service,
            attemptId: o.attemptId,
          });
        } else {
          if (
            typeof o.artifact !== 'string' ||
            (o.kind !== 'code' && o.kind !== 'link')
          )
            throw new FlowError('invalid_config');
          action = await saas.continue({
            artifact: o.artifact,
            kind: o.kind,
            attemptId: o.attemptId,
          });
        }
        res
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ action }));
      } catch {
        res
          .writeHead(400, { 'Content-Type': 'application/json' })
          .end('{"error":"invalid_request"}');
      }
    })();
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const location = server.address();
  if (!location || typeof location === 'string')
    throw new FlowError('internal_error');
  const origin = `http://127.0.0.1:${location.port}`;
  async function post(
    path: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<Action | 'success'> {
    const r = await fetch(origin + path, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!r.ok) throw new FlowError('verification_failed');
    const result = (await r.json()) as { action: Action | 'success' };
    return result.action;
  }
  return {
    target: {
      start: async (input, signal) => {
        const action = await post('/signup', input, signal);
        if (action === 'success') throw new FlowError('invalid_response');
        return action;
      },
      continue: (input, signal) => post('/verify', input, signal),
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
}
