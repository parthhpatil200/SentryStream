# SentryStream: Real-Time Intelligent Fraud Detection Pipeline

SentryStream is an enterprise-grade, distributed polyglot streaming architecture built to process, classify, and visualize financial transactions for fraud in real-time. 

By leveraging a high-throughput event stream coupled with an optimized Machine Learning inference engine and real-time WebSockets, the system maintains a sub-20ms processing SLA while delivering full business compliance transparency via Explainable AI (SHAP).

## 🚀 System Architecture Overview

The system is designed as a decoupled, event-driven mesh of microservices to maximize throughput and isolate heavy numeric computations from I/O bottlenecks.

- **Transaction Simulator (Node.js)**: Emits high-dimensional transactional vectors (matching the real 30-feature Kaggle Credit Card Fraud dataset) into a partitioned Apache Kafka broker.
- **Message Broker (Apache Kafka)**: Acts as a durable, fault-tolerant event log, retaining transaction streams with strict ordering.
- **AI Scoring Engine (Python & XGBoost)**: Consumes streaming events under manual offset management. Scores vectors using a real-world trained XGBoost classifier and extracts the top 3 driving features using **TreeSHAP** for real-time explainability.
- **Data Storage Layer (PostgreSQL & Redis)**: Persists transactional ledgers idempotently (`ON CONFLICT DO NOTHING`) in Postgres, while flashing real-time event updates down a memory-cached Redis Pub/Sub channel.
- **Streaming Gateway (Node.js & Socket.IO)**: Subscribes to Redis alerts and instantly broadcasts low-latency updates down full-duplex WebSockets.
- **Live Operations Dashboard (React & Vite)**: Renders live summary metrics, a streaming transaction ledger, and a zero-dependency rolling dynamic SVG timeline charting transaction volume and real-time fraud velocity.

---

## 🛠️ Tech Stack & Dependencies

| Layer | Technologies Used |
| :--- | :--- |
| **Infrastructure** | Docker, Docker Desktop, WSL2 / Hyper-V |
| **Streaming & Queueing** | Apache Kafka (KafkaJS / kafka-python), Redis Pub/Sub |
| **Data Science & AI** | Python 3.13, XGBoost, SHAP (TreeExplainer), NumPy, Scikit-Learn |
| **Backend API Gateway** | Node.js, Express, Socket.IO, ioredis, pg (node-postgres) |
| **Frontend UI** | React, Vite, Core SVG Analytics, Tabler Icons |

---

## 💻 Local Setup & Installation Instructions

### Prerequisites
- **Docker Desktop** installed and running.
- **Node.js** (v18+ or v22+) installed locally.
- **Python** (3.11+) installed locally.
- *Note for Windows Users*: Ensure native local background PostgreSQL services are stopped if running on conflicting ports (`5432`/`5433`).

### 1. Clone and Initialize the Repository
```bash
git clone [https://github.com/YOUR_GITHUB_USERNAME/SentryStream.git](https://github.com/YOUR_GITHUB_USERNAME/SentryStream.git)
cd SentryStream

2. Install Dependencies
Install the root monorepo orchestrator, backend gateway, and frontend modules:

Bash
# Root directory installation (Installs 'concurrently')
npm install

# Backend installation
cd backend && npm install && cd ..

# Frontend installation
cd frontend && npm install && cd ..

# Python ML Worker installation
cd ml_worker
pip install numpy xgboost shap psycopg2 redis kafka-python scikit-learn
cd ..

3. Machine Learning Model Training
Ensure the creditcard.csv dataset from Kaggle is downloaded and dropped into ml_worker/data/. Run the evaluation benchmark pipeline to generate the production model artifact:

Bash
cd ml_worker
python model_experimentation.py
cd ..

🏃‍♂️ Running the Pipeline (Single-Command Launch)
The project includes a root-level script orchestrator to wipe conflicting background OS databases, boot Docker containers, and spin up the frontend, backend, and machine learning components simultaneously.

Open your terminal as an Administrator (required for Windows service management) and run:

Bash
npm run dev
🔄 Starting the Live Simulation Loop
Once the React frontend dashboard lights up at http://localhost:5173/ showing Live stream active, open a secondary terminal tab and kick off the synthetic bank traffic generator:

Bash
cd backend
node producer.js
Watch the live charts and transaction logs dynamically stream across your browser view!

🛑 Infrastructure & Operational Runbook (Troubleshooting)
Local Windows Port 5433 Authentication Collisions
If node server.js or consumer.py throws a password authentication failed for user "sentrystream" error, a native Windows background PostgreSQL service is intercepting the routing.

The root npm run dev script automatically executes a PowerShell command to safely suspend conflicting background tasks.

To verify the Docker container is isolating connections perfectly, bypass the host network by executing a test query directly inside the virtual node engine:

Bash
docker compose exec postgres psql -U sentrystream -d sentrystream_db -c "SELECT 1;"

Resetting Infrastructure Storage Cleanly
To flush cached states, re-trigger the database configuration schema scripts (init.sql), and rebuild streaming queues from scratch:

Bash
docker compose down --volumes --remove-orphans
docker compose up -d --force-recreate

