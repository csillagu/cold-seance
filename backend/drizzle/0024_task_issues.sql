CREATE TABLE "task_issues" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"repository_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"github_id" bigint NOT NULL,
	"milestone_number" integer
);
--> statement-breakpoint
ALTER TABLE "task_issues" ADD CONSTRAINT "task_issues_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_issues" ADD CONSTRAINT "task_issues_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_issues_repository_number_key" ON "task_issues" USING btree ("repository_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "task_issues_github_id_key" ON "task_issues" USING btree ("github_id");