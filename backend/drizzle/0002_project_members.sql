CREATE TYPE "public"."project_role" AS ENUM('read-only', 'contributor', 'read-write', 'admin');--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"role" "project_role" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_key" ON "project_members" USING btree ("project_id","account_id");--> statement-breakpoint
CREATE INDEX "project_members_account_id_idx" ON "project_members" USING btree ("account_id");