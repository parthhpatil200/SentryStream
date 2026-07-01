const path = require('path'); // Imported first so it can be used below
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Updated debug keys to match the exact environment variables your script looks for
console.log("--- DATABASE DEBUG INFO ---");
console.log("SENTRYSTREAM_PGHOST:", process.env.SENTRYSTREAM_PGHOST);
console.log("SENTRYSTREAM_PGPORT:", process.env.SENTRYSTREAM_PGPORT);
console.log("SENTRYSTREAM_PGUSER:", process.env.SENTRYSTREAM_PGUSER);
console.log("SENTRYSTREAM_PGPASSWORD:", process.env.SENTRYSTREAM_PGPASSWORD);
console.log("---------------------------");

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Redis = require('ioredis');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

    if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
    }

    next();
});

const redis = new Redis({
    host: process.env.SENTRYSTREAM_REDIS_HOST || '127.0.0.1',
    port: Number(process.env.SENTRYSTREAM_REDIS_PORT || 6379),
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 100, 3000),
});

const pool = new Pool({
    host: process.env.SENTRYSTREAM_PGHOST || '127.0.0.1',
    port: Number(process.env.SENTRYSTREAM_PGPORT || 5433),
    database: process.env.SENTRYSTREAM_PGDATABASE || 'sentrystream_db',
    user: process.env.SENTRYSTREAM_PGUSER || 'sentrystream',
    password: process.env.SENTRYSTREAM_PGPASSWORD || 'SentryStreamPass123',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

io.on('connection', (socket) => {
    console.log(`Socket client connected: ${socket.id}`);

    socket.on('disconnect', () => {
        console.log(`Socket client disconnected: ${socket.id}`);
    });
});

app.get('/api/history', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                t.transaction_id,
                t.card_id,
                t.amount,
                t.merchant,
                t.timestamp,
                t.location,
                d.is_fraud,
                d.prediction_confidence,
                d.processed_at
            FROM transactions AS t
            INNER JOIN fraud_decisions AS d
                ON t.transaction_id = d.transaction_id
            ORDER BY t.timestamp DESC
            LIMIT 50
        `);

        res.json(rows);
    } catch (error) {
        console.error('History lookup failed:', error.message);
        res.status(500).json({ error: 'Unable to load transaction history' });
    }
});

const shutdown = async () => {
    console.log('Shutting down gateway...');

    try {
        await redis.quit();
    } catch (error) {
        console.error('Redis shutdown failed:', error.message);
    }

    try {
        await pool.end();
    } catch (error) {
        console.error('PostgreSQL shutdown failed:', error.message);
    }

    server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

(async () => {
    try {
        await redis.connect();
        await redis.subscribe('transaction-alerts');

        redis.on('message', (channel, message) => {
            if (channel !== 'transaction-alerts') {
                return;
            }

            try {
                const payload = JSON.parse(message);
                io.emit('new_alert', payload);
            } catch (error) {
                console.error('Failed to parse Redis alert payload:', error.message);
            }
        });

        await pool.query('SELECT 1');

        server.listen(5000, '0.0.0.0', () => {
            console.log('Streaming gateway healthy and connected to Redis on port 5000');
        });
    } catch (error) {
        console.error('Failed to start streaming gateway:', error.message);
        process.exit(1);
    }
})();