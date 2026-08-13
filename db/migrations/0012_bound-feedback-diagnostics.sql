CREATE FUNCTION "public"."feedback_app_version_is_valid"(value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $function$
	SELECT char_length(value) <= 160
		AND value ~ '^(development|(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(\.(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?)$'
$function$;--> statement-breakpoint
CREATE FUNCTION "public"."feedback_event_epoch_seconds"(value text)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $function$
DECLARE
	year_part integer;
	month_part integer;
	day_part integer;
	hour_part integer;
	minute_part integer;
	second_part integer;
	completed_years bigint;
	completed_months integer;
	leap_day integer;
BEGIN
	IF NOT public.feedback_iso_utc_timestamp_is_valid(value) THEN
		RETURN NULL;
	END IF;

	year_part := substring(value FROM 1 FOR 4)::integer;
	month_part := substring(value FROM 6 FOR 2)::integer;
	day_part := substring(value FROM 9 FOR 2)::integer;
	hour_part := substring(value FROM 12 FOR 2)::integer;
	minute_part := substring(value FROM 15 FOR 2)::integer;
	second_part := CASE
		WHEN substring(value FROM 17 FOR 1) = ':'
		THEN substring(value FROM 18 FOR 2)::integer
		ELSE 0
	END;
	completed_years := 365::bigint * year_part
		+ (year_part + 3) / 4
		- (year_part + 99) / 100
		+ (year_part + 399) / 400;
	completed_months := CASE month_part
		WHEN 1 THEN 0 WHEN 2 THEN 31 WHEN 3 THEN 59 WHEN 4 THEN 90
		WHEN 5 THEN 120 WHEN 6 THEN 151 WHEN 7 THEN 181 WHEN 8 THEN 212
		WHEN 9 THEN 243 WHEN 10 THEN 273 WHEN 11 THEN 304 WHEN 12 THEN 334
	END;
	leap_day := CASE
		WHEN month_part > 2 AND (
			year_part % 400 = 0
			OR (year_part % 4 = 0 AND year_part % 100 <> 0)
		) THEN 1
		ELSE 0
	END;

	RETURN
		(completed_years + completed_months + leap_day + day_part - 1)
			* 86400
		+ hour_part * 3600
		+ minute_part * 60
		+ second_part;
EXCEPTION WHEN others THEN
	RETURN NULL;
END;
$function$;--> statement-breakpoint
CREATE FUNCTION "public"."feedback_fraction_compare"(left_value text, right_value text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $function$
	SELECT CASE
		WHEN rpad(left_value, greatest(char_length(left_value), char_length(right_value)), '0')
			< rpad(right_value, greatest(char_length(left_value), char_length(right_value)), '0')
		THEN -1
		WHEN rpad(left_value, greatest(char_length(left_value), char_length(right_value)), '0')
			> rpad(right_value, greatest(char_length(left_value), char_length(right_value)), '0')
		THEN 1
		ELSE 0
	END
$function$;--> statement-breakpoint
CREATE FUNCTION "public"."feedback_diagnostic_events_fit_window"(events jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $function$
DECLARE
	event jsonb;
	event_seconds bigint;
	event_fraction text;
	earliest_seconds bigint;
	earliest_fraction text;
	latest_seconds bigint;
	latest_fraction text;
	span_seconds bigint;
BEGIN
	IF jsonb_typeof(events) <> 'array' THEN
		RETURN false;
	END IF;

	FOR event IN SELECT value FROM jsonb_array_elements(events)
	LOOP
		event_seconds := public.feedback_event_epoch_seconds(event->>'at');
		IF event_seconds IS NULL THEN
			RETURN false;
		END IF;
		event_fraction := regexp_replace(
			coalesce(substring(event->>'at' FROM '\.([0-9]+)Z$'), ''),
			'0+$',
			''
		);

		IF earliest_seconds IS NULL
			OR event_seconds < earliest_seconds
			OR (
				event_seconds = earliest_seconds
				AND public.feedback_fraction_compare(event_fraction, earliest_fraction) < 0
			)
		THEN
			earliest_seconds := event_seconds;
			earliest_fraction := event_fraction;
		END IF;

		IF latest_seconds IS NULL
			OR event_seconds > latest_seconds
			OR (
				event_seconds = latest_seconds
				AND public.feedback_fraction_compare(event_fraction, latest_fraction) > 0
			)
		THEN
			latest_seconds := event_seconds;
			latest_fraction := event_fraction;
		END IF;
	END LOOP;

	IF earliest_seconds IS NULL OR latest_seconds IS NULL THEN
		RETURN true;
	END IF;
	span_seconds := latest_seconds - earliest_seconds;
	RETURN span_seconds < 900
		OR (
			span_seconds = 900
			AND public.feedback_fraction_compare(
				latest_fraction,
				earliest_fraction
			) <= 0
		);
EXCEPTION WHEN others THEN
	RETURN false;
END;
$function$;--> statement-breakpoint
UPDATE "feedback_reports"
SET
	"app_version" = 'development',
	"diagnostic_snapshot" = jsonb_set(
		"diagnostic_snapshot",
		'{appVersion}',
		to_jsonb('development'::text),
		false
	)
WHERE NOT public.feedback_app_version_is_valid("app_version");--> statement-breakpoint
UPDATE "feedback_reports"
SET "diagnostic_snapshot" = jsonb_set(
	"diagnostic_snapshot",
	'{events}',
	'[]'::jsonb,
	false
)
WHERE NOT public.feedback_diagnostic_events_fit_window(
	"diagnostic_snapshot"->'events'
);--> statement-breakpoint
ALTER FUNCTION "public"."feedback_diagnostic_snapshot_is_valid"(jsonb)
RENAME TO "feedback_diagnostic_snapshot_structure_is_valid";--> statement-breakpoint
CREATE FUNCTION "public"."feedback_diagnostic_snapshot_is_valid"(snapshot jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
	SELECT public.feedback_diagnostic_snapshot_structure_is_valid(snapshot)
		AND public.feedback_app_version_is_valid(snapshot->>'appVersion')
		AND public.feedback_diagnostic_events_fit_window(snapshot->'events')
$function$;--> statement-breakpoint
ALTER TABLE "feedback_reports"
DROP CONSTRAINT "feedback_reports_diagnostic_snapshot_valid";--> statement-breakpoint
ALTER TABLE "feedback_reports"
ADD CONSTRAINT "feedback_reports_diagnostic_snapshot_valid"
CHECK (public.feedback_diagnostic_snapshot_is_valid("diagnostic_snapshot"));
