const failureCodes = [
  'invalid_config',
  'invalid_response',
  'mailbox_ambiguous',
  'mailbox_unavailable',
  'creation_disabled',
  'create_uncertain',
  'request_budget',
  'snapshot_incomplete',
  'duplicate_message',
  'message_changed',
  'ambiguous',
  'malformed_email',
  'unsafe_content',
  'sender_unauthenticated',
  'missing_artifact',
  'unsafe_link',
  'timeout',
  'transport',
  'unauthorized',
  'forbidden',
  'credits_exhausted',
  'rate_limited',
  'remote_failure',
  'payment_required',
  'wallet_signature_required',
  'automation_unavailable',
  'verification_failed',
  'internal_error',
] as const;
export type FailureCode = (typeof failureCodes)[number];

export class FlowError extends Error {
  constructor(
    public readonly code: FailureCode,
    public readonly retryAfterMs = 0,
  ) {
    super(code);
    this.name = 'FlowError';
  }
}

export interface Mailbox {
  id: string;
  email: string;
  name: string;
  ready: boolean;
}

// This is the internal projection, not a claimed Mermail wire schema.
export interface Mail {
  id: string;
  sender: string;
  recipient: string;
  subject: string;
  date: string;
  body?: string;
  clean: boolean;
  safe: boolean;
  omitted: boolean;
  truncated: boolean;
  authentication: 'pass' | 'fail' | 'unknown';
}

export interface Inbox {
  listMailboxes(signal: AbortSignal): Promise<Mailbox[]>;
  createMailbox(
    email: string,
    name: string,
    key: string,
    signal: AbortSignal,
  ): Promise<Mailbox>;
  // Must return a complete bounded snapshot or throw snapshot_incomplete.
  listEmails(mailboxId: string, signal: AbortSignal): Promise<Mail[]>;
  getSafeEmail(
    mailboxId: string,
    emailId: string,
    signal: AbortSignal,
  ): Promise<Mail>;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export type ArtifactPolicy =
  | {
      kind: 'code';
      label: string;
      length: number;
      alphabet: 'digits' | 'alphanumeric';
    }
  | {
      kind: 'link';
      label: string;
      origin: string;
      path: string;
      tokenParameter: string;
    };

export interface Policy {
  service: string;
  account: string;
  mailboxEmail: string;
  allowCreate: boolean;
  sender: { address: string } | { domain: string };
  subject: string;
  artifact: ArtifactPolicy;
  requireAuthenticatedSender: boolean;
  timeoutMs: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  maxOperations: number;
}

export type Action =
  | 'verification'
  | 'payment'
  | 'wallet_signature'
  | 'unavailable';
export interface Target {
  // Trusted code: account/service config is never supplied by email.
  start(
    input: { email: string; attemptId: string; service: string },
    signal: AbortSignal,
  ): Promise<Action>;
  continue(
    input: { attemptId: string; artifact: string; kind: 'code' | 'link' },
    signal: AbortSignal,
  ): Promise<Action | 'success'>;
}

export type EventName =
  | 'mailbox_reused'
  | 'mailbox_created'
  | 'baseline_recorded'
  | 'signup_started'
  | 'poll'
  | 'retry'
  | 'message_rejected'
  | 'email_correlated'
  | 'artifact_extracted'
  | 'continuation_started'
  | 'succeeded'
  | 'stopped';
export interface Evidence {
  event: EventName;
  elapsedMs: number;
  count?: number;
}
export interface Result {
  status: 'success' | 'failed' | 'blocked';
  reason?: FailureCode;
  requiredAction?: 'actual_payment' | 'actual_wallet_signature';
  evidence: Evidence[];
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function failure(error: unknown): FailureCode {
  return error instanceof FlowError && failureCodes.includes(error.code)
    ? error.code
    : 'internal_error';
}
