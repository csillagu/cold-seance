CREATE TYPE "public"."milestone_variant" AS ENUM('fixed-date', 'floating');--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "milestone_variant" "milestone_variant";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "milestone_date" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_date_iff_fixed" CHECK (("tasks"."milestone_variant" is not distinct from 'fixed-date') = ("tasks"."milestone_date" is not null));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_takes_no_time" CHECK ("tasks"."milestone_variant" is null or ("tasks"."planned_start" is null and "tasks"."planned_finish" is null and "tasks"."duration_working_days" is null and "tasks"."effort" is null and "tasks"."ai_share" is null));