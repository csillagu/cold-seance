CREATE TYPE "public"."saved_view_kind" AS ENUM('kanban', 'gantt');--> statement-breakpoint
CREATE TABLE "saved_view_projects" (
	"view_id" uuid NOT NULL,
	"project_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "saved_view_kind" NOT NULL,
	"project_id" uuid,
	"group_id" uuid,
	"owner_id" uuid,
	"filter" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_views_one_place" CHECK (num_nonnulls("saved_views"."project_id", "saved_views"."group_id", "saved_views"."owner_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "saved_view_projects" ADD CONSTRAINT "saved_view_projects_view_id_saved_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."saved_views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view_projects" ADD CONSTRAINT "saved_view_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_view_projects_key" ON "saved_view_projects" USING btree ("view_id","project_id");--> statement-breakpoint
CREATE INDEX "saved_view_projects_project_id_idx" ON "saved_view_projects" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "saved_views_project_id_idx" ON "saved_views" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "saved_views_group_id_idx" ON "saved_views" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "saved_views_owner_id_idx" ON "saved_views" USING btree ("owner_id");