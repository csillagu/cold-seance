CREATE TABLE "recheck_runs" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recheck_runs_one_row" CHECK ("recheck_runs"."id" = 1)
);
