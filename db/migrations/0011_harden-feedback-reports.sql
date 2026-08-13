CREATE FUNCTION "public"."feedback_jsonb_compact_byte_length"(value jsonb)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $function$
	SELECT CASE jsonb_typeof(value)
		WHEN 'object' THEN 2 + (
			SELECT coalesce(
				sum(
					octet_length(convert_to(to_jsonb(key)::text, 'UTF8'))
					+ 1
					+ public.feedback_jsonb_compact_byte_length(nested_value)
				),
				0
			) + greatest(count(*) - 1, 0)
			FROM jsonb_each(value) AS object_item(key, nested_value)
		)
		WHEN 'array' THEN 2 + (
			SELECT coalesce(
				sum(public.feedback_jsonb_compact_byte_length(element)),
				0
			) + greatest(count(*) - 1, 0)
			FROM jsonb_array_elements(value) AS array_item(element)
		)
		ELSE octet_length(convert_to(value::text, 'UTF8'))
	END
$function$;--> statement-breakpoint
CREATE FUNCTION "public"."feedback_iso_utc_timestamp_is_valid"(value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $function$
DECLARE
	year_part integer;
	month_part integer;
	day_part integer;
	maximum_day integer;
BEGIN
	IF value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?Z$'
	THEN
		RETURN false;
	END IF;

	year_part := substring(value FROM 1 FOR 4)::integer;
	month_part := substring(value FROM 6 FOR 2)::integer;
	day_part := substring(value FROM 9 FOR 2)::integer;

	maximum_day := CASE
		WHEN month_part IN (1, 3, 5, 7, 8, 10, 12) THEN 31
		WHEN month_part IN (4, 6, 9, 11) THEN 30
		WHEN month_part = 2 AND (
			year_part % 400 = 0
			OR (year_part % 4 = 0 AND year_part % 100 <> 0)
		) THEN 29
		WHEN month_part = 2 THEN 28
		ELSE 0
	END;

	RETURN day_part BETWEEN 1 AND maximum_day;
EXCEPTION WHEN others THEN
	RETURN false;
END;
$function$;--> statement-breakpoint
CREATE FUNCTION "public"."feedback_diagnostic_snapshot_is_valid"(snapshot jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $function$
DECLARE
	event jsonb;
	event_status numeric;
BEGIN
	IF jsonb_typeof(snapshot) <> 'object'
		OR (SELECT count(*) FROM jsonb_object_keys(snapshot)) <> 4
		OR NOT snapshot ?& ARRAY['source', 'appVersion', 'currentScreen', 'events']
	THEN
		RETURN false;
	END IF;

	IF jsonb_typeof(snapshot->'source') <> 'string'
		OR snapshot->>'source' NOT IN ('PARENT_IOS', 'PARENT_ANDROID', 'DASHBOARD')
		OR jsonb_typeof(snapshot->'appVersion') <> 'string'
		OR snapshot->>'appVersion' <> btrim(snapshot->>'appVersion')
		OR snapshot->>'appVersion' ~ '^[[:space:]]'
		OR snapshot->>'appVersion' ~ '[[:space:]]$'
		OR char_length(snapshot->>'appVersion') NOT BETWEEN 1 AND 160
		OR jsonb_typeof(snapshot->'currentScreen') <> 'string'
		OR snapshot->>'currentScreen' NOT IN (
			'SETUP', 'PARENT_HOME', 'PARENT_APPROVALS', 'PARENT_CHORES',
			'PARENT_REWARDS', 'PARENT_FEEDBACK', 'PARENT_FEEDBACK_DETAIL',
			'PARENT_FEEDBACK_EXPORT', 'DASHBOARD_HOME',
			'DASHBOARD_CHORE_BOARD', 'DASHBOARD_CHORE_DETAIL',
			'DASHBOARD_ACTIVE_CHORE', 'DASHBOARD_FEEDBACK'
		)
		OR jsonb_typeof(snapshot->'events') <> 'array'
	THEN
		RETURN false;
	END IF;

	IF jsonb_array_length(snapshot->'events') > 100
		OR public.feedback_jsonb_compact_byte_length(snapshot->'events') > 24576
	THEN
		RETURN false;
	END IF;

	FOR event IN SELECT value FROM jsonb_array_elements(snapshot->'events')
	LOOP
		IF jsonb_typeof(event) <> 'object'
			OR jsonb_typeof(event->'kind') <> 'string'
			OR jsonb_typeof(event->'at') <> 'string'
			OR NOT public.feedback_iso_utc_timestamp_is_valid(event->>'at')
		THEN
			RETURN false;
		END IF;

		CASE event->>'kind'
			WHEN 'SCREEN' THEN
				IF (SELECT count(*) FROM jsonb_object_keys(event)) <> 3
					OR NOT event ?& ARRAY['kind', 'at', 'screen']
					OR jsonb_typeof(event->'screen') <> 'string'
					OR event->>'screen' NOT IN (
						'SETUP', 'PARENT_HOME', 'PARENT_APPROVALS', 'PARENT_CHORES',
						'PARENT_REWARDS', 'PARENT_FEEDBACK', 'PARENT_FEEDBACK_DETAIL',
						'PARENT_FEEDBACK_EXPORT', 'DASHBOARD_HOME',
						'DASHBOARD_CHORE_BOARD', 'DASHBOARD_CHORE_DETAIL',
						'DASHBOARD_ACTIVE_CHORE', 'DASHBOARD_FEEDBACK'
					)
				THEN
					RETURN false;
				END IF;
			WHEN 'NETWORK' THEN
				IF (SELECT count(*) FROM jsonb_object_keys(event)) <> 3
					OR NOT event ?& ARRAY['kind', 'at', 'state']
					OR jsonb_typeof(event->'state') <> 'string'
					OR event->>'state' NOT IN ('ONLINE', 'OFFLINE')
				THEN
					RETURN false;
				END IF;
			WHEN 'API_RESULT' THEN
				IF (SELECT count(*) FROM jsonb_object_keys(event)) <> 8
					OR NOT event ?& ARRAY[
						'kind', 'at', 'operation', 'outcome', 'status', 'errorCode',
						'durationBucket', 'requestId'
					]
					OR jsonb_typeof(event->'operation') <> 'string'
					OR event->>'operation' NOT IN (
						'GET_PARENT_SNAPSHOT', 'GET_DASHBOARD_SNAPSHOT',
						'CREATE_HOUSEHOLD', 'CREATE_CHILD', 'GET_CHILD_LEDGER',
						'GET_CHILD_BALANCE', 'RECORD_MANUAL_LEDGER_ENTRY',
						'CREATE_CHORE_TEMPLATE', 'PUBLISH_CHORE_INSTANCE',
						'LIST_CHORE_INSTANCES', 'CLAIM_CHORE', 'SUBMIT_CHORE',
						'EXTEND_CHORE_CLAIM', 'CANCEL_CHORE_CLAIM',
						'APPROVE_CHORE', 'REJECT_CHORE', 'CREATE_FEEDBACK',
						'LIST_FEEDBACK', 'GET_FEEDBACK', 'UPDATE_FEEDBACK',
						'DELETE_FEEDBACK', 'CREATE_FEEDBACK_PUBLIC_PREVIEW'
					)
					OR jsonb_typeof(event->'outcome') <> 'string'
					OR event->>'outcome' NOT IN ('SUCCESS', 'ERROR')
					OR jsonb_typeof(event->'durationBucket') <> 'string'
					OR event->>'durationBucket' NOT IN (
						'UNDER_250_MS', 'UNDER_1_SECOND', 'UNDER_5_SECONDS',
						'FIVE_SECONDS_OR_MORE'
					)
				THEN
					RETURN false;
				END IF;

				IF event->'status' <> 'null'::jsonb THEN
					IF jsonb_typeof(event->'status') <> 'number' THEN
						RETURN false;
					END IF;
					event_status := (event->>'status')::numeric;
					IF event_status <> trunc(event_status)
						OR event_status NOT BETWEEN 100 AND 599
					THEN
						RETURN false;
					END IF;
				END IF;

				IF event->'errorCode' <> 'null'::jsonb
					AND (
						jsonb_typeof(event->'errorCode') <> 'string'
						OR event->>'errorCode' NOT IN (
							'VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND',
							'PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE',
							'CHORE_UNAVAILABLE', 'CONFLICT', 'INVALID_STATE',
							'INTERNAL_ERROR', 'RATE_LIMITED'
						)
					)
				THEN
					RETURN false;
				END IF;

				IF event->'requestId' <> 'null'::jsonb
					AND (
						jsonb_typeof(event->'requestId') <> 'string'
						OR NOT (
							event->>'requestId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
							OR event->>'requestId' = '00000000-0000-0000-0000-000000000000'
							OR event->>'requestId' = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
						)
					)
				THEN
					RETURN false;
				END IF;
			ELSE
				RETURN false;
		END CASE;
	END LOOP;

	RETURN true;
EXCEPTION WHEN others THEN
	RETURN false;
END;
$function$;--> statement-breakpoint
ALTER TABLE "feedback_reports" ALTER COLUMN "app_version" SET DATA TYPE varchar(160);--> statement-breakpoint
CREATE INDEX "feedback_reports_household_created_at_id_idx" ON "feedback_reports" USING btree ("household_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feedback_reports_household_status_closed_at_idx" ON "feedback_reports" USING btree ("household_id","status","closed_at");--> statement-breakpoint
UPDATE "feedback_reports"
SET
	"app_version" = CASE
		WHEN char_length("app_version") BETWEEN 1 AND 160
			AND "app_version" = btrim("app_version")
			AND "app_version" !~ '^[[:space:]]'
			AND "app_version" !~ '[[:space:]]$'
		THEN "app_version"
		ELSE 'unknown'
	END,
	"screen" = CASE
		WHEN "screen" IN (
			'SETUP', 'PARENT_HOME', 'PARENT_APPROVALS', 'PARENT_CHORES',
			'PARENT_REWARDS', 'PARENT_FEEDBACK', 'PARENT_FEEDBACK_DETAIL',
			'PARENT_FEEDBACK_EXPORT', 'DASHBOARD_HOME',
			'DASHBOARD_CHORE_BOARD', 'DASHBOARD_CHORE_DETAIL',
			'DASHBOARD_ACTIVE_CHORE', 'DASHBOARD_FEEDBACK'
		) THEN "screen"
		WHEN "source" = 'DASHBOARD' THEN 'DASHBOARD_HOME'
		ELSE 'PARENT_HOME'
	END;--> statement-breakpoint
UPDATE "feedback_reports"
SET "diagnostic_snapshot" = jsonb_build_object(
	'source', "source"::text,
	'appVersion', "app_version",
	'currentScreen', "screen",
	'events', '[]'::jsonb
)
WHERE NOT feedback_diagnostic_snapshot_is_valid("diagnostic_snapshot")
	OR (
		"diagnostic_snapshot"->>'source' = "source"::text
		AND "diagnostic_snapshot"->>'appVersion' = "app_version"
		AND "diagnostic_snapshot"->>'currentScreen' = "screen"
	) IS NOT TRUE;--> statement-breakpoint
UPDATE "feedback_reports"
SET "reviewed_at" = CASE
	WHEN "reviewed_by_parent_id" IS NULL THEN NULL
	ELSE greatest(coalesce("reviewed_at", "created_at"), "created_at")
END;--> statement-breakpoint
UPDATE "feedback_reports"
SET
	"status" = 'NEW',
	"exported_at" = NULL,
	"closed_at" = NULL
WHERE "reviewed_by_parent_id" IS NULL
	AND "status" IN ('REVIEWING', 'READY', 'EXPORTED', 'CLOSED');--> statement-breakpoint
UPDATE "feedback_reports"
SET
	"exported_at" = CASE
		WHEN "status" = 'EXPORTED'
		THEN greatest(coalesce("exported_at", "reviewed_at", "created_at"), "reviewed_at", "created_at")
		ELSE NULL
	END,
	"closed_at" = CASE
		WHEN "status" = 'CLOSED'
		THEN greatest(coalesce("closed_at", "reviewed_at", "created_at"), "reviewed_at", "created_at")
		ELSE NULL
	END;--> statement-breakpoint
UPDATE "feedback_reports"
SET "updated_at" = greatest(
	"updated_at",
	"created_at",
	coalesce("reviewed_at", "created_at"),
	coalesce("exported_at", "created_at"),
	coalesce("closed_at", "created_at")
);--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_diagnostic_snapshot_valid" CHECK (feedback_diagnostic_snapshot_is_valid("feedback_reports"."diagnostic_snapshot"));--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_diagnostic_metadata_match" CHECK ((
        "feedback_reports"."diagnostic_snapshot"->>'source' = "feedback_reports"."source"::text
        AND "feedback_reports"."diagnostic_snapshot"->>'appVersion' = "feedback_reports"."app_version"
        AND "feedback_reports"."diagnostic_snapshot"->>'currentScreen' = "feedback_reports"."screen"
      ));--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_reviewer_pair" CHECK ((
        ("feedback_reports"."reviewed_by_parent_id" IS NULL AND "feedback_reports"."reviewed_at" IS NULL)
        OR
        ("feedback_reports"."reviewed_by_parent_id" IS NOT NULL AND "feedback_reports"."reviewed_at" IS NOT NULL)
      ));--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_status_lifecycle_match" CHECK ((
        ("feedback_reports"."status" = 'NEW' AND "feedback_reports"."exported_at" IS NULL AND "feedback_reports"."closed_at" IS NULL)
        OR
        ("feedback_reports"."status" IN ('REVIEWING', 'READY') AND "feedback_reports"."reviewed_at" IS NOT NULL AND "feedback_reports"."exported_at" IS NULL AND "feedback_reports"."closed_at" IS NULL)
        OR
        ("feedback_reports"."status" = 'EXPORTED' AND "feedback_reports"."reviewed_at" IS NOT NULL AND "feedback_reports"."exported_at" IS NOT NULL AND "feedback_reports"."closed_at" IS NULL)
        OR
        ("feedback_reports"."status" = 'CLOSED' AND "feedback_reports"."reviewed_at" IS NOT NULL AND "feedback_reports"."exported_at" IS NULL AND "feedback_reports"."closed_at" IS NOT NULL)
      ));--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_lifecycle_chronology" CHECK ((
        "feedback_reports"."updated_at" >= "feedback_reports"."created_at"
        AND ("feedback_reports"."reviewed_at" IS NULL OR ("feedback_reports"."reviewed_at" >= "feedback_reports"."created_at" AND "feedback_reports"."reviewed_at" <= "feedback_reports"."updated_at"))
        AND ("feedback_reports"."exported_at" IS NULL OR ("feedback_reports"."exported_at" >= "feedback_reports"."created_at" AND "feedback_reports"."exported_at" <= "feedback_reports"."updated_at" AND "feedback_reports"."reviewed_at" <= "feedback_reports"."exported_at"))
        AND ("feedback_reports"."closed_at" IS NULL OR ("feedback_reports"."closed_at" >= "feedback_reports"."created_at" AND "feedback_reports"."closed_at" <= "feedback_reports"."updated_at" AND "feedback_reports"."reviewed_at" <= "feedback_reports"."closed_at"))
      ));
