import { z } from 'zod';

import {
  ChildIdSchema,
  ChoreInstanceIdSchema,
  HouseholdIdSchema,
  IsoUtcTimestampSchema,
  LedgerBalanceCentsSchema,
  MoneyCentsSchema,
  ParentIdSchema,
} from './common.js';

export const LedgerTransactionTypeSchema = z.enum([
  'CHORE_CREDIT',
  'PURCHASE',
  'MANUAL_CREDIT',
  'CORRECTION',
]);

export const ManualLedgerTransactionTypeSchema = z.enum([
  'PURCHASE',
  'MANUAL_CREDIT',
  'CORRECTION',
]);

export const ManualLedgerEntrySchema = z
  .object({
    householdId: HouseholdIdSchema,
    childId: ChildIdSchema,
    amountCents: MoneyCentsSchema.refine((amount) => amount !== 0, {
      message: 'Amount must not be zero',
    }),
    type: ManualLedgerTransactionTypeSchema,
    note: z.string().trim().min(1).max(500),
    idempotencyKey: z.uuid(),
  })
  .superRefine((entry, context) => {
    if (
      (entry.type === 'PURCHASE' && entry.amountCents >= 0) ||
      (entry.type === 'MANUAL_CREDIT' && entry.amountCents <= 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['amountCents'],
        message: 'Amount sign does not match the manual ledger entry type.',
      });
    }
  });

export const LedgerTransactionSchema = z.object({
  id: z.uuid(),
  householdId: HouseholdIdSchema,
  childId: ChildIdSchema,
  amountCents: MoneyCentsSchema,
  type: LedgerTransactionTypeSchema,
  note: z.string().nullable(),
  actorParentId: ParentIdSchema.nullable(),
  relatedChoreInstanceId: ChoreInstanceIdSchema.nullable(),
  approvalDecisionId: z.uuid().nullable(),
  createdAt: IsoUtcTimestampSchema,
});

export const LedgerBalanceSchema = z.object({
  householdId: HouseholdIdSchema,
  childId: ChildIdSchema,
  balanceCents: LedgerBalanceCentsSchema,
});

export const LedgerSummarySchema = z.object({
  householdId: HouseholdIdSchema,
  childId: ChildIdSchema,
  balanceCents: LedgerBalanceCentsSchema,
  transactions: z.array(LedgerTransactionSchema),
});

export type LedgerTransactionType = z.infer<typeof LedgerTransactionTypeSchema>;
export type ManualLedgerTransactionType = z.infer<
  typeof ManualLedgerTransactionTypeSchema
>;
export type ManualLedgerEntry = z.infer<typeof ManualLedgerEntrySchema>;
export type LedgerTransaction = z.infer<typeof LedgerTransactionSchema>;
export type LedgerBalance = z.infer<typeof LedgerBalanceSchema>;
export type LedgerSummary = z.infer<typeof LedgerSummarySchema>;
