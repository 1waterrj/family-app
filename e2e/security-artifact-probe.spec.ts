import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

test('credential-bearing browser actions do not persist their value', async ({
  page,
}) => {
  const sentinel = process.env.FAMILY_E2E_SECURITY_SENTINEL;
  expect(
    sentinel,
    'The security probe requires a non-secret sentinel.',
  ).toBeTruthy();
  const completionMarker =
    process.env.FAMILY_E2E_SECURITY_PROBE_COMPLETION_MARKER;
  expect(
    completionMarker,
    'The security probe requires a completion marker path.',
  ).toBeTruthy();

  await page.setContent(
    '<label for="credential">Credential</label><input id="credential" />',
  );
  await page.getByLabel('Credential').fill(sentinel!);
  writeFileSync(
    completionMarker!,
    `${JSON.stringify({ status: 'credential-filled' })}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );

  throw new Error(
    'Intentional E2E artifact security probe failure after credential fill.',
  );
});
