CREATE TYPE "public"."feedback_category" AS ENUM('BROKEN', 'CONFUSING', 'IDEA');--> statement-breakpoint
CREATE TYPE "public"."feedback_source" AS ENUM('PARENT_IOS', 'PARENT_ANDROID', 'DASHBOARD');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('NEW', 'REVIEWING', 'READY', 'EXPORTED', 'CLOSED');--> statement-breakpoint
CREATE TABLE "feedback_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"submitted_by_role" "actor_role" NOT NULL,
	"submitted_by_parent_id" uuid,
	"submitted_by_dashboard_device_id" uuid,
	"category" "feedback_category" NOT NULL,
	"title" varchar(160) NOT NULL,
	"description" text NOT NULL,
	"source" "feedback_source" NOT NULL,
	"app_version" varchar(64) NOT NULL,
	"screen" varchar(64) NOT NULL,
	"diagnostic_snapshot" jsonb NOT NULL,
	"status" "feedback_status" DEFAULT 'NEW' NOT NULL,
	"reviewed_by_parent_id" uuid,
	"reviewed_at" timestamp with time zone,
	"public_issue_url" text,
	"exported_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_reports_household_id_unique" UNIQUE("household_id","id"),
	CONSTRAINT "feedback_reports_role_actor_match" CHECK ((
        ("feedback_reports"."submitted_by_role" = 'PARENT' AND "feedback_reports"."submitted_by_parent_id" IS NOT NULL AND "feedback_reports"."submitted_by_dashboard_device_id" IS NULL)
        OR
        ("feedback_reports"."submitted_by_role" = 'DASHBOARD' AND "feedback_reports"."submitted_by_parent_id" IS NULL AND "feedback_reports"."submitted_by_dashboard_device_id" IS NOT NULL)
      )),
	CONSTRAINT "feedback_reports_description_length" CHECK (char_length("feedback_reports"."description") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_household_submitter_parent_fk" FOREIGN KEY ("household_id","submitted_by_parent_id") REFERENCES "public"."parent_memberships"("household_id","parent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_household_submitter_dashboard_fk" FOREIGN KEY ("household_id","submitted_by_dashboard_device_id") REFERENCES "public"."dashboard_devices"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_household_reviewer_parent_fk" FOREIGN KEY ("household_id","reviewed_by_parent_id") REFERENCES "public"."parent_memberships"("household_id","parent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_reports_household_status_created_at_idx" ON "feedback_reports" USING btree ("household_id","status","created_at");--> statement-breakpoint
CREATE INDEX "feedback_reports_dashboard_actor_created_at_idx" ON "feedback_reports" USING btree ("household_id","submitted_by_dashboard_device_id","created_at");