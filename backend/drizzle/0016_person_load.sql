ALTER TABLE "task_assignees" ADD COLUMN "load_override" double precision;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "ai_only_load" double precision;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_load_override_not_negative" CHECK ("task_assignees"."load_override" >= 0);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_ai_only_load" CHECK ("tasks"."ai_only_load" is null or ("tasks"."ai_share" = 100 and "tasks"."ai_only_load" >= 0));