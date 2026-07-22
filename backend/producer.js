const { Kafka } = require('kafkajs');
const { v4: uuidv4 } = require('uuid');

const BROKER = process.env.SENTRYSTREAM_KAFKA_BROKER || "localhost:9094";
const CLIENT_ID = 'sentrystream-producer';
const TOPIC = 'raw-transactions';
const ANOMALY_RATE = 0.08; // Arrives regularly every ~12-15 transactions

const MERCHANTS = [
    'Northwind Market',
    'Apex Electronics',
    'Bluefin Travel',
    'Metro Fuel',
    'Lumen Grocers',
    'Orbit Books',
    'Vertex Pharmacy',
    'Summit Apparel',
];

const LOCATIONS = [
    'New York, US',
    'London, UK',
    'Berlin, DE',
    'Toronto, CA',
    'Sydney, AU',
    'Tokyo, JP',
    'Paris, FR',
    'Singapore, SG',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const randomFloat = (min, max) => Math.random() * (max - min) + min;

const randomInt = (min, max) => Math.floor(randomFloat(min, max + 1));

const randomNormal = (mean = 0, stdDev = 1) => {
    const u1 = Math.max(Number.EPSILON, Math.random());
    const u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z0 * stdDev + mean;
};

const buildCardId = () => `card_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

let timeCounter = 0;

const buildTransaction = () => {
    const isAnomalous = Math.random() < ANOMALY_RATE;
    
    // Set a moderate unscaled amount range to prevent clipping tree thresholds
    const amount = isAnomalous
        ? Number(randomFloat(2500.00, 4500.00).toFixed(2))
        : Number(randomFloat(10.00, 250.00).toFixed(2));

    const transaction = {
        transaction_id: uuidv4(),
        card_id: buildCardId(),
        timestamp: new Date().toISOString(),
        Time: timeCounter,
        Amount: amount,
        merchant: MERCHANTS[randomInt(0, MERCHANTS.length - 1)],
        location: LOCATIONS[randomInt(0, LOCATIONS.length - 1)],
    };

    for (let index = 1; index <= 28; index += 1) {
        let mean = 0;
        let standardDeviation = 0.8;

        if (isAnomalous) {
            standardDeviation = 1.5;
            
            // CRITICAL PATTERN MATCHING: Hammer the exact mathematical boundaries of real dataset fraud
            if (index === 14) {
                mean = -16.0; // V14 is the single highest driver for fraud classification
            } else if (index === 17) {
                mean = -14.0; // V17 marks massive negative variance in fraud vectors
            } else if (index === 12) {
                mean = -12.0; // V12 splits show heavy negative drift
            } else if (index === 10) {
                mean = -10.0; // V10 represents strong structural outliers
            } else if (index === 4) {
                mean = 8.0;   // V4 typically climbs aggressively during chargebacks
            }
        }

        let value = randomNormal(mean, standardDeviation);
        transaction[`V${index}`] = Number(value.toFixed(6));
    }

    timeCounter += 1;
    return transaction;
};

const kafka = new Kafka({
    clientId: CLIENT_ID,
    brokers: [BROKER],
});

const producer = kafka.producer({
    allowAutoTopicCreation: true,
    idempotent: true,
    maxInFlightRequests: 1,
    retry: { retries: 10 },
});

let shuttingDown = false;

async function sendTransaction(transaction) {
    const delivery = await producer.send({
        topic: TOPIC,
        messages: [
            {
                key: transaction.card_id,
                value: JSON.stringify(transaction),
            },
        ],
    });

    for (const record of delivery) {
        console.log(`Delivered transaction_id=${transaction.transaction_id} partition=${record.partition} offset=${record.baseOffset}`);
    }
}

async function runLoop() {
    while (!shuttingDown) {
        const transaction = buildTransaction();
        try {
            await sendTransaction(transaction);
        } catch (error) {
            console.error(`Failed to publish transaction_id=${transaction.transaction_id}:`, error.message);
        }
        await sleep(randomInt(1000, 2500));
    }
}

async function main() {
    await producer.connect();
    console.log(`Kafka producer connected to ${BROKER}`);
    
    const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        try { await producer.disconnect(); } catch (e) {}
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    await runLoop();
}

main().catch(async (error) => {
    process.exit(1);
});