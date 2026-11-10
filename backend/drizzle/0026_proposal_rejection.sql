ALTER TABLE "proposals" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "rejected_by" uuid;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_rejected_by_accounts_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_rejection" CHECK (("proposals"."rejected_at" is null) = ("proposals"."rejected_by" is null));