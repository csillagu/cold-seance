CREATE TYPE "public"."notification_kind" AS ENUM('red-flag', 'proposal-waiting', 'repository-request', 'token-refused');--> statement-breakpoint
CREATE TABLE "issue_subscriptions" (
	"account_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"detail" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_subscriptions" (
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_subscriptions" ADD CONSTRAINT "issue_subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_subscriptions" ADD CONSTRAINT "issue_subscriptions_task_id_task_issues_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task_issues"("task_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_subscriptions" ADD CONSTRAINT "project_subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_subscriptions" ADD CONSTRAINT "project_subscriptions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_subscriptions_key" ON "issue_subscriptions" USING btree ("account_id","task_id");--> statement-breakpoint
CREATE INDEX "issue_subscriptions_task_id_idx" ON "issue_subscriptions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "notifications_account_id_idx" ON "notifications" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_subscriptions_key" ON "project_subscriptions" USING btree ("account_id","project_id");--> statement-breakpoint
CREATE INDEX "project_subscriptions_project_id_idx" ON "project_subscriptions" USING btree ("project_id");