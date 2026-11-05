CREATE TYPE "public"."project_repository_state" AS ENUM('requested', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TABLE "project_repository_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"state" "project_repository_state" NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"withdrawn_by" uuid,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "project_repository_requests_decided" CHECK (("project_repository_requests"."state" = 'requested') = ("project_repository_requests"."decided_by" is null) and ("project_repository_requests"."decided_by" is null) = ("project_repository_requests"."decided_at" is null)),
	CONSTRAINT "project_repository_requests_withdrawn" CHECK (("project_repository_requests"."state" = 'withdrawn') = ("project_repository_requests"."withdrawn_by" is not null) and ("project_repository_requests"."withdrawn_by" is null) = ("project_repository_requests"."withdrawn_at" is null))
);
--> statement-breakpoint
ALTER TABLE "project_repository_requests" ADD CONSTRAINT "project_repository_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repository_requests" ADD CONSTRAINT "project_repository_requests_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repository_requests" ADD CONSTRAINT "project_repository_requests_requested_by_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repository_requests" ADD CONSTRAINT "project_repository_requests_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repository_requests" ADD CONSTRAINT "project_repository_requests_withdrawn_by_accounts_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_repository_requests_open_key" ON "project_repository_requests" USING btree ("project_id","repository_id") WHERE "project_repository_requests"."state" in ('requested', 'approved');--> statement-breakpoint
CREATE INDEX "project_repository_requests_repository_id_idx" ON "project_repository_requests" USING btree ("repository_id");