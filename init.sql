CREATE TABLE IF NOT EXISTS transactions (
	transaction_id UUID PRIMARY KEY,
	card_id VARCHAR(64) NOT NULL,
	amount NUMERIC(18, 2) NOT NULL,
	merchant VARCHAR(255) NOT NULL,
	timestamp TIMESTAMPTZ NOT NULL,
	location VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_transactions_card_id
	ON transactions (card_id);

CREATE INDEX IF NOT EXISTS idx_transactions_timestamp
	ON transactions (timestamp DESC);

CREATE TABLE IF NOT EXISTS fraud_decisions (
	decision_id SERIAL PRIMARY KEY,
	transaction_id UUID NOT NULL UNIQUE,
	is_fraud BOOLEAN NOT NULL,
	prediction_confidence FLOAT,
	shap_explanation JSONB,
	processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	CONSTRAINT fk_fraud_decisions_transaction
		FOREIGN KEY (transaction_id)
		REFERENCES transactions (transaction_id)
		ON DELETE CASCADE
);
