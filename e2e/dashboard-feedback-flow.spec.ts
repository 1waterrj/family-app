import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, test } from '@playwright/test';

const repositoryRoot = resolve(__dirname, '..');

test('dashboard feedback stays private until a parent prepares a scrubbed browser handoff', async ({
  page,
}) => {
  // Break caught: dashboard-private text is reused in public output or the handoff publishes instead of opening a draft.
  const { buildGithubIssueHandoff, createFamilyApiClient } =
    await importBuiltClient('index.js');
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
  const hostileDescription =
    'Avery in Example Family saw 192.168.1.20. Email avery@example.com about 123e4567-e89b-12d3-a456-426614174000 or read [private notes](http://192.168.1.20/private).';

  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'Dashboard credential JSON' })
    .fill(dashboardCredentialText);
  await page.getByRole('button', { name: 'Connect dashboard' }).click();
  await expect(
    page.getByRole('heading', { name: 'Example Family' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Tell us' }).click();
  await page.getByRole('button', { name: 'Something broke' }).click();
  await page.getByLabel('Tell us more (optional)').fill(hostileDescription);
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await expect(
    page.getByRole('status').filter({
      hasText: 'Thanks - your feedback was saved and sent.',
    }),
  ).toHaveText('Thanks - your feedback was saved and sent.');

  const report = (await parentClient.listFeedback()).find(
    ({ category }) => category === 'BROKEN',
  );
  expect(report, 'the parent should see the dashboard report').toBeDefined();
  expect(report?.source).toBe('DASHBOARD');

  try {
    const privateReport = await parentClient.getFeedback(report!.id);
    expect(privateReport.description).toBe(hostileDescription);

    const reviewed = await parentClient.updateFeedback(report!.id, {
      idempotencyKey: crypto.randomUUID(),
      expectedUpdatedAt: privateReport.updatedAt,
      status: 'REVIEWING',
      description: 'The feedback control stopped responding.',
    });
    expect(reviewed).toMatchObject({
      status: 'REVIEWING',
      description: 'The feedback control stopped responding.',
    });

    const preview = await parentClient.prepareFeedbackPublicPreview(
      report!.id,
      {
        publicTitle: 'Kitchen feedback',
        publicDescription: 'The feedback control stopped responding.',
        includeDiagnostics: true,
      },
    );
    const publicText = JSON.stringify(preview);
    expect(preview.labels).toEqual(
      expect.arrayContaining(['app:dashboard', 'platform:raspberry-pi']),
    );
    expect(preview.body).toContain('The feedback control stopped responding.');
    for (const forbidden of [
      'Avery',
      'Example Family',
      '192.168.1.20',
      'avery@example.com',
      '123e4567-e89b-12d3-a456-426614174000',
      'private notes',
    ]) {
      expect(publicText).not.toContain(forbidden);
    }

    const handoff = buildGithubIssueHandoff(preview);
    expect(handoff.kind).toBe('URL');
    if (handoff.kind !== 'URL') throw new Error('Expected a URL handoff.');
    const issueUrl = new URL(handoff.url);
    expect(issueUrl.origin + issueUrl.pathname).toBe(
      'https://github.com/family-tests/family-app/issues/new',
    );
    expect(issueUrl.searchParams.get('body')).toBe(preview.body);
    expect(new URL(page.url()).hostname).toBe('127.0.0.1');
  } finally {
    await parentClient.deleteFeedback(report!.id, {
      idempotencyKey: crypto.randomUUID(),
    });
  }
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
