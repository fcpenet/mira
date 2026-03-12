import Redis from 'ioredis';
import config from '../config';

// Two separate clients are required:
// - publisher: used by the event ingest route to publish events
// - subscriber: used by the socket.io Redis adapter (must not share with publisher)
const publisher  = new Redis(config.redis);
const subscriber = new Redis(config.redis);

publisher.on('error',  (err: Error) => console.error('[redis:pub] error:', err.message));
subscriber.on('error', (err: Error) => console.error('[redis:sub] error:', err.message));

const CHANNEL = 'mira:events';

export { publisher, subscriber, CHANNEL };
