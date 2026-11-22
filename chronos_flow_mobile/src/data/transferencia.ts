import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import {
  users, spaces, members, spaceMembers, taskTemplates, nodes,
  nodeDependencies, progressSnapshots, nodeActivity, backlogItems, backlogRoles,
} from '@db/schema';
import {
  FORMATO_DO_PACOTE,
  TABELAS_DO_PACOTE,
  validarPacote,
  resumoDoPacote,
  ordenarParaInserir,
  pareceData,
  numeroDoPacote,
  type Pacote,
  type TabelaDoPacote,
} from '@shared/transferencia';
import { bd as banco, emTransacao } from './conexao';
import { esquecerUsuarioAtual } from './usuario';
import { ErroDeRegra } from './repositorio';

/**
 * Levar os dados de um aparelho para outro.
 *
 * O formato mora em `shared/transferencia.ts`, junto do desktop: os dois lados
 * precisam concordar com ele byte a byte, e duas definicoes paralelas
 * divergiriam na primeira coluna nova — com o sintoma aparecendo so do outro
 * lado da transferencia. Aqui fica apenas o mapa de cada nome de tabela para a
 * tabela do Drizzle, que e o que o desktop nao tem.
 */
const TABELAS: Record<TabelaDoPacote, SQLiteTable> = {
  users,
  spaces,
  members,
  space_members: spaceMembers,
  task_templates: taskTemplates,
  nodes,
  node_dependencies: nodeDependencies,
  progress_snapshots: progressSnapshots,
  node_activity: nodeActivity,
  backlog_items: backlogItems,
  backlog_roles: backlogRoles,
};

export { FORMATO_DO_PACOTE, resumoDoPacote, validarPacote };
export type { Pacote };

/**
 * Datas viram texto ISO e voltam a ser Date: no JSON elas sairiam como `{}` ou
 * como milissegundos conforme o caminho, e as duas formas quebram a coluna de
 * timestamp na volta.
 */
const paraJSON = (linha: Record<string, unknown>) => {
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(linha)) {
    saida[k] = v instanceof Date ? v.toISOString() : v;
  }
  return saida;
};

/**
 * Na volta, o cuidado extra e com os DECIMAL do Postgres: de la eles chegam
 * como numero (o desktop ja converte), mas um pacote antigo pode trazer texto,
 * e o SQLite guardaria o texto sem reclamar — so o calculo de progresso
 * reclamaria depois, com NaN.
 */
const DECIMAIS: Partial<Record<TabelaDoPacote, string[]>> = {
  users: ['daily_impact_goal'],
  nodes: ['progress', 'manual_progress', 'root_impact'],
  progress_snapshots: ['progress'],
};

const daJSON = (tabela: TabelaDoPacote, linha: Record<string, unknown>) => {
  const decimais = DECIMAIS[tabela] ?? [];
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(linha)) {
    if (decimais.includes(k)) saida[k] = numeroDoPacote(v);
    else saida[k] = pareceData(v) ? new Date(v) : v;
  }
  return saida;
};

export async function exportar(nomeDoAparelho = 'iPhone'): Promise<Pacote> {
  const bd = banco();
  const tabelas: Pacote['tabelas'] = {};

  for (const nome of TABELAS_DO_PACOTE) {
    const linhas = await bd.select().from(TABELAS[nome]).all();
    tabelas[nome] = linhas.map((l) => paraJSON(l as Record<string, unknown>));
  }

  return {
    formato: FORMATO_DO_PACOTE,
    app: 'chronos-flow',
    origem: { tipo: 'iphone', nome: nomeDoAparelho },
    exportadoEm: new Date().toISOString(),
    tabelas,
  };
}

/**
 * Substitui tudo. Nao ha mescla de proposito: sem relogio comum entre os dois
 * aparelhos, "mesclar" seria adivinhar qual das duas versoes de uma tarefa e a
 * boa — e adivinhar errado aqui apaga trabalho.
 */
export async function importar(bruto: unknown) {
  const pacote = validarPacote(bruto);

  // O dono dos dados mudou junto com eles. Sem isto, a proxima tarefa criada
  // apontaria para um usuario que a linha de cima acabou de apagar — e o erro
  // apareceria la na frente, como falha de chave estrangeira.
  esquecerUsuarioAtual();

  /**
   * O erro cru do Drizzle traz o INSERT inteiro e todos os parametros do lote —
   * milhares de caracteres de UUID que ocupavam a tela do aparelho e nao diziam
   * nada a quem esta olhando. Ele vai para o console, onde serve; para a tela
   * vai uma frase.
   */
  const comMensagemCurta = async <T>(oQue: string, trabalho: () => Promise<T>) => {
    try {
      return await trabalho();
    } catch (erro) {
      console.error(`[chronos] falha ao ${oQue}:`, erro);
      // A mensagem do Drizzle so traz o SQL; o motivo real vem do driver, em
      // `cause`. Olhar so a de cima faz todo erro virar o texto generico.
      const e = erro as { message?: string; cause?: { message?: string } };
      const bruto = `${e.message ?? ''} ${e.cause?.message ?? ''}`;
      const chaveEstrangeira = /foreign key/i.test(bruto);
      throw new ErroDeRegra(
        'INTERNAL',
        chaveEstrangeira
          ? 'O pacote tem tarefas que apontam para outras que nao vieram junto. ' +
            'Exporte de novo do computador e tente outra vez.'
          : `Nao foi possivel ${oQue}. O detalhe esta no log do aparelho.`,
      );
    }
  };

  return comMensagemCurta('gravar os dados importados', () =>
    emTransacao(async (bd) => {
    // Na ordem inversa: filhas primeiro, senao a chave estrangeira segura.
    for (const nome of [...TABELAS_DO_PACOTE].reverse()) {
      await bd.delete(TABELAS[nome]).run();
    }

    const contagem: Record<string, number> = {};
    for (const nome of TABELAS_DO_PACOTE) {
      // Mae antes de filha: `nodes.parent_id` aponta para a propria tabela, e a
      // exportacao nao garante ordem nenhuma. Sem isto, um lote com a filha na
      // frente e recusado inteiro pela chave estrangeira.
      const linhas = ordenarParaInserir(nome, pacote.tabelas[nome] ?? []);
      contagem[nome] = linhas.length;
      // Em lotes: um INSERT por linha atravessaria a ponte do Capacitor
      // centenas de vezes, e o SQLite tem teto de variaveis por comando.
      for (let i = 0; i < linhas.length; i += 100) {
        const lote = linhas.slice(i, i + 100).map((l) => daJSON(nome, l));
        if (lote.length > 0) await bd.insert(TABELAS[nome]).values(lote as never).run();
      }
    }
    return contagem;
    }),
  );
}
