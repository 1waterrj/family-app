ALTER TABLE "chore_submission_attempts" ADD COLUMN "claimed_by_child_id" uuid;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD COLUMN "approval_decision_id" uuid;--> statement-breakpoint
WITH "latest_attempts" AS (
	SELECT DISTINCT ON ("household_id", "chore_instance_id")
		"id",
		"household_id",
		"chore_instance_id"
	FROM "chore_submission_attempts"
	ORDER BY "household_id", "chore_instance_id", "attempt_number" DESC
)
UPDATE "chore_submission_attempts"
SET "claimed_by_child_id" = "chore_instances"."claimed_by_child_id"
FROM "latest_attempts", "chore_instances"
WHERE "chore_submission_attempts"."id" = "latest_attempts"."id"
	AND "chore_instances"."household_id" = "latest_attempts"."household_id"
	AND "chore_instances"."id" = "latest_attempts"."chore_instance_id"
	AND "chore_instances"."claimed_by_child_id" IS NOT NULL
	AND (
		(
			"chore_instances"."status" = 'AWAITING_APPROVAL'
			AND NOT EXISTS (
				SELECT 1
				FROM "approval_decisions"
				WHERE "approval_decisions"."household_id" = "latest_attempts"."household_id"
					AND "approval_decisions"."submission_attempt_id" = "latest_attempts"."id"
			)
		)
		OR EXISTS (
			SELECT 1
			FROM "approval_decisions"
			WHERE "approval_decisions"."household_id" = "latest_attempts"."household_id"
				AND "approval_decisions"."submission_attempt_id" = "latest_attempts"."id"
				AND (
					(
						"chore_instances"."status" = 'APPROVED'
						AND "approval_decisions"."decision" = 'APPROVED'
					)
					OR (
						"chore_instances"."status" = 'CLOSED'
						AND "approval_decisions"."decision" = 'REJECTED'
					)
				)
		)
	);--> statement-breakpoint
WITH "deterministic_approved_credits" AS (
	SELECT
		"approval_decisions"."household_id",
		"approval_decisions"."submission_attempt_id",
		min("ledger_transactions"."child_id"::text)::uuid AS "child_id"
	FROM "approval_decisions"
	INNER JOIN "ledger_transactions"
		ON "ledger_transactions"."household_id" = "approval_decisions"."household_id"
		AND "ledger_transactions"."related_chore_instance_id" = "approval_decisions"."chore_instance_id"
		AND "ledger_transactions"."type" = 'CHORE_CREDIT'
	WHERE "approval_decisions"."decision" = 'APPROVED'
	GROUP BY
		"approval_decisions"."household_id",
		"approval_decisions"."submission_attempt_id"
	HAVING count(*) = 1
)
UPDATE "chore_submission_attempts"
SET "claimed_by_child_id" = "deterministic_approved_credits"."child_id"
FROM "deterministic_approved_credits"
WHERE "chore_submission_attempts"."household_id" = "deterministic_approved_credits"."household_id"
	AND "chore_submission_attempts"."id" = "deterministic_approved_credits"."submission_attempt_id"
	AND "chore_submission_attempts"."claimed_by_child_id" IS NULL;--> statement-breakpoint
ALTER TABLE "chore_submission_attempts" ADD CONSTRAINT "chore_submission_attempts_household_child_fk" FOREIGN KEY ("household_id","claimed_by_child_id") REFERENCES "public"."child_profiles"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore_submission_attempts" ADD CONSTRAINT "chore_submission_attempts_claimant_required" CHECK ("chore_submission_attempts"."claimed_by_child_id" IS NOT NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_household_id_unique" UNIQUE("household_id","id");--> statement-breakpoint
WITH "deterministic_credit_links" AS (
	SELECT
		min("ledger_transactions"."id"::text)::uuid AS "ledger_transaction_id",
		min("approval_decisions"."id"::text)::uuid AS "approval_decision_id"
	FROM "ledger_transactions"
	INNER JOIN "approval_decisions"
		ON "approval_decisions"."household_id" = "ledger_transactions"."household_id"
		AND "approval_decisions"."chore_instance_id" = "ledger_transactions"."related_chore_instance_id"
		AND "approval_decisions"."decision" = 'APPROVED'
	WHERE "ledger_transactions"."type" = 'CHORE_CREDIT'
	GROUP BY
		"ledger_transactions"."household_id",
		"ledger_transactions"."related_chore_instance_id"
	HAVING count(DISTINCT "ledger_transactions"."id") = 1
		AND count(DISTINCT "approval_decisions"."id") = 1
)
UPDATE "ledger_transactions"
SET "approval_decision_id" = "deterministic_credit_links"."approval_decision_id"
FROM "deterministic_credit_links"
WHERE "ledger_transactions"."id" = "deterministic_credit_links"."ledger_transaction_id";--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_household_approval_fk" FOREIGN KEY ("household_id","approval_decision_id") REFERENCES "public"."approval_decisions"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_household_approval_unique" UNIQUE("household_id","approval_decision_id");--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_chore_credit_approval_match" CHECK ((
        ("ledger_transactions"."type" = 'CHORE_CREDIT' AND "ledger_transactions"."approval_decision_id" IS NOT NULL)
        OR ("ledger_transactions"."type" <> 'CHORE_CREDIT' AND "ledger_transactions"."approval_decision_id" IS NULL)
      )) NOT VALID;
