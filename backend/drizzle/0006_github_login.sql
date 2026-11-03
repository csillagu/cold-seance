ALTER TABLE "accounts" ADD COLUMN "github_login" text;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_github_login_key" ON "accounts" USING btree (lower("github_login"));