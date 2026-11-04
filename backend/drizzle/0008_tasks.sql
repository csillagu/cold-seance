CREATE TYPE "public"."task_status" AS ENUM('not-started', 'in-progress', 'on-hold', 'done', 'cancelled');--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "task_status" DEFAULT 'not-started' NOT NULL,
	"planned_start" date,
	"planned_finish" date,
	"duration_working_days" integer,
	"effort" double precision,
	"ai_share" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_duration_whole_days" CHECK ("tasks"."duration_working_days" >= 1),
	CONSTRAINT "tasks_finish_not_before_start" CHECK ("tasks"."planned_finish" >= "tasks"."planned_start"),
	CONSTRAINT "tasks_effort_not_negative" CHECK ("tasks"."effort" >= 0),
	CONSTRAINT "tasks_ai_share_percentage" CHECK ("tasks"."ai_share" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_project_id_idx" ON "tasks" USING btree ("project_id","created_at");