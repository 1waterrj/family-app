CREATE TYPE "public"."actor_role" AS ENUM('PARENT', 'DASHBOARD');--> statement-breakpoint
CREATE TYPE "public"."approval_decision" AS ENUM('APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."chore_status" AS ENUM('AVAILABLE', 'CLAIMED', 'AWAITING_APPROVAL', 'APPROVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."ledger_transaction_type" AS ENUM('CHORE_CREDIT', 'PURCHASE', 'MANUAL_CREDIT', 'MANUAL_DEBIT');--> statement-breakpoint
CREATE TABLE "approval_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"chore_instance_id" uuid NOT NULL,
	"decided_by_parent_id" uuid NOT NULL,
	"decision" "approval_decision" NOT NULL,
	"payout_cents" integer,
	"note" text,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_decisions_household_chore_unique" UNIQUE("household_id","chore_instance_id"),
	CONSTRAINT "approval_decisions_household_idempotency_unique" UNIQUE("household_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"actor_role" "actor_role" NOT NULL,
	"actor_parent_id" uuid,
	"actor_dashboard_device_id" uuid,
	"event_type" varchar(120) NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "child_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"color" varchar(32) NOT NULL,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "child_profiles_household_id_unique" UNIQUE("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "chore_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"chore_template_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"image_url" text,
	"instructions" text NOT NULL,
	"value_cents" integer NOT NULL,
	"duration_seconds" integer NOT NULL,
	"status" "chore_status" DEFAULT 'AVAILABLE' NOT NULL,
	"claimed_by_child_id" uuid,
	"claim_deadline_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chore_instances_household_id_unique" UNIQUE("household_id","id"),
	CONSTRAINT "chore_instances_value_cents_nonnegative" CHECK ("chore_instances"."value_cents" >= 0),
	CONSTRAINT "chore_instances_duration_seconds_range" CHECK ("chore_instances"."duration_seconds" BETWEEN 60 AND 86400)
);
--> statement-breakpoint
CREATE TABLE "chore_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"created_by_parent_id" uuid,
	"name" varchar(120) NOT NULL,
	"image_url" text,
	"instructions" text NOT NULL,
	"default_value_cents" integer NOT NULL,
	"default_duration_seconds" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chore_templates_household_id_unique" UNIQUE("household_id","id"),
	CONSTRAINT "chore_templates_default_value_cents_nonnegative" CHECK ("chore_templates"."default_value_cents" >= 0),
	CONSTRAINT "chore_templates_default_duration_seconds_range" CHECK ("chore_templates"."default_duration_seconds" BETWEEN 60 AND 86400)
);
--> statement-breakpoint
CREATE TABLE "chore_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"chore_instance_id" uuid NOT NULL,
	"from_status" "chore_status" NOT NULL,
	"to_status" "chore_status" NOT NULL,
	"actor_role" "actor_role" NOT NULL,
	"actor_parent_id" uuid,
	"actor_dashboard_device_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_devices_household_id_unique" UNIQUE("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"time_zone" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"actor_role" "actor_role" NOT NULL,
	"actor_id" uuid NOT NULL,
	"operation" varchar(120) NOT NULL,
	"request_hash" varchar(128) NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_household_key_unique" UNIQUE("household_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"type" "ledger_transaction_type" NOT NULL,
	"note" text,
	"actor_parent_id" uuid,
	"related_chore_instance_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_transactions_amount_cents_nonzero" CHECK ("ledger_transactions"."amount_cents" <> 0)
);
--> statement-breakpoint
CREATE TABLE "parent_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"parent_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parent_memberships_household_parent_unique" UNIQUE("household_id","parent_id")
);
--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_household_chore_fk" FOREIGN KEY ("household_id","chore_instance_id") REFERENCES "public"."chore_instances"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_household_parent_fk" FOREIGN KEY ("household_id","decided_by_parent_id") REFERENCES "public"."parent_memberships"("household_id","parent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_household_parent_fk" FOREIGN KEY ("household_id","actor_parent_id") REFERENCES "public"."parent_memberships"("household_id","parent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_household_dashboard_fk" FOREIGN KEY ("household_id","actor_dashboard_device_id") REFERENCES "public"."dashboard_devices"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "child_profiles" ADD CONSTRAINT "child_profiles_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore_instances" ADD CONSTRAINT "chore_instances_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore_instances" ADD CONSTRAINT "chore_instances_household_template_fk" FOREIGN KEY ("household_id","chore_template_id") REFERENCES "public"."chore_templates"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore_instances" ADD CONSTRAINT "chore_instances_household_child_fk" FOREIGN KEY ("household_id","claimed_by_child_id") REFERENCES "public"."child_profiles"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore_templates" ADD CONSTRAINT "chore_templates_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore_templates" ADD CONSTRAINT "chore_templates_household_parent_fk" FOREIGN KEY ("household_id","created_by_parent_id") REFERENCES "public"."parent_memberships"("household_id","parent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore_transitions" ADD CONSTRAINT "chore_transitions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore_transitions" ADD CONSTRAINT "chore_transitions_household_chore_fk" FOREIGN KEY ("household_id","chore_instance_id") REFERENCES "public"."chore_instances"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore_transitions" ADD CONSTRAINT "chore_transitions_household_parent_fk" FOREIGN KEY ("household_id","actor_parent_id") REFERENCES "public"."parent_memberships"("household_id","parent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore_transitions" ADD CONSTRAINT "chore_transitions_household_dashboard_fk" FOREIGN KEY ("household_id","actor_dashboard_device_id") REFERENCES "public"."dashboard_devices"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_devices" ADD CONSTRAINT "dashboard_devices_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_household_child_fk" FOREIGN KEY ("household_id","child_id") REFERENCES "public"."child_profiles"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_household_parent_fk" FOREIGN KEY ("household_id","actor_parent_id") REFERENCES "public"."parent_memberships"("household_id","parent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_household_chore_fk" FOREIGN KEY ("household_id","related_chore_instance_id") REFERENCES "public"."chore_instances"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_memberships" ADD CONSTRAINT "parent_memberships_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chore_instances_household_status_idx" ON "chore_instances" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "chore_instances_household_child_created_at_idx" ON "chore_instances" USING btree ("household_id","claimed_by_child_id","created_at");--> statement-breakpoint
CREATE INDEX "chore_instances_claim_expiration_idx" ON "chore_instances" USING btree ("household_id","claim_deadline_at") WHERE "chore_instances"."status" = 'CLAIMED';--> statement-breakpoint
CREATE INDEX "ledger_transactions_household_child_created_at_idx" ON "ledger_transactions" USING btree ("household_id","child_id","created_at");