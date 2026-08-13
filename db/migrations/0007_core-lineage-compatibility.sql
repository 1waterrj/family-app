ALTER TABLE "idempotency_records" ADD COLUMN IF NOT EXISTS "actor_parent_id" uuid;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD COLUMN IF NOT EXISTS "actor_dashboard_device_id" uuid;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'idempotency_records'
			AND column_name = 'actor_id'
	) THEN
		UPDATE "idempotency_records"
		SET
			"actor_parent_id" = CASE
				WHEN "actor_role" = 'PARENT' THEN "actor_id"
				ELSE NULL
			END,
			"actor_dashboard_device_id" = CASE
				WHEN "actor_role" = 'DASHBOARD' THEN "actor_id"
				ELSE NULL
			END;
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conrelid = 'public.idempotency_records'::regclass
			AND conname = 'idempotency_records_household_parent_fk'
	) THEN
		ALTER TABLE "idempotency_records"
			ADD CONSTRAINT "idempotency_records_household_parent_fk"
			FOREIGN KEY ("household_id", "actor_parent_id")
			REFERENCES "public"."parent_memberships"("household_id", "parent_id");
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conrelid = 'public.idempotency_records'::regclass
			AND conname = 'idempotency_records_household_dashboard_fk'
	) THEN
		ALTER TABLE "idempotency_records"
			ADD CONSTRAINT "idempotency_records_household_dashboard_fk"
			FOREIGN KEY ("household_id", "actor_dashboard_device_id")
			REFERENCES "public"."dashboard_devices"("household_id", "id");
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conrelid = 'public.idempotency_records'::regclass
			AND conname = 'idempotency_records_role_actor_match'
	) THEN
		ALTER TABLE "idempotency_records"
			ADD CONSTRAINT "idempotency_records_role_actor_match" CHECK ((
				("actor_role" = 'PARENT' AND "actor_parent_id" IS NOT NULL AND "actor_dashboard_device_id" IS NULL)
				OR
				("actor_role" = 'DASHBOARD' AND "actor_parent_id" IS NULL AND "actor_dashboard_device_id" IS NOT NULL)
			));
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conrelid = 'public.audit_events'::regclass
			AND conname = 'audit_events_role_actor_match'
	) THEN
		ALTER TABLE "audit_events"
			ADD CONSTRAINT "audit_events_role_actor_match" CHECK ((
				("actor_role" = 'PARENT' AND "actor_parent_id" IS NOT NULL AND "actor_dashboard_device_id" IS NULL)
				OR
				("actor_role" = 'DASHBOARD' AND "actor_parent_id" IS NULL AND "actor_dashboard_device_id" IS NOT NULL)
			));
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conrelid = 'public.chore_transitions'::regclass
			AND conname = 'chore_transitions_role_actor_match'
	) THEN
		ALTER TABLE "chore_transitions"
			ADD CONSTRAINT "chore_transitions_role_actor_match" CHECK ((
				("actor_role" = 'PARENT' AND "actor_parent_id" IS NOT NULL AND "actor_dashboard_device_id" IS NULL)
				OR
				("actor_role" = 'DASHBOARD' AND "actor_parent_id" IS NULL AND "actor_dashboard_device_id" IS NOT NULL)
				OR
				("actor_role"::text = 'SYSTEM' AND "actor_parent_id" IS NULL AND "actor_dashboard_device_id" IS NULL)
			));
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "idempotency_records" DROP COLUMN IF EXISTS "actor_id";
