CREATE TABLE "group_projects" (
	"group_id" uuid NOT NULL,
	"project_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_projects" ADD CONSTRAINT "group_projects_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_projects" ADD CONSTRAINT "group_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_projects_key" ON "group_projects" USING btree ("group_id","project_id");--> statement-breakpoint
CREATE INDEX "group_projects_project_id_idx" ON "group_projects" USING btree ("project_id");