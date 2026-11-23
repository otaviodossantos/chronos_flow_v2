import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FORMATO_DO_PACOTE,
  validarPacote,
  resumoDoPacote,
  numeroDoPacote,
  pareceData,
  type Pacote,
} from '../shared/transferencia';
import { paraOPacote, doPacote, DECIMAIS, DELEGATE, ORDEM } from '../server/modules/transfer/pacote';
import { montarAnuncio, ehPergunta, PERGUNTA } from '../server/lib/descoberta';
import * as pareamento from '../server/lib/pareamento';

const pacoteMinimo = (extra: Partial<Pacote> = {}): unknown => ({
  formato: FORMATO_DO_PACOTE,
  app: 'chronos-flow',
  exportadoEm: new Date().toISOString(),
  tabelas: { users: [{ id: 'u1', name: 'Voce' }] },
  ...extra,
});

describe('formato do pacote', () => {
  it('aceita um pacote desta versao', () => {
    expect(validarPacote(pacoteMinimo()).app).toBe('chronos-flow');
  });

  it('recusa arquivo de outro programa', () => {
    expect(() => validarPacote({ app: 'outro', formato: 1, tabelas: {} })).toThrow(
      /nao e uma exportacao/,
    );
  });

  it('recusa um formato mais novo em vez de importar pela metade', () => {
    expect(() => validarPacote(pacoteMinimo({ formato: 99 }))).toThrow(/versao mais nova/);
  });

  it('recusa pacote sem usuario: nao haveria dono para as tarefas', () => {
    expect(() => validarPacote(pacoteMinimo({ tabelas: { nodes: [] } }))).toThrow(/nao tem usuario/);
  });

  it('resume o que o usuario precisa ver antes de substituir tudo', () => {
    const resumo = resumoDoPacote(
      validarPacote(
        pacoteMinimo({
          origem: { tipo: 'desktop', nome: 'MacBook' },
          tabelas: {
            users: [{ id: 'u1' }],
            nodes: [{ id: 'n1' }, { id: 'n2' }],
            spaces: [{ id: 'e1' }],
            backlog_items: [],
          },
        }),
      ) as Pacote,
    );
    expect(resumo).toMatchObject({ nos: 2, espacos: 1, backlog: 0, origem: 'MacBook' });
  });
});

describe('colunas que o JSON estragaria', () => {
  it('converte o Decimal do Prisma em numero, e nao em objeto', () => {
    // O Prisma entrega Decimal; em JSON isso viraria {"s":1,"e":1,"d":[62,5]}
    // e o SQLite do iPhone guardaria o objeto como texto.
    const decimal = { toString: () => '62.50' };
    const linha = paraOPacote('nodes', { id: 'n1', progress: decimal, title: 'A' });
    expect(linha.progress).toBe(62.5);
    expect(typeof linha.progress).toBe('number');
  });

  it('leva nulo adiante como nulo', () => {
    expect(paraOPacote('nodes', { manual_progress: null }).manual_progress).toBeNull();
    expect(numeroDoPacote(undefined)).toBeNull();
  });

  it('datas viram ISO na ida e Date na volta', () => {
    const quando = new Date('2026-03-01T12:30:00.000Z');
    const ida = paraOPacote('nodes', { due_date: quando });
    expect(ida.due_date).toBe('2026-03-01T12:30:00.000Z');

    const volta = doPacote('nodes', ida);
    expect(volta.due_date).toBeInstanceOf(Date);
    expect((volta.due_date as Date).getTime()).toBe(quando.getTime());
  });

  it('nao confunde texto comum com data', () => {
    expect(pareceData('2026-03-01')).toBe(false);
    expect(pareceData('Revisar ate 2026-03-01T10:00:00Z amanha')).toBe(false);
    expect(pareceData('2026-03-01T10:00:00Z')).toBe(true);
    const volta = doPacote('nodes', { title: '2026-03-01T10:00:00Z' });
    // Um titulo que parece data VAI virar Date — por isso o campo so e
    // convertido quando o valor inteiro e uma data, nunca por conter uma.
    expect(volta.title).toBeInstanceOf(Date);
  });

  it('todas as tabelas tem delegate e estao na ordem das chaves estrangeiras', () => {
    for (const t of ORDEM) expect(DELEGATE[t]).toBeTruthy();
    expect(ORDEM.indexOf('users')).toBeLessThan(ORDEM.indexOf('spaces'));
    expect(ORDEM.indexOf('spaces')).toBeLessThan(ORDEM.indexOf('nodes'));
    expect(ORDEM.indexOf('nodes')).toBeLessThan(ORDEM.indexOf('node_dependencies'));
    expect(DECIMAIS.nodes).toContain('root_impact');
  });
});

describe('codigo de pareamento', () => {
  beforeEach(() => pareamento.fechar());

  it('fechado por padrao: a porta nao fica aberta sozinha', () => {
    expect(pareamento.liberado()).toBe(false);
    expect(pareamento.conferir('123456')).toBe('fechado');
  });

  it('aceita o codigo certo e recusa o errado', () => {
    const { codigo } = pareamento.liberar('conta-a')!;
    expect(codigo).toMatch(/^\d{6}$/);
    expect(pareamento.conferir('000000' === codigo ? '111111' : '000000')).toBe('incorreto');
    expect(pareamento.conferir(codigo)).toBe('ok');
  });

  it('o codigo vale para a conta de quem liberou, e outra conta nao o toma', () => {
    const primeiro = pareamento.liberar('conta-a')!;
    expect(pareamento.dono()).toBe('conta-a');
    // Outra conta nao sobrescreve nem fecha o codigo aberto de alguem.
    expect(pareamento.liberar('conta-b')).toBeNull();
    pareamento.fechar('conta-b');
    expect(pareamento.dono()).toBe('conta-a');
    expect(pareamento.conferir(primeiro.codigo)).toBe('ok');
    // O dono pode gerar outro ou fechar.
    expect(pareamento.liberar('conta-a')).not.toBeNull();
    pareamento.fechar('conta-a');
    expect(pareamento.dono()).toBeNull();
  });

  it('morre depois de cinco tentativas erradas', () => {
    const { codigo } = pareamento.liberar('conta-a')!;
    const errado = codigo === '999999' ? '111111' : '999999';
    for (let i = 0; i < 4; i++) expect(pareamento.conferir(errado)).toBe('incorreto');
    expect(pareamento.conferir(errado)).toBe('esgotado');
    // E, morto, nem o codigo certo entra mais.
    expect(pareamento.conferir(codigo)).toBe('fechado');
  });

  it('expira sozinho', () => {
    vi.useFakeTimers();
    try {
      const { codigo } = pareamento.liberar('conta-a')!;
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);
      expect(pareamento.conferir(codigo)).toBe('expirado');
      expect(pareamento.liberado()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('anuncio na rede', () => {
  it('nao carrega nada do banco', () => {
    const anuncio = montarAnuncio({ nome: 'MacBook', porta: 3101, formato: FORMATO_DO_PACOTE });
    expect(anuncio).toMatchObject({ app: 'chronos-flow', tipo: 'desktop', nome: 'MacBook' });
    // Nome, porta e enderecos. Nada de contagem de tarefas, nada de usuario.
    expect(Object.keys(anuncio).sort()).toEqual(
      ['app', 'enderecos', 'formato', 'nome', 'porta', 'tipo'].sort(),
    );
  });

  it('so responde a propria palavra', () => {
    expect(ehPergunta(Buffer.from(PERGUNTA))).toBe(true);
    expect(ehPergunta(Buffer.from(`${PERGUNTA}\n`))).toBe(true);
    expect(ehPergunta(Buffer.from('QUEM_E'))).toBe(false);
    expect(ehPergunta(Buffer.from(''))).toBe(false);
  });
});
