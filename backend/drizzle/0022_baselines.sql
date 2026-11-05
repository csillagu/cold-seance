CREATE TABLE "baseline_tasks" (
	"baseline_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"planned_start" date,
	"planned_finish" date
);
--> statement-breakpoint
CREATE TABLE "baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "baseline_tasks" ADD CONSTRAINT "baseline_tasks_baseline_id_baselines_id_fk" FOREIGN KEY ("baseline_id") REFERENCES "public"."baselines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baseline_tasks" ADD CONSTRAINT "baseline_tasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "baseline_tasks_key" ON "baseline_tasks" USING btree ("baseline_id","task_id");--> statement-breakpoint
CREATE INDEX "baseline_tasks_task_id_idx" ON "baseline_tasks" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "baselines_project_name_key" ON "baselines" USING btree ("project_id",md5("name"));