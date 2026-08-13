import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, test } from '@playwright/test';

const repositoryRoot = resolve(__dirname, '..');

test('Avery completes Tidy toys and receives one parent-approved chore credit', async ({
  page,
}) => {
  const { createFamilyApiClient } = await importBuiltClient('index.js');
  const dashboardCredentialText = await readFile(
    resolve(repositoryRoot, '.local/dev-fixtures/dashboard.json'),
    'utf8',
  );
  const parentSession = await readSession('parent.json', 'PARENT');
  const parentClient = createFamilyApiClient({
    apiOrigin: parentSession.apiOrigin,
    accessToken: parentSession.accessToken,
    fetch: globalThis.fetch,
  });

  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'Dashboard credential JSON' })
    .fill(dashboardCredentialText);
  await page.getByRole('button', { name: 'Connect dashboard' }).click();
  await expect(
    page.getByRole('heading', { name: 'Example Family' }),
  ).toBeVisible();

  const initialLedger = await parentClient.getLedger(
    '00000000-0000-4000-8000-000000000104',
  );
  expect(initialLedger.balanceCents).toBe(500);
  const primaryChildCard = page
    .getByRole('heading', { name: 'Avery' })
    .locator('..');
  await expect(
    primaryChildCard.getByText('$5.00', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Open Chore Board' }).click();
  await page.getByRole('button', { name: /Open chore Tidy toys/ }).click();
  await page.getByRole('button', { name: 'Choose who' }).click();
  await page.getByRole('button', { name: 'Avery' }).click();
  await page.getByRole('button', { name: 'Yes, start it' }).click();

  await expect(page.getByRole('heading', { name: 'Tidy toys' })).toBeVisible();
  await page.getByRole('button', { name: "I'm done" }).click();
  await page.getByRole('button', { name: 'Yes, I finished' }).click();
  await expect(page.getByRole('status')).toHaveText('Waiting for a grown-up.');
  await page.getByRole('button', { name: 'Home' }).click();

  const parentSnapshot = await parentClient.getParentSnapshot();
  const pendingMatches = parentSnapshot.pendingApprovals.filter(
    ({ child, chore }) => child.name === 'Avery' && chore.name === 'Tidy toys',
  );
  expect(pendingMatches).toHaveLength(1);
  const pending = pendingMatches[0]!;

  const decision = await parentClient.approveChore({
    choreInstanceId: pending.chore.id,
    submissionAttemptId: pending.submissionAttemptId,
    payoutCents: 300,
    note: 'Approved by the local browser journey',
    idempotencyKey: crypto.randomUUID(),
  });
  expect(decision.submissionAttemptId).toBe(pending.submissionAttemptId);
  expect(decision.payoutCents).toBe(300);

  await expect(
    primaryChildCard.getByText('$8.00', { exact: true }),
  ).toBeVisible({
    timeout: 20_000,
  });

  const finalLedger = await parentClient.getLedger(pending.child.id);
  expect(finalLedger.balanceCents).toBe(initialLedger.balanceCents + 300);
  const linkedCredits = finalLedger.transactions.filter(
    (transaction) =>
      transaction.type === 'CHORE_CREDIT' &&
      transaction.relatedChoreInstanceId === pending.chore.id &&
      transaction.approvalDecisionId === decision.decisionId,
  );
  expect(linkedCredits).toHaveLength(1);
  expect(linkedCredits[0]?.amountCents).toBe(300);
});

async function readSession(
  fileName: 'parent.json' | 'dashboard.json',
  expectedRole: 'PARENT' | 'DASHBOARD',
) {
  const { parseDevelopmentCredential } = await importBuiltClient(
    'development-credential.js',
  );
  const credentialPath = resolve(
    repositoryRoot,
    '.local/dev-fixtures',
    fileName,
  );
  const value: unknown = JSON.parse(await readFile(credentialPath, 'utf8'));
  const credential = parseDevelopmentCredential(value);
  if (!credential || credential.session.role !== expectedRole) {
    throw new Error(`${fileName} is not a ${expectedRole} credential.`);
  }
  return credential.session;
}

async function importBuiltClient(moduleName: string) {
  const moduleUrl = pathToFileURL(
    resolve(repositoryRoot, 'packages/api-client/dist', moduleName),
  ).href;
  return import(moduleUrl);
}
