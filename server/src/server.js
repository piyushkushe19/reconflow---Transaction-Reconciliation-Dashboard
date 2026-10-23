import 'dotenv/config'; import { createApp, seedStore } from './app.js'; import { memoryStore, mongoStore } from './store.js';
const store = process.env.MONGODB_URI ? await mongoStore(process.env.MONGODB_URI) : memoryStore();
if (!(await store.all('merchant')).length) console.log('Seeded', await seedStore(store, Number(process.env.SEED || 42)));
createApp(store, { corsOrigin: process.env.CORS_ORIGIN || '*' }).listen(process.env.PORT || 4000, () => console.log(`ReconFlow API on :${process.env.PORT || 4000} (${store.kind} store)`));
