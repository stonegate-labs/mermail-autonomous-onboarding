import { Mermail } from './mermail.js';
import { ensureMailbox } from './policy.js';
import { demoPolicy } from './fake.js';
import { failure } from './model.js';

export interface AcceptanceResult {
  status: 'passed' | 'partial' | 'skipped' | 'blocked';
  capabilities: string[];
  diagnostic: string;
}

export async function liveAcceptance(
  env: NodeJS.ProcessEnv,
  allowCreate: boolean,
): Promise<AcceptanceResult> {
  if (!env.MERMAIL_API_KEY)
    return {
      status: 'skipped',
      capabilities: [],
      diagnostic:
        'Inject MERMAIL_API_KEY through your secret manager; no live requests were made.',
    };
  const capabilities: string[] = [];
  try {
    const inbox = new Mermail(env.MERMAIL_API_KEY);
    const signal = AbortSignal.timeout(30_000);
    await inbox.listMailboxes(signal);
    capabilities.push('list_mailboxes');
    if (
      !env.MERMAIL_MAILBOX_EMAIL ||
      !env.MERMAIL_SERVICE ||
      !env.MERMAIL_ACCOUNT
    )
      return {
        status: 'partial',
        capabilities,
        diagnostic:
          'Set MERMAIL_MAILBOX_EMAIL, MERMAIL_SERVICE and MERMAIL_ACCOUNT to an authorized service/account binding for reuse/read. Optional --allow-create provisions at most one absent mailbox (10 API credits).',
      };
    const policy = {
      ...demoPolicy(),
      service: env.MERMAIL_SERVICE,
      account: env.MERMAIL_ACCOUNT,
      mailboxEmail: env.MERMAIL_MAILBOX_EMAIL,
      allowCreate,
    };
    const { mailbox, created } = await ensureMailbox(inbox, policy, signal);
    capabilities.push(created ? 'create_mailbox' : 'reuse_mailbox');
    const messages = await inbox.listEmails(mailbox.id, signal);
    capabilities.push('list_emails');
    // Reads only an explicitly named test message, never an arbitrary private email.
    if (!env.MERMAIL_TEST_EMAIL_ID)
      return {
        status: 'partial',
        capabilities,
        diagnostic:
          'Set MERMAIL_TEST_EMAIL_ID to an authorized test message in this mailbox to prove safe detail/context reads; content is never printed.',
      };
    if (!messages.some((m) => m.id === env.MERMAIL_TEST_EMAIL_ID))
      return {
        status: 'blocked',
        capabilities,
        diagnostic:
          'The selected test email is absent from the bounded mailbox snapshot.',
      };
    const detail = await inbox.getSafeEmail(
      mailbox.id,
      env.MERMAIL_TEST_EMAIL_ID,
      signal,
    );
    const context = await inbox.getSafeContext(
      mailbox.id,
      env.MERMAIL_TEST_EMAIL_ID,
      signal,
    );
    if (
      detail.id !== env.MERMAIL_TEST_EMAIL_ID ||
      context.id !== detail.id ||
      !detail.safe ||
      !context.safe
    )
      return {
        status: 'blocked',
        capabilities,
        diagnostic:
          'Safe projection or selected-message identity did not match; no content was exposed.',
      };
    capabilities.push('safe_detail', 'safe_context');
    return {
      status: 'passed',
      capabilities,
      diagnostic:
        'Selected capability checks passed. This is not proof of real third-party signup or delivery. Creation is only proven when create_mailbox appears above.',
    };
  } catch (error) {
    return {
      status: 'blocked',
      capabilities,
      diagnostic: `Live acceptance stopped: ${failure(error)}. Check credential scope, mailbox binding, readiness and API credit availability; no automatic purchase is attempted.`,
    };
  }
}
