CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" bigint NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"registered_by" uuid NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository_admins" (
	"repository_id" uuid NOT NULL,
	"account_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_registered_by_accounts_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_admins" ADD CONSTRAINT "repository_admins_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_admins" ADD CONSTRAINT "repository_admins_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_github_id_key" ON "repositories" USING btree ("github_id");--> statement-breakpoint
CREATE INDEX "repositories_full_name_idx" ON "repositories" USING btree (lower("owner"),lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "repository_admins_key" ON "repository_admins" USING btree ("repository_id","account_id");--> statement-breakpoint
CREATE INDEX "repository_admins_account_id_idx" ON "repository_admins" USING btree ("account_id");