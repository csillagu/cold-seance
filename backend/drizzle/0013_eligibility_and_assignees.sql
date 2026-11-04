CREATE TABLE "task_assignees" (
	"task_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "eligibility" jsonb;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_assignees_key" ON "task_assignees" USING btree ("task_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_assignees_position_key" ON "task_assignees" USING btree ("task_id","position");--> statement-breakpoint
CREATE INDEX "task_assignees_account_id_idx" ON "task_assignees" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_has_no_eligibility" CHECK ("tasks"."milestone_variant" is null or "tasks"."eligibility" is null);