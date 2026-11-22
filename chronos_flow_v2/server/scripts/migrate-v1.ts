/**
 * Migra os dados da v1 para a v2. Idempotente: pode rodar quantas vezes
 * for preciso, porque limpa o destino antes de escrever.
 *
 *   V1_DATABASE_URL="postgresql://..." npm run migrate:v1
 *
 * Le a v1 por SQL cru, entao o schema antigo nao precisa estar disponivel
 * como client Prisma.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const V1_URL = process.env.V1_DATABASE_URL;
if (!V1_URL) {
  console.error('Defina V1_DATABASE_URL com a conexao do banco da v1.');
  process.exit(1);
}

const v1 = new PrismaClient({ datasources: { db: { url: V1_URL } } });
const v2 = new PrismaClient();

const COLOR_BY_CATEGORY: Record<string, string> = {
  PURPOSE: '#10B981',
  VALUES: '#6366F1',
  STRENGTHS: '#F59E0B',
  JOY: '#EC4899',
  EMPOWERMENT: '#06B6D4',
  PRODUCTIVITY: '#8B5CF6',
};

const TRAINING: Record<string, 'NOT_STARTED' | 'IN_TRAINING' | 'AUTONOMOUS'> = {
  NOT_STARTED: 'NOT_STARTED',
  IN_TRAINING: 'IN_TRAINING',
  AUTONOMOUS: 'AUTONOMOUS',
};

async function main() {
  console.log('Lendo a v1...');
  const users = await v1.$queryRawUnsafe<any[]>('SELECT * FROM users ORDER BY created_at LIMIT 1');
  if (users.length === 0) throw new Error('Nenhum usuario na v1.');
  const oldUser = users[0];

  const projects = await v1.$queryRawUnsafe<any[]>('SELECT * FROM projects ORDER BY created_at');
  const members = await v1.$queryRawUnsafe<any[]>('SELECT * FROM team_members ORDER BY created_at');
  const projectMembers = await v1.$queryRawUnsafe<any[]>('SELECT * FROM project_members');
  const tasks = await v1.$queryRawUnsafe<any[]>('SELECT * FROM tasks ORDER BY created_at');

  console.log(
    `v1: ${projects.length} projetos, ${members.length} membros, ${tasks.length} tarefas.`,
  );

  console.log('Limpando a v2...');
  await v2.nodeActivity.deleteMany();
  await v2.progressSnapshot.deleteMany();
  await v2.nodeDependency.deleteMany();
  await v2.node.deleteMany();
  await v2.spaceMember.deleteMany();
  await v2.member.deleteMany();
  await v2.space.deleteMany();
  await v2.user.deleteMany();

  const user = await v2.user.create({
    data: {
      id: oldUser.id,
      name: oldUser.name,
      birth_date: oldUser.birth_date,
      life_expectancy: oldUser.life_expectancy,
      // A meta em pontos da v1 vira meta de minutos de foco: 8 min por ponto.
      daily_focus_goal_minutes: Math.max(60, (oldUser.daily_points_goal ?? 30) * 8),
      daily_impact_goal: 1.5,
    },
  });

  for (const [i, p] of projects.entries()) {
    await v2.space.create({
      data: {
        id: p.id,
        user_id: user.id,
        name: p.name,
        description: p.description,
        color: COLOR_BY_CATEGORY[p.category] ?? '#10B981',
        position: i,
        archived: p.status === 'ARCHIVED',
        created_at: p.created_at,
      },
    });
  }

  for (const m of members) {
    await v2.member.create({
      data: {
        id: m.id,
        user_id: user.id,
        name: m.name,
        role: m.role,
        email: m.email,
        whatsapp: m.whatsapp,
        training_level: TRAINING[m.training_level] ?? 'NOT_STARTED',
        capacity_hours_week: 40,
        notes: m.notes,
        created_at: m.created_at,
      },
    });
  }

  for (const pm of projectMembers) {
    await v2.spaceMember.create({
      data: { id: pm.id, space_id: pm.project_id, member_id: pm.member_id },
    });
  }

  // Cada projeto ganha uma meta macro (depth 0); as tarefas planas viram filhas dela.
  console.log('Convertendo tarefas planas em arvore...');
  const rootBySpace = new Map<string, { id: string; path: string }>();

  for (const p of projects) {
    const rootId = randomUUID();
    const dueDates = tasks
      .filter((t) => t.project_id === p.id && t.due_date)
      .map((t) => new Date(t.due_date).getTime());

    await v2.node.create({
      data: {
        id: rootId,
        user_id: user.id,
        space_id: p.id,
        parent_id: null,
        path: rootId,
        depth: 0,
        position: 0,
        title: p.name,
        description: p.description,
        importance: 4,
        weight: 1,
        root_impact: 1,
        start_date: p.created_at,
        due_date: dueDates.length > 0 ? new Date(Math.max(...dueDates)) : null,
      },
    });
    rootBySpace.set(p.id, { id: rootId, path: rootId });
  }

  // Tarefas sem projeto ficam sob uma meta macro propria.
  const orphanTasks = tasks.filter((t) => !t.project_id);
  let orphanRoot: { id: string; path: string } | null = null;
  if (orphanTasks.length > 0) {
    const id = randomUUID();
    await v2.node.create({
      data: {
        id,
        user_id: user.id,
        parent_id: null,
        path: id,
        depth: 0,
        position: projects.length,
        title: 'Tarefas sem projeto (migradas da v1)',
        importance: 3,
        root_impact: 1,
      },
    });
    orphanRoot = { id, path: id };
  }

  const positionByRoot = new Map<string, number>();

  for (const t of tasks) {
    const root = t.project_id ? rootBySpace.get(t.project_id) : orphanRoot;
    if (!root) continue;

    const position = positionByRoot.get(root.id) ?? 0;
    positionByRoot.set(root.id, position + 1);

    // Campos sem destino na v2 viram notas: nada e descartado em silencio.
    const legacy: string[] = [];
    if (t.is_singular === false) legacy.push('Marcada como delegavel na v1.');
    if (t.is_delegated) legacy.push(`Delegada na v1 para: ${t.delegated_to ?? 'sem nome'}.`);
    if (t.delegation_notes) legacy.push(`Notas de delegacao: ${t.delegation_notes}`);
    if (t.is_recurring) legacy.push(`Recorrencia na v1: ${t.recurrence_interval}.`);

    await v2.node.create({
      data: {
        id: t.id,
        user_id: user.id,
        space_id: t.project_id ?? null,
        parent_id: root.id,
        path: `${root.path}/${t.id}`,
        depth: 1,
        position,
        title: t.title,
        description: [t.description, ...legacy].filter(Boolean).join('\n\n') || null,
        status:
          t.status === 'COMPLETED'
            ? 'COMPLETED'
            : t.status === 'IN_PROGRESS'
              ? 'IN_PROGRESS'
              : 'PENDING',
        importance: t.importance_score ?? 3,
        // Peso por esforco estimado, caindo para 1 quando a v1 nao tinha estimativa.
        weight: t.estimated_duration_minutes && t.estimated_duration_minutes > 0
          ? t.estimated_duration_minutes
          : 1,
        estimated_minutes: t.estimated_duration_minutes,
        start_date: t.start_date,
        due_date: t.due_date,
        planned_date: t.planned_date,
        scheduled_start: t.scheduled_start_time,
        scheduled_end: t.scheduled_end_time,
        completed_at: t.completed_at,
        assignee_id: t.delegated_member_id,
        leaf_count: 1,
        created_at: t.created_at,
      },
    });
  }

  console.log('Recalculando cascata e impacto...');
  const { recomputeAll } = await import('../modules/nodes/cascade.service.js');
  const result = await recomputeAll(user.id);

  console.log(
    `Migracao concluida: ${projects.length} espacos, ${members.length} membros, ${tasks.length} tarefas em ${result.roots} meta(s) macro.`,
  );
  console.log('A urgencia da v1 foi descartada: agora ela e derivada do prazo a cada leitura.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await v1.$disconnect();
    await v2.$disconnect();
  });
