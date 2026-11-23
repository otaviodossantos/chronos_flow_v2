import { recomputeAll } from '../modules/nodes/cascade.service.js';
import { prisma } from '../db/client.js';

// Uma conta por vez: cada uma tem a propria arvore.
const contas = await prisma.user.findMany({ select: { id: true } });
let nos = 0;
let metas = 0;
for (const { id } of contas) {
  const result = await recomputeAll(id);
  nos += result.nodes;
  metas += result.roots;
}
console.log(`Recomputado: ${nos} nos em ${metas} meta(s) macro, ${contas.length} conta(s).`);
await prisma.$disconnect();
