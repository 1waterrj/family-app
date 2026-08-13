import { z } from 'zod';

import {
  ChildIdSchema,
  HouseholdIdSchema,
  IanaTimeZoneSchema,
  IsoUtcTimestampSchema,
} from './common.js';

export const CreateHouseholdSchema = z.object({
  name: z.string().trim().min(1).max(120),
  timeZone: IanaTimeZoneSchema,
  idempotencyKey: z.uuid(),
});

export const HouseholdSchema = z.object({
  id: HouseholdIdSchema,
  name: z.string(),
  timeZone: IanaTimeZoneSchema,
  createdAt: IsoUtcTimestampSchema,
});

export const CreateChildSchema = z.object({
  householdId: HouseholdIdSchema,
  name: z.string().trim().min(1).max(80),
  color: z.string().trim().min(1).max(32),
  imageUrl: z.url().optional(),
  idempotencyKey: z.uuid(),
});

export const ChildProfileSchema = z.object({
  id: ChildIdSchema,
  householdId: HouseholdIdSchema,
  name: z.string(),
  color: z.string(),
  imageUrl: z.url().nullable(),
  createdAt: IsoUtcTimestampSchema,
});

export type CreateHousehold = z.infer<typeof CreateHouseholdSchema>;
export type Household = z.infer<typeof HouseholdSchema>;
export type CreateChild = z.infer<typeof CreateChildSchema>;
export type ChildProfile = z.infer<typeof ChildProfileSchema>;
