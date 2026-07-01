from __future__ import annotations

import json
import pickle
import time
import warnings
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.metrics import average_precision_score, f1_score, precision_score, recall_score
from sklearn.model_selection import train_test_split
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier

warnings.filterwarnings("ignore")

ROOT_DIR = Path(__file__).resolve().parent
DATA_PATH = ROOT_DIR / "data" / "creditcard.csv"
OUTPUT_MODEL_PATH = ROOT_DIR / "fraud_model.json"


def load_dataset(path: Path) -> Tuple[pd.DataFrame, pd.Series]:
	"""Load the credit card dataset and split features from the target."""
	df = pd.read_csv(path)
	features = ["Time", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V10", "V11", "V12", "V13", "V14", "V15", "V16", "V17", "V18", "V19", "V20", "V21", "V22", "V23", "V24", "V25", "V26", "V27", "V28", "Amount"]
	X = df[features]
	y = df["Class"]
	return X, y


def prepare_features(X: pd.DataFrame, y: pd.Series) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, StandardScaler]:
	"""Stratified split and scale time/amount features."""
	X_train, X_test, y_train, y_test = train_test_split(
		X,
		y,
		test_size=0.2,
		stratify=y,
		random_state=42,
	)

	scaler = StandardScaler()
	train_scaled = X_train.copy()
	test_scaled = X_test.copy()
	train_scaled[["Time", "Amount"]] = scaler.fit_transform(train_scaled[["Time", "Amount"]])
	test_scaled[["Time", "Amount"]] = scaler.transform(test_scaled[["Time", "Amount"]])

	return (
		train_scaled.to_numpy(dtype=np.float32),
		test_scaled.to_numpy(dtype=np.float32),
		y_train.to_numpy(dtype=np.int32),
		y_test.to_numpy(dtype=np.int32),
		scaler,
	)


def evaluate_model(name: str, model, X_test: np.ndarray, y_test: np.ndarray) -> Dict[str, object]:
	"""Evaluate a trained classifier and collect key metrics."""
	start = time.perf_counter()
	if hasattr(model, "predict_proba"):
		probabilities = model.predict_proba(X_test)[:, 1]
		predictions = (probabilities >= 0.5).astype(int)
	elif hasattr(model, "decision_function"):
		probabilities = -model.decision_function(X_test)
		predictions = (probabilities >= 0.0).astype(int)
	elif hasattr(model, "score_samples"):
		probabilities = -model.score_samples(X_test)
		predictions = (probabilities >= 0.0).astype(int)
	else:
		probabilities = model.predict(X_test)
		predictions = (probabilities == -1).astype(int)

	latency_ms = (time.perf_counter() - start) * 1000.0

	metrics = {
		"precision": precision_score(y_test, predictions, zero_division=0),
		"recall": recall_score(y_test, predictions, zero_division=0),
		"f1": f1_score(y_test, predictions, zero_division=0),
		"pr_auc": average_precision_score(y_test, probabilities),
		"latency_ms": latency_ms,
	}

	print(f"\n{name}")
	print("-" * len(name))
	print(f"Precision: {metrics['precision']:.4f}")
	print(f"Recall: {metrics['recall']:.4f}")
	print(f"F1-Score: {metrics['f1']:.4f}")
	print(f"PR-AUC: {metrics['pr_auc']:.4f}")
	print(f"Latency (predict on test set): {metrics['latency_ms']:.2f} ms")
	return metrics


def train_models(X_train: np.ndarray, X_test: np.ndarray, y_train: np.ndarray, y_test: np.ndarray) -> List[Dict[str, object]]:
	"""Train the three requested fraud detection models."""
	results: List[Dict[str, object]] = []

	xgb_model = XGBClassifier(
		n_estimators=200,
		max_depth=4,
		learning_rate=0.1,
		subsample=0.9,
		colsample_bytree=0.8,
		scale_pos_weight=max(1.0, (y_train == 0).sum() / max((y_train == 1).sum(), 1)),
		random_state=42,
		eval_metric="aucpr",
		objective="binary:logistic",
	)
	xgb_model.fit(X_train, y_train)
	results.append({"name": "XGBoost", "model": xgb_model, **evaluate_model("XGBoost", xgb_model, X_test, y_test)})

	isolation_model = IsolationForest(
		contamination=0.0017,
		n_estimators=300,
		random_state=42,
	)
	isolation_model.fit(X_train)
	results.append({"name": "IsolationForest", "model": isolation_model, **evaluate_model("IsolationForest", isolation_model, X_test, y_test)})

	mlp_model = MLPClassifier(
		hidden_layer_sizes=(64, 32, 16),
		activation="relu",
		solver="adam",
		max_iter=200,
		random_state=42,
	)
	mlp_model.fit(X_train, y_train)
	results.append({"name": "MLPClassifier", "model": mlp_model, **evaluate_model("MLPClassifier", mlp_model, X_test, y_test)})

	return results


def save_best_model(results: List[Dict[str, object]], output_path: Path) -> None:
	"""Persist the selected model to disk using the best PR-AUC and lower latency as a tie-breaker."""
	best_result = max(
		results,
		key=lambda item: (item["pr_auc"], -item["latency_ms"]),
	)
	best_model = best_result["model"]

	if hasattr(best_model, "save_model"):
		best_model.save_model(str(output_path))
		print(f"\nSaved best model ({best_result['name']}) to {output_path}")
		return

	with output_path.open("wb") as handle:
		pickle.dump(best_model, handle)
	print(f"\nSaved best model ({best_result['name']}) to {output_path}")


def main() -> None:
	print("Loading credit card fraud dataset...")
	X, y = load_dataset(DATA_PATH)

	print("Splitting data and scaling Time/Amount features...")
	X_train, X_test, y_train, y_test, _ = prepare_features(X, y)

	print("Training candidate models...")
	results = train_models(X_train, X_test, y_train, y_test)

	print("\nComparison Matrix")
	print("-" * 80)
	print(f"{'Model':<18} {'Precision':<10} {'Recall':<10} {'F1':<10} {'PR-AUC':<10} {'Latency (ms)':<13}")
	for result in results:
		print(
			f"{result['name']:<18} "
			f"{result['precision']:<10.4f} "
			f"{result['recall']:<10.4f} "
			f"{result['f1']:<10.4f} "
			f"{result['pr_auc']:<10.4f} "
			f"{result['latency_ms']:<13.2f}"
		)

	save_best_model(results, OUTPUT_MODEL_PATH)


if __name__ == "__main__":
	main()
