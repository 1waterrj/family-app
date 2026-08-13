import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';
import {
  ApproveChoreSchema,
  CHORE_IMAGE_KEYS,
  ChoreInstanceSchema,
  ChoreStatusSchema,
  ChoreTemplateSchema,
  CreateChildSchema,
  CreateChoreTemplateSchema,
  CreateHouseholdSchema,
  DashboardSnapshotSchema,
  IsoUtcTimestampSchema,
  ManualLedgerEntrySchema,
  LedgerTransactionTypeSchema,
  MoneyCentsSchema,
  ParentSnapshotSchema,
  PublishChoreInstanceSchema,
  RejectChoreSchema,
  SubmitChoreSchema,
} from '../src/index.js';

describe('core contracts', () => {
  it('validates minimal parent and dashboard snapshots with role-safe shapes', () => {
    const householdId = crypto.randomUUID();
    const childId = crypto.randomUUID();
    const templateId = crypto.randomUUID();
    const choreId = crypto.randomUUID();
    const createdAt = '2026-08-09T12:00:00Z';
    const household = {
      id: householdId,
      name: 'Example Family',
      timeZone: 'America/New_York',
      createdAt,
    };
    const profile = {
      id: childId,
      householdId,
      name: 'Avery',
      color: 'purple',
      imageUrl: null,
      createdAt,
    };
    const template = {
      id: templateId,
      householdId,
      name: 'Tidy toys',
      imageKey: 'tidy-toys',
      imageUrl: null,
      instructions: 'Put the toys in their bins.',
      defaultValueCents: 250,
      defaultDurationMinutes: 15,
      isActive: true,
      createdAt,
    };
    const chore = {
      id: choreId,
      householdId,
      choreTemplateId: templateId,
      name: template.name,
      imageKey: template.imageKey,
      imageUrl: template.imageUrl,
      instructions: template.instructions,
      valueCents: template.defaultValueCents,
      durationMinutes: template.defaultDurationMinutes,
      status: 'AWAITING_APPROVAL',
      claimedChildId: childId,
      claimDeadlineAt: '2026-08-09T12:15:00Z',
      submittedAt: '2026-08-09T12:10:00Z',
      createdAt,
    };

    expect(
      ParentSnapshotSchema.parse({
        household,
        serverTime: '2026-08-09T12:30:00Z',
        children: [{ profile, balanceCents: 425 }],
        templates: [template],
        chores: [chore],
        pendingApprovals: [
          {
            submissionAttemptId: crypto.randomUUID(),
            child: profile,
            chore,
            claimedAt: '2026-08-09T12:00:00Z',
            submittedAt: '2026-08-09T12:10:00Z',
          },
        ],
      }),
    ).toMatchObject({ children: [{ balanceCents: 425 }] });

    const dashboardChore = {
      id: chore.id,
      choreTemplateId: chore.choreTemplateId,
      name: chore.name,
      imageKey: chore.imageKey,
      imageUrl: chore.imageUrl,
      instructions: chore.instructions,
      valueCents: chore.valueCents,
      durationMinutes: chore.durationMinutes,
      status: chore.status,
      claimedChildId: chore.claimedChildId,
      claimDeadlineAt: chore.claimDeadlineAt,
      submittedAt: chore.submittedAt,
      createdAt: chore.createdAt,
    };
    expect(
      DashboardSnapshotSchema.parse({
        household: {
          id: household.id,
          name: household.name,
          timeZone: household.timeZone,
        },
        serverTime: '2026-08-09T12:30:00Z',
        children: [{ profile, balanceCents: 425 }],
        chores: [dashboardChore],
      }),
    ).toMatchObject({ chores: [{ id: choreId }] });
  });

  it('rejects unexpected approval and audit fields in snapshot contracts', () => {
    const minimal = {
      household: {
        id: crypto.randomUUID(),
        name: 'Example Family',
        timeZone: 'America/New_York',
        createdAt: '2026-08-09T12:00:00Z',
      },
      serverTime: '2026-08-09T12:30:00Z',
      children: [],
      templates: [],
      chores: [],
      pendingApprovals: [],
    };

    expect(() =>
      ParentSnapshotSchema.parse({
        ...minimal,
        actorParentId: crypto.randomUUID(),
      }),
    ).toThrow();
    expect(() =>
      DashboardSnapshotSchema.parse({
        household: {
          id: minimal.household.id,
          name: minimal.household.name,
          timeZone: minimal.household.timeZone,
        },
        serverTime: minimal.serverTime,
        children: [],
        chores: [],
        submissionAttemptId: crypto.randomUUID(),
      }),
    ).toThrow();
  });

  it('uses the contracted chore image keys in display order', () => {
    expect(CHORE_IMAGE_KEYS).toEqual([
      'tidy-toys',
      'dishes',
      'set-table',
      'laundry',
      'feed-pet',
      'make-bed',
      'wipe-counter',
      'help-garden',
    ]);
  });

  it('requires a picture key when creating a chore template', () => {
    expect(() =>
      CreateChoreTemplateSchema.parse({
        householdId: crypto.randomUUID(),
        name: 'Tidy toys',
        instructions: 'Put the toys in their bins.',
        defaultValueCents: 200,
        defaultDurationMinutes: 15,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toThrow();
  });

  it('keeps exact legacy chore rows readable without a picture key', () => {
    const template = ChoreTemplateSchema.parse({
      id: crypto.randomUUID(),
      householdId: crypto.randomUUID(),
      name: 'Tidy toys',
      imageKey: null,
      imageUrl: null,
      instructions: 'Put the toys in their bins.',
      defaultValueCents: 200,
      defaultDurationMinutes: 15,
      isActive: true,
      createdAt: '2026-08-08T17:00:00Z',
    });
    const instance = ChoreInstanceSchema.parse({
      id: crypto.randomUUID(),
      householdId: template.householdId,
      choreTemplateId: template.id,
      name: template.name,
      imageKey: null,
      imageUrl: null,
      instructions: template.instructions,
      valueCents: template.defaultValueCents,
      durationMinutes: template.defaultDurationMinutes,
      status: 'AVAILABLE',
      claimedChildId: null,
      claimDeadlineAt: null,
      submittedAt: null,
      createdAt: '2026-08-08T17:00:00Z',
    });

    expect(template.imageKey).toBeNull();
    expect(instance.imageKey).toBeNull();
  });

  it('accepts integer cents and rejects fractions', () => {
    expect(MoneyCentsSchema.parse(1250)).toBe(1250);
    expect(() => MoneyCentsSchema.parse(12.5)).toThrow();
    expect(MoneyCentsSchema.parse(-2_147_483_648)).toBe(-2_147_483_648);
    expect(MoneyCentsSchema.parse(2_147_483_647)).toBe(2_147_483_647);
    expect(() => MoneyCentsSchema.parse(-2_147_483_649)).toThrow();
    expect(() => MoneyCentsSchema.parse(2_147_483_648)).toThrow();
  });

  it('requires an idempotency key for every creation command', () => {
    expect(() =>
      CreateHouseholdSchema.parse({
        name: 'Example Family',
        timeZone: 'America/New_York',
      }),
    ).toThrow();
    expect(() =>
      CreateChildSchema.parse({
        householdId: crypto.randomUUID(),
        name: 'Avery',
        color: 'purple',
      }),
    ).toThrow();
    expect(() =>
      CreateChoreTemplateSchema.parse({
        householdId: crypto.randomUUID(),
        name: 'Tidy toys',
        instructions: 'Put every toy away.',
        defaultValueCents: 250,
        defaultDurationMinutes: 15,
      }),
    ).toThrow();
    expect(() =>
      PublishChoreInstanceSchema.parse({
        householdId: crypto.randomUUID(),
        choreTemplateId: crypto.randomUUID(),
      }),
    ).toThrow();
  });

  it('requires parent decisions to target an immutable submission attempt', () => {
    const command = {
      choreInstanceId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
    };

    expect(() => ApproveChoreSchema.parse(command)).toThrow();
    expect(() =>
      RejectChoreSchema.parse({ ...command, retry: true }),
    ).toThrow();
  });

  it('uses only approved chore states', () => {
    expect(ChoreStatusSchema.options).toEqual([
      'AVAILABLE',
      'CLAIMED',
      'AWAITING_APPROVAL',
      'APPROVED',
      'CLOSED',
    ]);
  });

  it('requires an idempotency key for submission', () => {
    expect(() =>
      SubmitChoreSchema.parse({ choreInstanceId: crypto.randomUUID() }),
    ).toThrow();
  });

  it('requires the child profile submitting a chore', () => {
    expect(() =>
      SubmitChoreSchema.parse({
        choreInstanceId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toThrow();
  });

  it('accepts only UTC timestamps', () => {
    expect(IsoUtcTimestampSchema.parse('2026-08-08T17:00:00Z')).toBe(
      '2026-08-08T17:00:00Z',
    );
    expect(() =>
      IsoUtcTimestampSchema.parse('2026-08-08T18:00:00+01:00'),
    ).toThrow();
  });

  it('uses the approved chore credit ledger literal', () => {
    expect(LedgerTransactionTypeSchema.options).toContain('CHORE_CREDIT');
    expect(LedgerTransactionTypeSchema.options).not.toContain('CHORE_APPROVAL');
  });

  it('uses explicit manual ledger categories without a manual debit type', () => {
    expect(LedgerTransactionTypeSchema.options).toEqual([
      'CHORE_CREDIT',
      'PURCHASE',
      'MANUAL_CREDIT',
      'CORRECTION',
    ]);

    expect(() =>
      ManualLedgerEntrySchema.parse({
        householdId: crypto.randomUUID(),
        childId: crypto.randomUUID(),
        amountCents: 100,
        note: 'Opening credit',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toThrow();

    expect(
      ManualLedgerEntrySchema.parse({
        householdId: crypto.randomUUID(),
        childId: crypto.randomUUID(),
        amountCents: -100,
        type: 'PURCHASE',
        note: 'Book purchase',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ type: 'PURCHASE' });

    expect(() =>
      ManualLedgerEntrySchema.parse({
        householdId: crypto.randomUUID(),
        childId: crypto.randomUUID(),
        amountCents: 100,
        type: 'PURCHASE',
        note: 'Incorrect purchase sign',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toThrow();
  });

  it('imports the built package through its public export', () => {
    const packageDirectory = new URL('..', import.meta.url);

    execFileSync('pnpm', ['build'], { cwd: packageDirectory, stdio: 'pipe' });
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "import('@family/contracts').then(({ MoneyCentsSchema }) => console.log(MoneyCentsSchema.parse(1250)))",
      ],
      { cwd: packageDirectory, encoding: 'utf8' },
    );

    expect(output.trim()).toBe('1250');
  });
});
