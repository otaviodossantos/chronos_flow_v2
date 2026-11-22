import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SPACES = [
  { name: 'Plataforma v2.0', color: '#10B981' },
  { name: 'Infraestrutura Core', color: '#F59E0B' },
  { name: 'Design Tokens 2026', color: '#6366F1' },
];

const MEMBERS = [
  { name: 'Lucas Mendes', role: 'Frontend Eng', capacity_hours_week: 40, color: '#6366F1', training_level: 'AUTONOMOUS' as const },
  { name: 'Carlos Dias', role: 'Backend Specialist', capacity_hours_week: 40, color: '#EF4444', training_level: 'AUTONOMOUS' as const },
  { name: 'Marina Souza', role: 'Product Design', capacity_hours_week: 32, color: '#F59E0B', training_level: 'IN_TRAINING' as const },
  { name: 'Thiago Barros', role: 'SRE', capacity_hours_week: 40, color: '#10B981', training_level: 'AUTONOMOUS' as const },
];

const GOALS = [
  { title: 'Plataforma Web v2.0', space: 0, importance: 5, dueInDays: 75 },
  { title: 'App Mobile Modo Foco', space: 0, importance: 4, dueInDays: 120 },
  { title: 'Migracao Postgres e Cache', space: 1, importance: 4, dueInDays: 55 },
  { title: 'Design System e Tokens v1', space: 2, importance: 3, dueInDays: 40 },
];

const LEVEL1 = ['Engine de Timeline', 'Camada de Dados', 'Experiencia de Uso', 'Observabilidade'];
const LEVEL2 = ['Modelagem', 'Implementacao', 'Testes'];
const VERBS = ['Definir', 'Implementar', 'Revisar', 'Otimizar', 'Documentar', 'Validar', 'Refatorar'];
const OBJECTS = [
  'contrato de API', 'curvas de Bezier', 'indice de path', 'query recursiva',
  'estado de zoom', 'camada SVG', 'cache de arvore', 'fila de foco',
  'peso ponderado', 'previa de arraste', 'mapa de risco', 'grade de semanas',
];

const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(arr: T[]): T => arr[rand(arr.length)];
const daysFromNow = (d: number) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + d);
  return date;
};

async function main() {
  console.log('Limpando base...');
  await prisma.nodeActivity.deleteMany();
  await prisma.progressSnapshot.deleteMany();
  await prisma.nodeDependency.deleteMany();
  await prisma.node.deleteMany();
  await prisma.spaceMember.deleteMany();
  await prisma.member.deleteMany();
  await prisma.space.deleteMany();
  await prisma.user.deleteMany();

  const user = await prisma.user.create({
    data: {
      name: 'Henrique',
      birth_date: new Date('1990-03-15T00:00:00.000Z'),
      life_expectancy: 80,
      daily_focus_goal_minutes: 240,
      daily_impact_goal: 1.5,
    },
  });

  const spaces = [];
  for (const [i, s] of SPACES.entries()) {
    spaces.push(await prisma.space.create({ data: { ...s, user_id: user.id, position: i } }));
  }

  const members = [];
  for (const m of MEMBERS) {
    const member = await prisma.member.create({ data: { ...m, user_id: user.id } });
    await prisma.spaceMember.create({
      data: { member_id: member.id, space_id: pick(spaces).id },
    });
    members.push(member);
  }

  console.log('Gerando arvore...');
  const rows: any[] = [];
  const leafIds: string[] = [];

  const makeNode = (opts: {
    parent: any | null;
    title: string;
    spaceId: string;
    importance: number;
    position: number;
    due: Date | null;
    start: Date | null;
    estimate: number | null;
    assignee: string | null;
  }) => {
    const id = randomUUID();
    const path = opts.parent ? `${opts.parent.path}/${id}` : id;
    const node = {
      id,
      user_id: user.id,
      space_id: opts.spaceId,
      parent_id: opts.parent?.id ?? null,
      path,
      depth: opts.parent ? opts.parent.depth + 1 : 0,
      position: opts.position,
      title: opts.title,
      status: 'PENDING' as const,
      weight: opts.estimate ?? 1,
      progress: 0,
      leaf_count: 1,
      importance: opts.importance,
      start_date: opts.start,
      due_date: opts.due,
      estimated_minutes: opts.estimate,
      assignee_id: opts.assignee,
    };
    rows.push(node);
    return node;
  };

  for (const [gi, goal] of GOALS.entries()) {
    const space = spaces[goal.space];
    const root = makeNode({
      parent: null,
      title: goal.title,
      spaceId: space.id,
      importance: goal.importance,
      position: gi,
      start: daysFromNow(-30),
      due: daysFromNow(goal.dueInDays),
      estimate: null,
      assignee: members[gi % members.length].id,
    });

    for (const [l1i, l1] of LEVEL1.entries()) {
      const n1 = makeNode({
        parent: root,
        title: `${l1} — ${goal.title.split(' ')[0]}`,
        spaceId: space.id,
        importance: goal.importance,
        position: l1i,
        start: daysFromNow(-20 + l1i * 5),
        due: daysFromNow(Math.round(goal.dueInDays * (0.4 + l1i * 0.15))),
        estimate: null,
        assignee: pick(members).id,
      });

      for (const [l2i, l2] of LEVEL2.entries()) {
        const n2 = makeNode({
          parent: n1,
          title: `${l2} de ${l1.toLowerCase()}`,
          spaceId: space.id,
          importance: goal.importance,
          position: l2i,
          start: daysFromNow(-10 + l2i * 4),
          due: daysFromNow(Math.round(goal.dueInDays * (0.3 + l2i * 0.2))),
          estimate: null,
          assignee: pick(members).id,
        });

        const leafCount = 3 + rand(3);
        for (let l3 = 0; l3 < leafCount; l3 += 1) {
          const estimate = [60, 90, 120, 180, 240, 360][rand(6)];
          const leaf = makeNode({
            parent: n2,
            title: `${pick(VERBS)} ${pick(OBJECTS)}`,
            spaceId: space.id,
            importance: goal.importance,
            position: l3,
            start: daysFromNow(-5 + l3),
            due: daysFromNow(rand(45) - 3),
            estimate,
            assignee: pick(members).id,
          });
          leafIds.push(leaf.id);

          // Um quarto das folhas ganha mais um nivel, para exercitar a profundidade.
          if (rand(4) === 0) {
            for (let l4 = 0; l4 < 2; l4 += 1) {
              const sub = makeNode({
                parent: leaf,
                title: `${pick(VERBS)} ${pick(OBJECTS)}`,
                spaceId: space.id,
                importance: goal.importance,
                position: l4,
                start: daysFromNow(-3 + l4),
                due: daysFromNow(rand(30)),
                estimate: [30, 45, 60, 90][rand(4)],
                assignee: pick(members).id,
              });
              leafIds.push(sub.id);
            }
          }
        }
      }
    }
  }

  // Metade das folhas ja concluida, para haver cascata de verdade ao abrir.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const trueLeaves = leafIds.filter((id) => !rows.some((r) => r.parent_id === id));
  for (const id of trueLeaves) {
    if (rand(100) < 45) {
      const node = byId.get(id);
      node.status = 'COMPLETED';
      node.progress = 100;
      node.completed_at = daysFromNow(-rand(25));
    }
  }

  // Algumas folhas entram no plano de hoje.
  const openLeaves = trueLeaves.filter((id) => byId.get(id).status !== 'COMPLETED');
  for (const id of openLeaves.slice(0, 8)) {
    byId.get(id).planned_date = daysFromNow(0);
  }

  console.log(`Inserindo ${rows.length} nos...`);
  for (let i = 0; i < rows.length; i += 500) {
    await prisma.node.createMany({ data: rows.slice(i, i + 500) });
  }

  // Dependencias cruzadas entre ramos distintos.
  const candidates = openLeaves.slice(0, 40);
  let created = 0;
  for (let i = 0; i + 1 < candidates.length && created < 12; i += 4) {
    const blocker = byId.get(candidates[i]);
    const blocked = byId.get(candidates[i + 1]);
    if (!blocker || !blocked) continue;
    if (blocked.path.startsWith(`${blocker.path}/`)) continue;
    await prisma.nodeDependency.create({
      data: { blocker_id: blocker.id, blocked_id: blocked.id },
    });
    await prisma.node.update({ where: { id: blocked.id }, data: { status: 'BLOCKED' } });
    created += 1;
  }

  console.log(`Seed pronto: ${rows.length} nos, ${created} dependencias, ${members.length} membros.`);
  console.log('Rode `npm run recompute` ou suba o servidor para calcular a cascata.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
