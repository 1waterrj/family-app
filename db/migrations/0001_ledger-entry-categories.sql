ALTER TYPE "public"."ledger_transaction_type" RENAME VALUE 'MANUAL_DEBIT' TO 'CORRECTION';--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_type_amount_sign" CHECK ((
        ("ledger_transactions"."type" = 'CHORE_CREDIT' AND "ledger_transactions"."amount_cents" > 0)
        OR ("ledger_transactions"."type" = 'PURCHASE' AND "ledger_transactions"."amount_cents" < 0)
        OR ("ledger_transactions"."type" = 'MANUAL_CREDIT' AND "ledger_transactions"."amount_cents" > 0)
        OR "ledger_transactions"."type" = 'CORRECTION'
      )) NOT VALID;
