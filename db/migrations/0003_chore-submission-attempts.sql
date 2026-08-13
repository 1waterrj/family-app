CREATE TABLE "chore_submission_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"chore_instance_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chore_submission_attempts_household_id_unique" UNIQUE("household_id","id","chore_instance_id"),
	CONSTRAINT "chore_submission_attempts_household_chore_number_unique" UNIQUE("household_id","chore_instance_id","attempt_number"),
	CONSTRAINT "chore_submission_attempts_number_positive" CHECK ("chore_submission_attempts"."attempt_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD COLUMN "submission_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "chore_submission_attempts" ADD CONSTRAINT "chore_submission_attempts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore_submission_attempts" ADD CONSTRAINT "chore_submission_attempts_household_chore_fk" FOREIGN KEY ("household_id","chore_instance_id") REFERENCES "public"."chore_instances"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chore_submission_attempts_household_chore_number_idx" ON "chore_submission_attempts" USING btree ("household_id","chore_instance_id","attempt_number");--> statement-breakpoint
INSERT INTO "chore_submission_attempts" (
	"household_id",
	"chore_instance_id",
	"attempt_number",
	"submitted_at",
	"created_at"
)
SELECT
	"chore_instances"."household_id",
	"chore_instances"."id",
	1,
	COALESCE("chore_instances"."submitted_at", "approval_decisions"."created_at", "chore_instances"."created_at"),
	COALESCE("chore_instances"."submitted_at", "approval_decisions"."created_at", "chore_instances"."created_at")
FROM "chore_instances"
LEFT JOIN "approval_decisions"
	ON "approval_decisions"."household_id" = "chore_instances"."household_id"
	AND "approval_decisions"."chore_instance_id" = "chore_instances"."id"
WHERE "chore_instances"."status" = 'AWAITING_APPROVAL'
	OR "approval_decisions"."id" IS NOT NULL;--> statement-breakpoint
UPDATE "approval_decisions"
SET "submission_attempt_id" = "chore_submission_attempts"."id"
FROM "chore_submission_attempts"
WHERE "chore_submission_attempts"."household_id" = "approval_decisions"."household_id"
	AND "chore_submission_attempts"."chore_instance_id" = "approval_decisions"."chore_instance_id"
	AND "chore_submission_attempts"."attempt_number" = 1;--> statement-breakpoint
ALTER TABLE "approval_decisions" ALTER COLUMN "submission_attempt_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_decisions" DROP CONSTRAINT "approval_decisions_household_chore_unique";--> statement-breakpoint
ALTER TABLE "approval_decisions" DROP CONSTRAINT "approval_decisions_household_idempotency_unique";--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_household_attempt_fk" FOREIGN KEY ("household_id","submission_attempt_id","chore_instance_id") REFERENCES "public"."chore_submission_attempts"("household_id","id","chore_instance_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_household_attempt_unique" UNIQUE("household_id","submission_attempt_id");
