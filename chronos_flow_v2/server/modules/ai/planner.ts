import type { AiPlan, PlanTask } from '../../../shared/schemas/index.js';
import { aiPlanSchema, contarTarefas } from '../../../shared/schemas/index.js';
import { generateJson, type GeminiConfig } from './gemini.js';
import { AppError } from '../../lib/errors.js';

/** Schema entregue ao modelo. A recursao vai ate 3 niveis, explicitos. */
const taskShape = (depth: number): Record<string, unknown> => {
  const base: Record<string, unknown> = {
    type: 'object',
    properties: {
      ref: { type: 'string' },
      title: { type: 'string' },
      detail: { type: 'string' },
      estimated_minutes: { type: 'integer' },
      offset_days: { type: 'integer' },
      duration_days: { type: 'integer' },
      role: { type: 'string' },
      depends_on: { type: 'array', items: { type: 'string' } },
    },
    required: ['ref', 'title'],
  };
  if (depth > 0) {
    (base.properties as Record<string, unknown>).children = {
      type: 'array',
      items: taskShape(depth - 1),
    };
  }
  return base;
};

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    tasks: { type: 'array', items: taskShape(2) },
    roles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          hours_per_week: { type: 'integer' },
          headcount: { type: 'integer' },
          reports_to: { type: 'string' },
        },
        required: ['title'],
      },
    },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['tasks', 'roles'],
};

const SYSTEM = `Voce decompoe trabalho em uma arvore de tarefas executaveis e no time necessario para toca-lo.

Regras:
- Responda em portugues do Brasil, sem acentuacao obrigatoria mas com texto natural.
- Produza de 3 a 6 frentes no primeiro nivel. Cada frente se quebra em etapas, e etapas em tarefas folha.
- Uma tarefa folha e algo que uma pessoa consegue terminar: sempre com estimated_minutes entre 30 e 960.
- Nao invente nomes de pessoas. Em "roles", descreva o PAPEL (ex: "Designer grafico", "Coordenador de voluntarios"), nunca alguem especifico.
- Em cada tarefa, "role" deve citar o titulo de um dos papeis listados em "roles".
- Toda tarefa recebe um "ref" curto e unico ("t1", "t2", ...). Use esses refs em "depends_on".
- "depends_on" lista os refs que precisam TERMINAR antes desta tarefa comecar. So inclua dependencia real de sequencia, nao "seria bom fazer antes". A maioria das tarefas nao tem nenhuma.
- NAO calcule datas. Quem encadeia as tarefas no calendario e o proprio sistema, a partir de estimated_minutes, de depends_on e da agenda de cada responsavel. Gastar esforco em offset_days so atrapalha.
- Use offset_days apenas quando a tarefa realmente nao PODE comecar antes de um certo dia por causa de algo externo (uma data fixa, a chegada de um material, um prazo legal). Na duvida, deixe de fora.
- O que decide a duracao e estimated_minutes. Seja honesto nele: e a partir dele que o prazo final e calculado.
- E preferivel que o conjunto estoure a janela a receber estimativas encolhidas para caber. O sistema avisa quando estoura.
- Ordene as frentes na sequencia em que precisam acontecer.
- Se o pedido for vago, assuma o cenario mais comum e diga a suposicao em "summary".`;

export interface PlanInput {
  title: string;
  notes?: string | null;
  context?: string | null;
  startDate?: Date | null;
  targetDate?: Date | null;
  existingRoles?: string[];
  extraInstructions?: string;
  /** Teto de tarefas somando todos os niveis. Nulo ou ausente = sem teto. */
  maxTasks?: number | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Corta o plano no teto pedido, em largura.
 *
 * O pedido ja diz o orcamento ao modelo, e na maioria das vezes ele respeita.
 * "Na maioria das vezes" nao e um limite: quem promete um teto precisa
 * cumpri-lo mesmo quando o modelo erra, senao a opcao vira sugestao.
 *
 * O corte e em largura, e nao em profundidade, porque o primeiro nivel e onde
 * mora a estrutura do projeto: e melhor perder o detalhamento de uma frente do
 * que perder a frente inteira. Na pratica, um plano com cinco frentes e um
 * orcamento de oito vira as cinco frentes e as tres primeiras etapas.
 *
 * As dependencias sao religadas no fim: um `depends_on` apontando para uma
 * tarefa que foi cortada viraria uma espera por algo que nunca acontece.
 */
export function limitarPlano(plano: AiPlan, teto: number | null | undefined): AiPlan {
  if (!teto || teto <= 0) return plano;
  if (contarTarefas(plano.tasks) <= teto) return plano;

  const mantidos = new Set<PlanTask>();
  const fila: PlanTask[] = [...plano.tasks];
  let orcamento = teto;

  while (fila.length > 0 && orcamento > 0) {
    const t = fila.shift()!;
    mantidos.add(t);
    orcamento -= 1;
    for (const filha of t.children ?? []) fila.push(filha);
  }

  const refsVivos = new Set<string>();
  const colherRefs = (ts: PlanTask[]) => {
    for (const t of ts) {
      if (!mantidos.has(t)) continue;
      if (t.ref) refsVivos.add(t.ref);
      colherRefs(t.children ?? []);
    }
  };
  colherRefs(plano.tasks);

  const podar = (ts: PlanTask[]): PlanTask[] =>
    ts
      .filter((t) => mantidos.has(t))
      .map((t) => {
        const filhas = podar(t.children ?? []);
        const dependencias = (t.depends_on ?? []).filter((r) => refsVivos.has(r));
        const podada: PlanTask = { ...t };
        if (filhas.length > 0) podada.children = filhas;
        else delete podada.children;
        if (dependencias.length > 0) podada.depends_on = dependencias;
        else delete podada.depends_on;
        return podada;
      });

  return { ...plano, tasks: podar(plano.tasks) };
}

/**
 * Que formato pedir para caber no orcamento.
 *
 * Sem isto, a regra do sistema ("de 3 a 6 frentes no primeiro nivel") brigava
 * com um teto pequeno: com orcamento de 5, o modelo abria 5 frentes vazias em
 * vez de entregar 5 tarefas uteis.
 */
function formaDoOrcamento(teto: number): string {
  if (teto <= 6) {
    return ' Com um orcamento tao curto, entregue uma lista simples de tarefas executaveis,' +
      ' sem subtarefas e sem frentes — e menos de 3 frentes se precisar.';
  }
  if (teto <= 15) {
    return ' Com esse orcamento, faca 2 a 4 frentes e quebre so as que realmente precisam,' +
      ' em um nivel de subtarefas.';
  }
  return ' Distribua o orcamento entre as frentes conforme o peso de cada uma;' +
    ' quebre em mais niveis apenas onde o detalhe ajuda quem executa.';
}

export async function planBacklogItem(config: GeminiConfig, input: PlanInput): Promise<AiPlan> {
  const parts = [`Preciso organizar: ${input.title}`];
  if (input.notes) parts.push(`Notas: ${input.notes}`);
  if (input.context) parts.push(`Contexto e restricoes: ${input.context}`);
  const start = input.startDate ?? new Date();
  if (input.targetDate) {
    const days = Math.max(
      1,
      Math.round((input.targetDate.getTime() - start.getTime()) / 86_400_000),
    );
    const weeks = Math.round((days / 7) * 10) / 10;
    parts.push(
      `Janela do projeto: comeca em ${iso(start)} e entrega em ${iso(input.targetDate)}.` +
        ` Sao ${days} dias corridos (cerca de ${weeks} semanas).` +
        ' Use essa janela para dimensionar o escopo, nao para distribuir datas:' +
        ' se o trabalho honesto nao couber, prefira reduzir o numero de tarefas' +
        ' a encolher as estimativas.',
    );
  } else if (input.startDate) {
    parts.push(
      `O projeto comeca em ${iso(input.startDate)}. Nao ha data de entrega definida —` +
        ' proponha uma duracao realista para cada tarefa e diga em "summary" quanto tempo o conjunto leva.',
    );
  }
  if (input.existingRoles?.length) {
    parts.push(
      `Pessoas ja disponiveis na equipe (reaproveite os papeis quando fizer sentido): ${input.existingRoles.join(', ')}.`,
    );
  }
  if (input.maxTasks && input.maxTasks > 0) {
    parts.push(
      `Orcamento de tarefas: no MAXIMO ${input.maxTasks} tarefas no total,` +
        ' contando todos os niveis juntos (frentes, etapas e folhas somadas).' +
        ' Esta regra vale acima da regra geral de 3 a 6 frentes.' +
        formaDoOrcamento(input.maxTasks) +
        ' Nao ultrapasse: o excedente e cortado automaticamente, e o que for cortado se perde.',
    );
  }
  if (input.extraInstructions) parts.push(`Instrucoes adicionais: ${input.extraInstructions}`);

  const raw = await generateJson<unknown>(config, parts.join('\n\n'), RESPONSE_SCHEMA, SYSTEM);

  const parsed = aiPlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('INTERNAL', 'O plano devolvido pelo modelo nao bateu com o formato esperado.', {
      issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  }

  // O teto e cumprido aqui, e nao apenas pedido no prompt: ver `limitarPlano`.
  return limitarPlano(parsed.data, input.maxTasks);
}
