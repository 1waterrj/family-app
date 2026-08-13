ALTER TABLE "chore_transitions" DROP CONSTRAINT "chore_transitions_role_actor_match";--> statement-breakpoint
ALTER TABLE "chore_transitions" ADD CONSTRAINT "chore_transitions_role_actor_match" CHECK ((
        ("chore_transitions"."actor_role" = 'PARENT' AND "chore_transitions"."actor_parent_id" IS NOT NULL AND "chore_transitions"."actor_dashboard_device_id" IS NULL)
        OR
        ("chore_transitions"."actor_role" = 'DASHBOARD' AND "chore_transitions"."actor_parent_id" IS NULL AND "chore_transitions"."actor_dashboard_device_id" IS NOT NULL)
        OR
        ("chore_transitions"."actor_role"::text = 'SYSTEM' AND "chore_transitions"."actor_parent_id" IS NULL AND "chore_transitions"."actor_dashboard_device_id" IS NULL)
      ));
