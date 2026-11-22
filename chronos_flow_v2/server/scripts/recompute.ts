import { currentUserId } from '../lib/currentUser.js';
import { recomputeAll } from '../modules/nodes/cascade.service.js';
import { prisma } from '../db/client.js';

const userId = await currentUserId();
const result = await recomputeAll(userId);
console.log(`Recomputado: ${result.nodes} nos em ${result.roots} meta(s) macro.`);
await prisma.$disconnect();
