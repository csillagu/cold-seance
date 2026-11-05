CREATE TABLE "repository_receiving_projects" (
	"repository_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repository_receiving_projects" ADD CONSTRAINT "repository_receiving_projects_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_receiving_projects" ADD CONSTRAINT "repository_receiving_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repository_receiving_projects_project_id_idx" ON "repository_receiving_projects" USING btree ("project_id");