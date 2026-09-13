import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  demoPolicy,
  FakeInbox,
  FakeSaaS,
  serveFakeSaaS,
  VirtualClock,
} from '../src/fake.js';
import { Mermail } from '../src/mermail.js';
import { onboard } from '../src/orchestrator.js';
import type { Mail, Mailbox } from '../src/model.js';

// Executable fixture for the reviewed REST wire contract. Artifacts are
// generated in memory; this is not recorded private traffic.
function mailboxWire(b: Mailbox): unknown {
  return {
    id: b.id,
    public_id: b.id,
    email: b.email,
    name: b.name,
    disabled_at: null,
    can_receive: b.ready,
    receiving_status: b.ready ? 'ready' : 'unavailable',
  };
}
function emailWire(m: Mail): unknown {
  return {
    id: m.id,
    sender: m.sender,
    recipient: m.recipient,
    subject: m.subject,
    date: m.date,
    body: m.body,
    scan_status: m.clean ? 'clean' : 'flagged',
    agent_safe_content: m.safe,
    content_omitted: m.omitted,
    content_truncated: m.truncated,
    sender_authentication: { status: m.authentication },
  };
}

for (const emptySubjects of [false, true]) {
  test(`Mermail REST adapter + local HTTP SaaS + delayed inbox complete together${emptySubjects ? ' with empty subjects in baseline and polling' : ''}`, async () => {
    const p = demoPolicy();
    const clock = new VirtualClock();
    const inbox = new FakeInbox(clock);
    const saas = new FakeSaaS(inbox, p);
    let snapshots = 0;
    const snapshotDate = new Date(clock.now()).toISOString();
    const transport: typeof fetch = async (input, init) => {
      const u = new URL(String(input));
      assert.equal(u.origin, 'https://console.mermail.app');
      const parts = u.pathname.split('/').map(decodeURIComponent);
      if (u.pathname === '/api/v1/mailboxes') {
        if (init?.method === 'POST') {
          const data = JSON.parse(String(init.body)) as {
            email: string;
            name: string;
          };
          return Response.json(
            mailboxWire(await inbox.createMailbox(data.email, data.name)),
            { status: 201 },
          );
        }
        return Response.json((await inbox.listMailboxes()).map(mailboxWire));
      }
      assert.equal(parts[5], 'emails');
      const mailboxId = parts[4]!;
      if (!parts[6]) {
        snapshots++;
        const messages = (await inbox.listEmails(mailboxId)).map(emailWire);
        if (emptySubjects) {
          const unrelated = {
            sender: 'verify@example.test',
            recipient: p.mailboxEmail,
            subject: '',
            date: snapshotDate,
          };
          messages.push({ ...unrelated, id: 'empty-baseline' });
          if (snapshots > 1) messages.push({ ...unrelated, id: 'empty-new' });
        }
        return Response.json(messages);
      }
      return Response.json(
        emailWire(await inbox.getSafeEmail(mailboxId, parts[6])),
      );
    };
    const adapter = new Mermail(
      ['sk', 'proj', 'generated-test-only'].join('-'),
      transport,
    );
    const server = await serveFakeSaaS(saas);
    try {
      const result = await onboard(adapter, server.target, p, {
        clock,
        attemptId: 'integration-attempt-0001',
      });
      assert.equal(result.status, 'success');
      assert.equal(saas.active, true);
      assert.equal(inbox.creates, 1);
      if (emptySubjects) {
        assert.equal(
          result.evidence.find((e) => e.event === 'baseline_recorded')?.count,
          1,
        );
        assert.equal(
          result.evidence.filter((e) => e.event === 'message_rejected').length,
          1,
        );
        assert.equal(inbox.reads, 2);
      }
    } finally {
      await server.close();
    }
  });
}
