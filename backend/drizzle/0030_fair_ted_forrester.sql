CREATE TYPE "public"."issue_seen_state" AS ENUM('open', 'closed', 'not-planned', 'deleted');--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "actor_account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "actor_github_login" text;--> statement-breakpoint
ALTER TABLE "task_issues" ADD COLUMN "seen_state" "issue_seen_state" DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_issues" ADD COLUMN "seen_status" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_one_actor" CHECK (num_nonnulls("audit_log"."actor_account_id", "audit_log"."actor_github_login") = 1);