import mongoose from 'mongoose';
// Two adapters, one interface. Memory is the documented dev fallback; Mongo is used when MONGODB_URI is set.
const COLL = ['merchant', 'bank', 'runs', 'matches', 'exceptions', 'audit', 'settings'];
export function memoryStore() {
  const d = Object.fromEntries(COLL.map((c) => [c, []]));
  return { kind: 'memory', all: async (c) => d[c].map((x) => ({ ...x })), insert: async (c, docs) => { d[c].push(...docs.map((x) => ({ ...x }))); },
    update: async (c, key, val, patch) => { const r = d[c].find((x) => x[key] === val); if (r) Object.assign(r, patch); return r ? { ...r } : null; },
    clear: async (c) => { d[c].length = 0; } };
}
export async function mongoStore(uri) {
  await mongoose.connect(uri);
  const M = Object.fromEntries(COLL.map((c) => [c, mongoose.model(c, new mongoose.Schema({}, { strict: false, timestamps: true }))]));
  return { kind: 'mongo', all: async (c) => M[c].find().select('-_id -__v').lean(), insert: async (c, docs) => { await M[c].insertMany(docs); },
    update: async (c, key, val, patch) => M[c].findOneAndUpdate({ [key]: val }, { $set: patch }, { new: true }).select('-_id -__v').lean(),
    clear: async (c) => { await M[c].deleteMany({}); } };
}
