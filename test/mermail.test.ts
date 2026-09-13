import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Mermail } from '../src/mermail.js';

const signal = () => new AbortController().signal;

for (const [name, header, expected] of [
  ['delta seconds', '2', 2000],
  ['zero seconds', '0', 0],
  ['future HTTP-date', 'Thu, 01 Jan 2026 00:00:02 GMT', 1500],
  ['past HTTP-date', 'Wed, 31 Dec 2025 23:59:59 GMT', 0],
  ['invalid date', 'not a date', 0],
  ['delta clamp', '86401', 86_400_000],
  ['date clamp', 'Sat, 03 Jan 2026 00:00:00 GMT', 86_400_000],
] as const) {
  test(`Retry-After supports ${name}`, async (t) => {
    t.mock.method(Date, 'now', () => Date.parse('2026-01-01T00:00:00.500Z'));
    const adapter = new Mermail(
      'sk-proj-synthetic',
      async () =>
        new Response('private response', {
          status: 429,
          headers: { 'Retry-After': header },
        }),
    );
    await assert.rejects(adapter.listMailboxes(signal()), {
      code: 'rate_limited',
      message: 'rate_limited',
      retryAfterMs: expected,
    });
  });
}
const key = () => ['sk', 'proj', 'synthetic', String(Date.now())].join('-');
function wire(id = 'message-one'): Record<string, unknown> {
  return {
    id,
    sender: 'verify@example.test',
    recipient: 'demo@mermail.app',
    subject: 'Verification',
    date: '2026-01-01T00:00:00Z',
    scan_status: 'clean',
    agent_safe_content: true,
    sender_authentication: { status: 'unknown' },
  };
}
function json(value: unknown): Response {
  return Response.json(value);
}

test('official origin, API-key header, encoded mailbox path and safe read query', async () => {
  const secret = key();
  const adapter = new Mermail(secret, async (input, init) => {
    const u = new URL(String(input));
    assert.equal(u.origin, 'https://console.mermail.app');
    assert.equal(u.pathname, '/api/v1/mailboxes/a%2Fb/emails/message%2Fone');
    assert.equal(u.searchParams.get('require_scan_status'), 'clean');
    assert.equal(u.searchParams.get('max_body_chars'), '16384');
    assert.equal(u.searchParams.get('agent_safe_content'), 'true');
    assert.equal(init?.redirect, 'error');
    assert.ok(
      new Headers(init?.headers).get('x-api-key') === secret,
      'expected credential header',
    );
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    return json({
      ...wire(),
      body: 'untrusted plain text',
      raw_headers: 'do not retain',
      provider_metadata: { private: true },
    });
  });
  const m = await adapter.getSafeEmail('a/b', 'message/one', signal());
  assert.equal(m.authentication, 'unknown');
  assert.ok(!JSON.stringify(m).includes('raw_headers'));
  assert.ok(!JSON.stringify(m).includes('provider_metadata'));
});

test('create contract uses verification settings and idempotency header', async () => {
  const adapter = new Mermail(key(), async (input, init) => {
    assert.equal(String(input), 'https://console.mermail.app/api/v1/mailboxes');
    assert.equal(init?.method, 'POST');
    assert.equal(
      new Headers(init?.headers).get('Idempotency-Key'),
      'intent-one',
    );
    assert.deepEqual(JSON.parse(String(init?.body)), {
      email: 'demo@mermail.app',
      name: 'service-scope',
      settings: {
        agentInbox: {
          mode: 'verification',
          automationsEnabled: false,
          requireCleanScanForAutomation: true,
        },
      },
    });
    return json({
      id: 'alias',
      public_id: 'route-id',
      email: 'demo@mermail.app',
      name: 'service-scope',
      disabled_at: null,
      can_receive: true,
      receiving_status: 'ready',
      welcome_onboarding_status: 'pending',
    });
  });
  const b = await adapter.createMailbox(
    'demo@mermail.app',
    'service-scope',
    'intent-one',
    signal(),
  );
  assert.equal(b.id, 'route-id');
  assert.equal(b.ready, true);
});

for (const envelope of [true, false]) {
  test(`paginates ${envelope ? 'envelope' : 'bare array'} metadata completely`, async () => {
    let calls = 0;
    const adapter = new Mermail(key(), async (input) => {
      const u = new URL(String(input));
      const page = Number(u.searchParams.get('page'));
      calls++;
      assert.equal(u.searchParams.get('metadata_only'), 'true');
      assert.equal(u.searchParams.get('threaded'), 'false');
      assert.equal(u.searchParams.has('require_scan_status'), false); // Baseline includes pre-existing non-clean mail.
      const emails =
        page === 1
          ? Array.from({ length: 100 }, (_, i) => wire(`m-${i}`))
          : [{ ...wire('last'), body: 'must be dropped' }];
      return json(envelope ? { emails, totalCount: 101 } : emails);
    });
    const result = await adapter.listEmails('mailbox', signal());
    assert.equal(result.length, 101);
    assert.equal(calls, 2);
    assert.ok(result.every((m) => m.body === undefined));
  });
}

test('pagination cap fails rather than accepting partial baseline', async () => {
  let count = 0;
  const adapter = new Mermail(key(), async () =>
    json(Array.from({ length: 100 }, () => wire(`m-${count++}`))),
  );
  await assert.rejects(adapter.listEmails('mailbox', signal()), {
    code: 'snapshot_incomplete',
  });
});

test('changing totalCount and short incomplete pages fail closed', async () => {
  const adapter = new Mermail(key(), async () =>
    json({ emails: [wire()], totalCount: 2 }),
  );
  await assert.rejects(adapter.listEmails('mailbox', signal()), {
    code: 'snapshot_incomplete',
  });
});

test('duplicate authoritative IDs across pages fail closed', async () => {
  const adapter = new Mermail(key(), async () =>
    json(Array.from({ length: 100 }, () => wire())),
  );
  await assert.rejects(adapter.listEmails('mailbox', signal()), {
    code: 'duplicate_message',
  });
});

test('safe context reads selected email and never consumes thread artifacts', async () => {
  const adapter = new Mermail(key(), async (input) => {
    assert.ok(
      String(input).endsWith(
        '/emails/selected/context?limit=1&include_held=true',
      ),
    );
    return json({
      email: wire('selected'),
      thread: {
        messages: [{ ...wire('old'), body: 'untrusted stale thread' }],
        has_more: true,
        next_cursor: 'opaque',
      },
    });
  });
  const m = await adapter.getSafeContext('mailbox', 'selected', signal());
  assert.equal(m.id, 'selected');
  assert.ok(!JSON.stringify(m).includes('thread'));
});

for (const [status, code] of [
  [401, 'unauthorized'],
  [402, 'credits_exhausted'],
  [403, 'forbidden'],
  [429, 'rate_limited'],
  [500, 'remote_failure'],
] as const) {
  test(`HTTP ${status} yields redacted typed error`, async () => {
    const secret = key();
    const adapter = new Mermail(
      secret,
      async () =>
        new Response(secret, { status, headers: { 'Retry-After': '2' } }),
    );
    await assert.rejects(adapter.listMailboxes(signal()), (e: unknown) => {
      assert.ok(
        e instanceof Error && e.message === code,
        'only fixed reason codes are exposed',
      );
      assert.ok(!String(e).includes(secret));
      return true;
    });
  });
}

test('transport exceptions and malformed JSON never leak response data', async () => {
  const secret = key();
  const adapter = new Mermail(secret, async () => {
    throw new Error(secret);
  });
  await assert.rejects(adapter.listMailboxes(signal()), {
    message: 'transport',
  });
  const malformed = new Mermail(
    secret,
    async () => new Response('invalid ' + secret),
  );
  await assert.rejects(malformed.listMailboxes(signal()), {
    message: 'invalid_response',
  });
});

test('oversized streamed response is rejected', async () => {
  const adapter = new Mermail(
    key(),
    async () => new Response('x'.repeat(2_000_001)),
  );
  await assert.rejects(adapter.listMailboxes(signal()), {
    code: 'invalid_response',
  });
});

test('malformed wire fields do not become trusted email', async () => {
  const adapter = new Mermail(key(), async () =>
    json({ ...wire(), sender: ['spoof'] }),
  );
  await assert.rejects(adapter.getSafeEmail('mailbox', 'id', signal()), {
    code: 'invalid_response',
  });
});

test('metadata snapshots allow empty subjects without retaining bodies', async () => {
  const adapter = new Mermail(key(), async () =>
    json([{ ...wire(), subject: '', body: 'unrelated content' }]),
  );
  const messages = await adapter.listEmails('mailbox', signal());
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.subject, '');
  assert.equal(messages[0]?.body, undefined);
});

for (const [name, subject] of [
  ['missing', undefined],
  ['null', null],
  ['non-string', 42],
  ['oversized', 'x'.repeat(16_385)],
] as const) {
  test(`metadata rejects ${name} subject`, async () => {
    const adapter = new Mermail(key(), async () =>
      json([{ ...wire(), subject }]),
    );
    await assert.rejects(adapter.listEmails('mailbox', signal()), {
      code: 'invalid_response',
    });
  });
}

test('dot-segment IDs cannot escape the mailbox route', async () => {
  let calls = 0;
  const adapter = new Mermail(key(), async () => {
    calls++;
    return json(wire());
  });
  await assert.rejects(adapter.getSafeEmail('..', 'id', signal()), {
    code: 'invalid_config',
  });
  await assert.rejects(adapter.getSafeEmail('box', '.', signal()), {
    code: 'invalid_config',
  });
  assert.equal(calls, 0);
});

test('string-valued truncation flag is rejected', async () => {
  const adapter = new Mermail(key(), async () =>
    json({ ...wire(), content_truncated: 'true' }),
  );
  await assert.rejects(adapter.getSafeEmail('box', 'id', signal()), {
    code: 'invalid_response',
  });
});
