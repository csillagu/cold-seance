CREATE TYPE "public"."weekday" AS ENUM('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday');--> statement-breakpoint
CREATE TABLE "absences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "absences_end_not_before_start" CHECK ("absences"."ends_on" >= "absences"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "company_holidays" (
	"date" date PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_calendar" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"weekend_days" "weekday"[] NOT NULL,
	CONSTRAINT "global_calendar_one_row" CHECK ("global_calendar"."id")
);
--> statement-breakpoint
CREATE TABLE "personal_holidays" (
	"account_id" uuid NOT NULL,
	"date" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "capacity" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_holidays" ADD CONSTRAINT "personal_holidays_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absences_account_id_idx" ON "absences" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_holidays_key" ON "personal_holidays" USING btree ("account_id","date");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_capacity_percentage" CHECK ("accounts"."capacity" between 0 and 100);