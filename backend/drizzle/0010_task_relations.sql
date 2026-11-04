CREATE TABLE "task_blocked_by" (
	"task_id" uuid NOT NULL,
	"blocker_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_blocked_by_not_self" CHECK ("task_blocked_by"."task_id" <> "task_blocked_by"."blocker_id")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "task_blocked_by" ADD CONSTRAINT "task_blocked_by_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_blocked_by" ADD CONSTRAINT "task_blocked_by_blocker_id_tasks_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_blocked_by_key" ON "task_blocked_by" USING btree ("task_id","blocker_id");--> statement-breakpoint
CREATE INDEX "task_blocked_by_blocker_id_idx" ON "task_blocked_by" USING btree ("blocker_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_tasks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_parent_id_idx" ON "tasks" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_not_own_parent" CHECK ("tasks"."parent_id" <> "tasks"."id");