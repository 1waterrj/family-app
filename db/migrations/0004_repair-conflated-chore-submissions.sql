WITH "repair_candidates" AS (
	SELECT
		"chore_instances"."household_id",
		"chore_instances"."id" AS "chore_instance_id",
		COALESCE(
			(
				SELECT max("pending_submission"."created_at")
				FROM "chore_transitions" AS "pending_submission"
				WHERE "pending_submission"."household_id" = "chore_instances"."household_id"
					AND "pending_submission"."chore_instance_id" = "chore_instances"."id"
					AND "pending_submission"."to_status" = 'AWAITING_APPROVAL'
					AND "pending_submission"."created_at" > "approval_decisions"."created_at"
			),
			"chore_instances"."submitted_at",
			"chore_instances"."created_at"
		) AS "submitted_at"
	FROM "chore_instances"
	INNER JOIN "approval_decisions"
		ON "approval_decisions"."household_id" = "chore_instances"."household_id"
		AND "approval_decisions"."chore_instance_id" = "chore_instances"."id"
		AND "approval_decisions"."decision" = 'REJECTED'
	INNER JOIN "chore_submission_attempts" AS "rejected_attempt"
		ON "rejected_attempt"."household_id" = "approval_decisions"."household_id"
		AND "rejected_attempt"."chore_instance_id" = "approval_decisions"."chore_instance_id"
		AND "rejected_attempt"."id" = "approval_decisions"."submission_attempt_id"
		AND "rejected_attempt"."attempt_number" = 1
	WHERE "chore_instances"."status" = 'AWAITING_APPROVAL'
		AND NOT EXISTS (
			SELECT 1
			FROM "chore_submission_attempts" AS "distinct_attempt"
			WHERE "distinct_attempt"."household_id" = "chore_instances"."household_id"
				AND "distinct_attempt"."chore_instance_id" = "chore_instances"."id"
				AND "distinct_attempt"."id" <> "rejected_attempt"."id"
		)
)
INSERT INTO "chore_submission_attempts" (
	"household_id",
	"chore_instance_id",
	"attempt_number",
	"submitted_at",
	"created_at"
)
SELECT
	"repair_candidates"."household_id",
	"repair_candidates"."chore_instance_id",
	2,
	"repair_candidates"."submitted_at",
	"repair_candidates"."submitted_at"
FROM "repair_candidates"
ON CONFLICT ("household_id", "chore_instance_id", "attempt_number") DO NOTHING;
