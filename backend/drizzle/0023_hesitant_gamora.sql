CREATE TYPE "public"."red_flag_kind" AS ENUM('overload', 'assignee-unavailable', 'fixed-date-milestone-pushed', 'cross-project-dependency');--> statement-breakpoint
CREATE TABLE "red_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "red_flag_kind" NOT NULL,
	"key" text NOT NULL,
	"detail" jsonb NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "red_flags" ADD CONSTRAINT "red_flags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "red_flags_project_id_key_key" ON "red_flags" USING btree ("project_id","key");