import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { users } from '@db/schema';
import { bancoDeTeste, desligar } from './apoio/bancoDeTeste';
import { api } from '../src/lib/api';
import * as wifi from '../src/data/wifi';
import type { BD } from '../src/data/conexao';
import { FORMATO_DO_PACOTE } from '@shared/transferencia';

let bd: BD;
const UID = 'u1';
const DESKTOP = { nome: 'MacBook', host: '192.168.0.10', porta: 3101 };

beforeEach(async () => {
  bd = bancoDeTeste().bd;
  await bd.insert(users).values({ id: UID, name: 'Voce', birth_date: new Date(0) }).run();
});
afterEach(() => {
  vi.unstubAllGlobals();
  return desligar();
});

/** Uma resposta de verdade, para o cliente exercitar o caminho inteiro. */
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * Um pacote como o desktop o monta: DECIMAL ja virou numero e as datas sao
 * texto ISO. E exatamente este formato que chega pela rede.
 */
function pacoteDoDesktop() {
  const agora = new Date('2026-05-01T12:00:00.000Z').toISOString();
  return {
    formato: FORMATO_DO_PACOTE,
    app: 'chronos-flow' as const,
    origem: { tipo: 'desktop' as const, nome: 'MacBook' },
    exportadoEm: agora,
    tabelas: {
      users: [
        {
          id: 'desk-user',
          name: 'Henrique',
          birth_date: '1990-01-01T00:00:00.000Z',
          life_expectancy: 80,
          daily_focus_goal_minutes: 240,
          daily_impact_goal: 1.5,
          timezone: 'America/Sao_Paulo',
          gemini_model: 'gemini-2.0-flash',
          gemini_api_key: null,
          created_at: agora,
          updated_at: agora,
        },
      ],
      spaces: [
        {
          id: 'esp-1', user_id: 'desk-user', name: 'Turisky', description: null,
          color: '#2563eb', position: 0, archived: false, created_at: agora,
        },
      ],
      nodes: [
        {
          id: 'raiz', user_id: 'desk-user', space_id: 'esp-1', parent_id: null,
          path: 'raiz', depth: 0, position: 0, title: 'Projeto do desktop',
          description: null, status: 'IN_PROGRESS', weight: 1,
          // Os DECIMAL do Postgres chegam como numero, nunca como objeto.
          progress: 62.5, manual_progress: null, leaf_count: 2, rollup_dirty: false,
          start_date: agora, due_date: '2026-06-01T12:00:00.000Z', all_day: false,
          estimated_minutes: null, planned_date: null, scheduled_start: null,
          scheduled_end: null, completed_at: null, importance: 3, root_impact: 1,
          assignee_id: null, created_at: agora, updated_at: agora,
        },
        {
          id: 'folha', user_id: 'desk-user', space_id: 'esp-1', parent_id: 'raiz',
          path: 'raiz.folha', depth: 1, position: 0, title: 'Tarefa folha',
          description: null, status: 'COMPLETED', weight: 2, progress: 100,
          manual_progress: null, leaf_count: 1, rollup_dirty: false,
          start_date: agora, due_date: '2026-05-02T12:00:00.000Z', all_day: false,
          estimated_minutes: 120, planned_date: null, scheduled_start: null,
          scheduled_end: null, completed_at: '2026-05-02T10:00:00.000Z',
          importance: 3, root_impact: 0.5, assignee_id: null,
          created_at: agora, updated_at: agora,
        },
      ],
    },
  };
}

describe('transferencia pelo Wi-Fi', () => {
  it('reconhece um Chronos e ignora qualquer outra coisa na porta', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      resposta({ app: 'chronos-flow', tipo: 'desktop', nome: 'MacBook', formato: 2, liberado: true, expiraEm: 280 }),
    ));
    expect((await wifi.info(DESKTOP))?.nome).toBe('MacBook');

    vi.stubGlobal('fetch', vi.fn(async () => resposta({ app: 'outra-coisa' })));
    expect(await wifi.info(DESKTOP)).toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect(await wifi.info(DESKTOP)).toBeNull();
  });

  it('puxa o pacote do desktop e ele entra inteiro, com as datas certas', async () => {
    const chamadas: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push({ url, init });
      return resposta(pacoteDoDesktop());
    }));

    const { contagem, resumo } = await wifi.puxar(DESKTOP, '123456');
    expect(contagem.nodes).toBe(2);
    expect(resumo.origem).toBe('MacBook');

    // O codigo vai no cabecalho proprio, nunca na URL: URL entra em log.
    expect(chamadas[0].url).toBe('http://192.168.0.10:3101/api/transfer/export');
    expect((chamadas[0].init?.headers as Record<string, string>)['x-chronos-pair']).toBe('123456');

    const arvore = await api.tree({});
    expect(arvore.map((n) => n.title).sort()).toEqual(['Projeto do desktop', 'Tarefa folha']);

    const raiz = arvore.find((n) => n.id === 'raiz')!;
    // O DECIMAL atravessou como numero: se tivesse virado texto, isto seria NaN.
    expect(raiz.progress).toBeCloseTo(62.5, 4);
    expect(typeof raiz.progress).toBe('number');

    const folha = arvore.find((n) => n.id === 'folha')!;
    expect(folha.completed_at).toBe('2026-05-02T10:00:00.000Z');
    expect(folha.status).toBe('COMPLETED');
  });

  it('repassa a recusa do computador com a mensagem dele', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      resposta({ error: { code: 'VALIDATION_FAILED', message: 'Codigo incorreto.' } }, 422),
    ));
    await expect(wifi.puxar(DESKTOP, '000000')).rejects.toThrow('Codigo incorreto.');
  });

  it('nao deixa o app pendurado num computador que dormiu', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      // O que o navegador faz quando o AbortController dispara.
      await new Promise((_r, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
      return resposta({});
    }));
    await expect(wifi.info(DESKTOP)).resolves.toBeNull();
  }, 10_000);

  it('empurra o que esta no iPhone, marcando a origem', async () => {
    await api.createNode({ title: 'Feita aqui' });

    let enviado: unknown = null;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      enviado = JSON.parse(String(init?.body));
      return resposta({ importado: true, contagem: { nodes: 1 } });
    }));

    const r = await wifi.empurrar(DESKTOP, '654321', 'iPhone do Henrique');
    expect(r.importado).toBe(true);

    const pacote = enviado as { origem: { tipo: string; nome: string }; tabelas: Record<string, unknown[]> };
    expect(pacote.origem).toEqual({ tipo: 'iphone', nome: 'iPhone do Henrique' });
    expect(pacote.tabelas.nodes).toHaveLength(1);
  });
});

describe('ordem das linhas na importacao', () => {
  /**
   * O caso que quebrou de verdade: o desktop exporta `nodes` na ordem fisica do
   * banco, sem `orderBy`, entao uma filha pode vir antes da mae. Com
   * `foreign_keys = ON` o SQLite recusa essa linha na hora.
   */
  const pacoteEmbaralhado = () => {
    const agora = new Date('2026-05-01T12:00:00.000Z').toISOString();
    const no = (id: string, parent: string | null, depth: number, title: string) => ({
      id, user_id: 'desk-user', space_id: null, parent_id: parent,
      path: parent ? `raiz.${id}` : 'raiz', depth, position: 0, title,
      description: null, status: 'PENDING', weight: 1, progress: 0,
      manual_progress: null, leaf_count: 1, rollup_dirty: false,
      start_date: null, due_date: null, all_day: true, estimated_minutes: 60,
      planned_date: null, scheduled_start: null, scheduled_end: null,
      completed_at: null, importance: 3, root_impact: 0, assignee_id: null,
      created_at: agora, updated_at: agora,
    });

    return {
      formato: FORMATO_DO_PACOTE,
      app: 'chronos-flow' as const,
      exportadoEm: agora,
      tabelas: {
        users: [{
          id: 'desk-user', name: 'Henrique', birth_date: '1990-01-01T00:00:00.000Z',
          life_expectancy: 80, daily_focus_goal_minutes: 240, daily_impact_goal: 1.5,
          timezone: 'America/Sao_Paulo', gemini_model: 'gemini-2.0-flash',
          gemini_api_key: null, created_at: agora, updated_at: agora,
        }],
        // De proposito fora de ordem: neta, filha, raiz.
        nodes: [
          no('neta', 'filha', 2, 'Neta'),
          no('filha', 'raiz', 1, 'Filha'),
          no('raiz', null, 0, 'Raiz'),
        ],
      },
    };
  };

  it('aceita um pacote com a filha antes da mae', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(pacoteEmbaralhado())));

    const { contagem } = await wifi.puxar(DESKTOP, '123456');
    expect(contagem.nodes).toBe(3);

    const arvore = await api.tree({ maxDepth: 5 });
    expect(arvore.map((n) => n.title).sort()).toEqual(['Filha', 'Neta', 'Raiz']);
    // A arvore remontou de verdade, nao so entrou no banco.
    expect(arvore.find((n) => n.id === 'neta')!.parent_id).toBe('filha');
    expect(arvore.find((n) => n.id === 'filha')!.parent_id).toBe('raiz');
  });

  it('nao joga o SQL cru na tela quando a gravacao falha', async () => {
    const quebrado = pacoteEmbaralhado();
    // Uma filha cuja mae nao veio no pacote: a chave estrangeira recusa, e
    // nenhuma ordenacao conserta isso.
    quebrado.tabelas.nodes = [
      { ...quebrado.tabelas.nodes[1], parent_id: 'nunca-existiu' },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => resposta(quebrado)));

    await expect(wifi.puxar(DESKTOP, '123456')).rejects.toThrow(
      /apontam para outras que nao vieram junto/,
    );
    // E o muro de parametros nao vem junto.
    await expect(wifi.puxar(DESKTOP, '123456')).rejects.not.toThrow(/insert into/);
  });
});
