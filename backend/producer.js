const { Kafka } = require('kafkajs');
const { v4: uuidv4 } = require('uuid');

const BROKER = 'localhost:9094';
const CLIENT_ID = 'sentrystream-producer';
const TOPIC = 'raw-transactions';
const ANOMALY_RATE = 0.02;

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
	const amount = isAnomalous
		? Number(randomFloat(9500.01, 10000.0).toFixed(2))
		: Number(randomFloat(1.0, 10000.0).toFixed(2));

	const transaction = {
		transaction_id: uuidv4(),
		card_id: buildCardId(),
		timestamp: new Date().toISOString(),
		Time: 0,
		Amount: amount,
		merchant: MERCHANTS[randomInt(0, MERCHANTS.length - 1)],
		location: LOCATIONS[randomInt(0, LOCATIONS.length - 1)],
	};

	for (let index = 1; index <= 28; index += 1) {
		const standardDeviation = isAnomalous ? 3.5 : 1.0;
		let value = randomNormal(0, standardDeviation);

		if (isAnomalous && Math.random() < 0.2) {
			value += Math.random() > 0.5 ? 6 : -6;
		}

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
	retry: {
		retries: 10,
	},
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
		console.log(
			`Delivered transaction_id=${transaction.transaction_id} partition=${record.partition} offset=${record.baseOffset}`,
		);
	}
}

async function runLoop() {
	while (!shuttingDown) {
		const transaction = buildTransaction();

		try {
			await sendTransaction(transaction);
		} catch (error) {
			console.error(
				`Failed to publish transaction_id=${transaction.transaction_id}:`,
				error.message,
			);
		}

		const delay = transaction.is_anomalous && Math.random() < 0.5
			? randomInt(500, 900)
			: randomInt(500, 2000);

		await sleep(delay);
	}
}

async function main() {
	await producer.connect();
	console.log(`Kafka producer connected to ${BROKER} as ${CLIENT_ID}`);

	const shutdown = async () => {
		if (shuttingDown) {
			return;
		}

		shuttingDown = true;
		console.log('Shutting down producer...');

		try {
			await producer.disconnect();
		} catch (error) {
			console.error('Producer disconnect failed:', error.message);
		}

		process.exit(0);
	};

	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);

	await runLoop();
}

main().catch(async (error) => {
	console.error('Fatal producer error:', error);

	try {
		await producer.disconnect();
	} catch (disconnectError) {
		console.error('Cleanup disconnect failed:', disconnectError.message);
	}

	process.exit(1);
});
