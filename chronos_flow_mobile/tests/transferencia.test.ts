import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { users } from '@db/schema';
import { bancoDeTeste, desligar } from './apoio/bancoDeTeste';
import { api, ApiError } from '../src/lib/api';
import type { BD } from '../src/data/conexao';

let bd: BD;
const UID = 'u1';

beforeEach(async () => {
  bd = bancoDeTeste().bd;
  await bd.insert(users).values({ id: UID, name: 'Voce', birth_date: new Date(0) }).run();
});
afterEach(() => desligar());

describe('levar para outro aparelho', () => {
  it('exporta e importa de volta a mesma arvore', async () => {
    const espaco = await api.createSpace({ name: 'Turisky' });
    const raiz = await api.createNode({ title: 'Projeto', space_id: espaco.id });
    const a = await api.createNode({ title: 'A', parent_id: raiz.id, estimated_minutes: 60 });
    await api.createNode({ title: 'B', parent_id: raiz.id, estimated_minutes: 180 });
    await api.completeNode(a.id);
    await api.createBacklog({ title: 'Ideia solta' });

    const pacote = await api.exportAll();
    // O pacote viaja como texto: o que nao sobrevive ao JSON nao sobrevive a
    // viagem, e testar o objeto em memoria esconderia justamente isso.
    const texto = JSON.stringify(pacote);
    const antes = await api.tree({});

    // Outro aparelho, banco zerado. O `await` nao e enfeite: `desligar` fecha
    // a conexao de forma assincrona e, sem ele, zeraria a conexao nova.
    await desligar();
    bd = bancoDeTeste().bd;
    expect(await api.exportAll().then((p) => p.tabelas.nodes?.length ?? 0)).toBe(0);

    const contagem = await api.importAll(JSON.parse(texto));
    expect(contagem.nodes).toBe(3);

    const depois = await api.tree({});
    expect(depois.map((n) => n.title).sort()).toEqual(antes.map((n) => n.title).sort());

    const voltou = depois.find((n) => n.id === a.id)!;
    expect(voltou.status).toBe('COMPLETED');
    expect(voltou.completed_at).not.toBeNull();
    // As datas voltam como Date, nao como texto: se a coluna guardasse a
    // string, qualquer comparacao de prazo passaria a mentir.
    expect(new Date(voltou.completed_at!).getTime()).toBeGreaterThan(0);

    expect((await api.spaces()).map((e) => e.name)).toEqual(['Turisky']);
    expect((await api.backlog()).map((b) => b.title)).toEqual(['Ideia solta']);
  });

  it('o progresso em cascata atravessa intacto', async () => {
    const raiz = await api.createNode({ title: 'Raiz' });
    const a = await api.createNode({ title: 'A', parent_id: raiz.id, estimated_minutes: 60 });
    await api.createNode({ title: 'B', parent_id: raiz.id, estimated_minutes: 60 });
    await api.completeNode(a.id);

    const antes = (await api.tree({})).find((n) => n.id === raiz.id)!.progress;
    expect(antes).toBeGreaterThan(0);

    const texto = JSON.stringify(await api.exportAll());
    await desligar();
    bd = bancoDeTeste().bd;
    await api.importAll(JSON.parse(texto));

    expect((await api.tree({})).find((n) => n.id === raiz.id)!.progress).toBeCloseTo(antes, 4);
  });

  it('recusa um arquivo que nao e do Chronos', async () => {
    await expect(api.importAll({ formato: 1, app: 'outro', tabelas: {} })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(api.inspectBackup({ nada: true })).rejects.toThrow(ApiError);
  });

  it('recusa um arquivo de uma versao mais nova', async () => {
    await expect(
      api.importAll({ formato: 99, app: 'chronos-flow', tabelas: {} }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
