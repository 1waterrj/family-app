ALTER TABLE "ledger_transactions" DROP CONSTRAINT "ledger_transactions_amount_cents_nonzero";--> statement-breakpoint
ALTER TABLE "ledger_transactions" DROP CONSTRAINT "ledger_transactions_type_amount_sign";--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_amount_cents_nonzero_except_chore_credit" CHECK ("ledger_transactions"."amount_cents" <> 0 OR "ledger_transactions"."type" = 'CHORE_CREDIT') NOT VALID;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_type_amount_sign" CHECK ((
        ("ledger_transactions"."type" = 'CHORE_CREDIT' AND "ledger_transactions"."amount_cents" >= 0)
        OR ("ledger_transactions"."type" = 'PURCHASE' AND "ledger_transactions"."amount_cents" < 0)
        OR ("ledger_transactions"."type" = 'MANUAL_CREDIT' AND "ledger_transactions"."amount_cents" > 0)
        OR "ledger_transactions"."type" = 'CORRECTION'
      )) NOT VALID;
