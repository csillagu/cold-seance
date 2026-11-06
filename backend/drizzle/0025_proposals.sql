CREATE TYPE "public"."proposal_change_kind" AS ENUM('create-task', 'update-task', 'set-parent', 'add-blocker', 'remove-blocker', 'set-status', 'cancel-task', 'assign-repository');--> statement-breakpoint
CREATE TABLE "proposal_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" "proposal_change_kind" NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"new_task_key" text,
	"change" jsonb NOT NULL,
	CONSTRAINT "proposal_changes_one_task" CHECK ("proposal_changes"."task_id" is null or "proposal_changes"."new_task_key" is null)
);
--> statement-breakpoint
CREATE TABLE "proposal_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_projects" (
	"proposal_id" uuid NOT NULL,
	"project_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" uuid NOT NULL,
	"channel" "audit_channel" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_edited_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposals_channel" CHECK ("proposals"."channel" in ('rest-api', 'mcp'))
);
--> statement-breakpoint
ALTER TABLE "proposal_changes" ADD CONSTRAINT "proposal_changes_group_id_proposal_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."proposal_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_changes" ADD CONSTRAINT "proposal_changes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_changes" ADD CONSTRAINT "proposal_changes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_groups" ADD CONSTRAINT "proposal_groups_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_projects" ADD CONSTRAINT "proposal_projects_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_projects" ADD CONSTRAINT "proposal_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_changes_position_key" ON "proposal_changes" USING btree ("group_id","position");--> statement-breakpoint
CREATE INDEX "proposal_changes_task_id_idx" ON "proposal_changes" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_groups_position_key" ON "proposal_groups" USING btree ("proposal_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_projects_key" ON "proposal_projects" USING btree ("proposal_id","project_id");--> statement-breakpoint
CREATE INDEX "proposal_projects_project_id_idx" ON "proposal_projects" USING btree ("project_id");