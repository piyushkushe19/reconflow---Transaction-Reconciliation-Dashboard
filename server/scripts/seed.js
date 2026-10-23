import 'dotenv/config'; import { seedStore } from '../src/app.js'; import { memoryStore, mongoStore } from '../src/store.js';
const s = process.env.MONGODB_URI ? await mongoStore(process.env.MONGODB_URI) : memoryStore();
console.log('Reseeded (clears runs/exceptions first, so no duplicates):', await seedStore(s, Number(process.argv[2] || 42))); process.exit(0);
