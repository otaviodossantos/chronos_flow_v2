/**
 * Servidor MCP do Chronos Flow v2. Fala com a propria API REST local,
 * entao a logica de cascata e prioridade vive num lugar so.
 */
const API = process.env.CHRONOS_API ?? 'http://localhost:3101/api';

interface Tool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  run: (args: Record<string, any>) => Promise<unknown>;
}

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  return body;
}

export const tools: Tool[] = [
  {
    name: 'get_tree',
    description: 'Subarvore de metas e tarefas ate uma profundidade, com filtros opcionais.',
    inputSchema: {
      type: 'object',
      properties: {
        rootId: { type: 'string', description: 'Meta macro a partir da qual ler' },
        spaceId: { type: 'string' },
        assigneeId: { type: 'string' },
        maxDepth: { type: 'number', description: 'Niveis abaixo da raiz (padrao 2)' },
        status: { type: 'string', description: 'Lista separada por virgula' },
      },
    },
    run: (args) => call(`/nodes/tree?${new URLSearchParams(args as any)}`),
  },
  {
    name: 'get_node',
    description: 'Um no com ancestrais, filhas, dependencias e atividade recente.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: (args) => call(`/nodes/${args.id}`),
  },
  {
    name: 'create_node',
    description: 'Cria um no em qualquer nivel. Sem parent_id, vira uma nova meta macro.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        parent_id: { type: 'string' },
        space_id: { type: 'string' },
        assignee_id: { type: 'string' },
        estimated_minutes: { type: 'number' },
        due_date: { type: 'string', description: 'ISO 8601' },
        importance: { type: 'number', description: '1 a 5' },
      },
      required: ['title'],
    },
    run: (args) => call('/nodes', { method: 'POST', body: JSON.stringify(args) }),
  },
  {
    name: 'break_down',
    description:
      'Quebra um no em varias subtarefas numa chamada. As filhas herdam o prazo do pai e dividem o peso na cascata.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        children: {
          type: 'array',
          description: 'Lista de { title, assignee_id?, estimated_minutes?, due_date? }',
        },
      },
      required: ['id', 'children'],
    },
    run: (args) =>
      call(`/nodes/${args.id}/breakdown`, {
        method: 'POST',
        body: JSON.stringify({ children: args.children }),
      }),
  },
  {
    name: 'complete_leaf',
    description:
      'Conclui uma tarefa folha e devolve a cascata: quanto cada ancestral subiu e o que foi destravado.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: (args) => call(`/nodes/${args.id}/complete`, { method: 'POST' }),
  },
  {
    name: 'get_focus_queue',
    description:
      'Fila do dia ordenada por impacto ascendente, com o ganho percentual de cada item na meta macro.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: 'today | next48 | all' },
        assigneeId: { type: 'string' },
      },
    },
    run: (args) => call(`/focus/queue?${new URLSearchParams(args as any)}`),
  },
  {
    name: 'simulate',
    description: 'Projeta o progresso das metas macro se este conjunto de folhas for concluido.',
    inputSchema: {
      type: 'object',
      properties: { nodeIds: { type: 'array' } },
      required: ['nodeIds'],
    },
    run: (args) =>
      call('/focus/simulate', { method: 'POST', body: JSON.stringify({ nodeIds: args.nodeIds }) }),
  },
  {
    name: 'assign',
    description: 'Delega um no a um membro da equipe.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, assignee_id: { type: 'string' } },
      required: ['id', 'assignee_id'],
    },
    run: async (args) => {
      const node = await call(`/nodes/${args.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ assignee_id: args.assignee_id }),
      });
      const members = (await call('/members')) as Array<{ id: string; name: string; loadPercent: number }>;
      const member = members.find((m) => m.id === args.assignee_id);
      return { node, member };
    },
  },
  {
    name: 'get_risk_map',
    description: 'Diagnostico de risco por ramificacao da arvore.',
    inputSchema: { type: 'object', properties: {} },
    run: () => call('/reports/risk-map'),
  },
];

/** Loop JSON-RPC sobre stdio. */
async function main() {
  process.stdin.setEncoding('utf8');
  let buffer = '';

  const send = (payload: unknown) => process.stdout.write(`${JSON.stringify(payload)}\n`);

  for await (const chunk of process.stdin) {
    buffer += chunk;
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;

      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }

      try {
        if (message.method === 'initialize') {
          send({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'chronos-flow-v2', version: '2.0.0' },
            },
          });
        } else if (message.method === 'tools/list') {
          send({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              tools: tools.map(({ name, description, inputSchema }) => ({
                name,
                description,
                inputSchema,
              })),
            },
          });
        } else if (message.method === 'tools/call') {
          const tool = tools.find((t) => t.name === message.params?.name);
          if (!tool) throw new Error(`Ferramenta desconhecida: ${message.params?.name}`);
          const result = await tool.run(message.params?.arguments ?? {});
          send({
            jsonrpc: '2.0',
            id: message.id,
            result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
          });
        }
      } catch (error) {
        send({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32000, message: (error as Error).message },
        });
      }
    }
  }
}

if (process.argv[1]?.includes('server')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
