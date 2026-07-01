"""Train a small mock XGBoost fraud model and persist it to disk.

The resulting file, ``fraud_model.json``, is intended as a local placeholder
model artifact for the ML worker.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from xgboost import XGBClassifier


def build_dataset(sample_count: int = 2000, random_seed: int = 42):
	"""Generate a simple synthetic fraud dataset with five tabular features."""

	rng = np.random.default_rng(random_seed)

	transaction_amount = rng.uniform(1.0, 10000.0, sample_count)
	user_age = rng.integers(18, 90, sample_count)
	velocity_last_2min = rng.poisson(1.2, sample_count)
	international_transaction = rng.integers(0, 2, sample_count)
	card_present = rng.integers(0, 2, sample_count)

	features = np.column_stack(
		[
			transaction_amount,
			user_age,
			velocity_last_2min,
			international_transaction,
			card_present,
		]
	)

	fraud_score = (
		(transaction_amount > 8500).astype(int)
		+ (velocity_last_2min >= 3).astype(int)
		+ international_transaction.astype(int)
		+ (card_present == 0).astype(int)
	)
	labels = (fraud_score >= 2).astype(int)

	noise_mask = rng.random(sample_count) < 0.08
	labels = np.where(noise_mask, 1 - labels, labels)

	return features, labels


def train_and_save_model() -> Path:
	"""Train the model and save it as fraud_model.json in this directory."""

	features, labels = build_dataset()

	model = XGBClassifier(
		n_estimators=75,
		max_depth=4,
		learning_rate=0.12,
		subsample=0.9,
		colsample_bytree=0.9,
		objective="binary:logistic",
		eval_metric="logloss",
		random_state=42,
		n_jobs=1,
	)
	model.fit(features, labels)

	model_path = Path(__file__).with_name("fraud_model.json")
	model.save_model(model_path)
	return model_path


def main() -> None:
	model_path = train_and_save_model()
	print(f"Saved mock fraud model to {model_path}")


if __name__ == "__main__":
	main()
