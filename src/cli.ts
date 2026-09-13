import {
  demoPolicy,
  FakeInbox,
  FakeSaaS,
  serveFakeSaaS,
  VirtualClock,
} from './fake.js';
import { onboard } from './orchestrator.js';
import { liveAcceptance } from './acceptance.js';

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (
    command === 'demo' &&
    args.every((a) => ['--link', '--reuse'].includes(a))
  ) {
    const policy = demoPolicy(args.includes('--link') ? 'link' : 'code');
    const clock = new VirtualClock();
    const inbox = new FakeInbox(clock);
    if (args.includes('--reuse')) inbox.reuse(policy);
    const saas = new FakeSaaS(inbox, policy);
    const server = await serveFakeSaaS(saas);
    try {
      const result = await onboard(inbox, server.target, policy, {
        clock,
        attemptId: 'demo-attempt-00000001',
      });
      console.log(
        JSON.stringify(
          {
            mode: 'local_fake_saas',
            verification: policy.artifact.kind,
            ...result,
          },
          null,
          2,
        ),
      );
      if (result.status !== 'success') process.exitCode = 1;
    } finally {
      await server.close();
    }
    return;
  }
  if (
    command === 'acceptance' &&
    args.every((a) => ['--allow-create', '--required'].includes(a))
  ) {
    const result = await liveAcceptance(
      process.env,
      args.includes('--allow-create'),
    );
    console.log(JSON.stringify(result, null, 2));
    if (
      result.status === 'blocked' ||
      (args.includes('--required') && result.status !== 'passed')
    )
      process.exitCode = 1;
    return;
  }
  console.error(
    'Usage: node dist/src/cli.js demo [--link] [--reuse] | acceptance [--allow-create] [--required]',
  );
  process.exitCode = 2;
}

main().catch(() => {
  console.error('{"status":"failed","reason":"internal_error"}');
  process.exitCode = 1;
});
