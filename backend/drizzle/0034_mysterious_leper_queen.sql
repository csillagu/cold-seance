CREATE TABLE "proposal_approvals" (
	"proposal_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"approved_by" uuid NOT NULL,
	"channel" "audit_channel" NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"proposal_edited_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposal_approvals" ADD CONSTRAINT "proposal_approvals_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_approvals" ADD CONSTRAINT "proposal_approvals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_approvals" ADD CONSTRAINT "proposal_approvals_approved_by_accounts_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_approvals_key" ON "proposal_approvals" USING btree ("proposal_id","project_id");--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_rejected_or_applied" CHECK ("proposals"."rejected_at" is null or "proposals"."applied_at" is null);