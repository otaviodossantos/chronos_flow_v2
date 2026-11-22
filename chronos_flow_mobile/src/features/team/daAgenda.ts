import type { MemberDTO } from '@shared/types';
import type { Contato } from '@/native/chronos';

/**
 * As cores dos avatares, para quem entra em lote.
 *
 * O cadastro a mao deixa todo mundo com o indigo padrao da coluna, e um time
 * inteiro vindo da agenda viraria uma fileira de circulos identicos — numa
 * timeline, a cor e o que diz de quem e a tarefa antes de alguem ler as
 * iniciais.
 */
export const CORES_DE_MEMBRO = [
  '#6366F1', '#10B981', '#F59E0B', '#EC4899',
  '#06B6D4', '#8B5CF6', '#EF4444', '#84CC16',
];

export const corPara = (indice: number) =>
  CORES_DE_MEMBRO[((indice % CORES_DE_MEMBRO.length) + CORES_DE_MEMBRO.length) % CORES_DE_MEMBRO.length];

/**
 * A forma comparavel de um nome: sem caixa, sem acento, sem espaco sobrando.
 *
 * "Joao Pedro", "joão pedro" e " João  Pedro " sao a mesma pessoa na agenda de
 * qualquer um. Comparar as strings cruas deixaria os tres virarem tres membros.
 */
export const chaveDoNome = (nome: string) =>
  nome
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');

/**
 * Esta pessoa ja esta no time?
 *
 * O email manda quando existe dos dois lados — e o unico identificador de
 * verdade aqui. Sem email, sobra o nome, que erra nos homonimos; errar para o
 * lado de avisar "ja existe" e melhor que criar o segundo "Joao Pedro" em
 * silencio, porque desmarcar custa um toque e desduplicar depois custa a
 * reatribuicao de todas as tarefas.
 */
export function jaCadastrado(contato: Contato, membros: MemberDTO[]): boolean {
  const email = contato.email.trim().toLowerCase();
  if (email && membros.some((m) => (m.email ?? '').trim().toLowerCase() === email)) return true;

  const nome = chaveDoNome(contato.nome);
  return nome.length > 0 && membros.some((m) => chaveDoNome(m.name) === nome);
}

/** Só os dígitos: "+55 48 99111-2233" e "4899111 2233" viram comparáveis. */
const digitos = (texto: string) => texto.replace(/\D+/g, '');

/**
 * A busca da lista de contatos.
 *
 * Procura no nome, no email e no telefone ao mesmo tempo, porque numa agenda
 * de centenas de nomes a pessoa lembra de um dos tres e nunca se sabe qual.
 * Nome e email comparam sem acento e sem caixa; telefone compara so os
 * digitos, senao "48 99111-2233" nao acharia quem esta gravado como
 * "+5548991112233".
 */
export function filtrarContatos(lista: Contato[], busca: string): Contato[] {
  const alvo = chaveDoNome(busca);
  if (!alvo) return lista;
  const numeros = digitos(busca);

  return lista.filter((c) => {
    if (chaveDoNome(c.nome).includes(alvo)) return true;
    if (c.email && chaveDoNome(c.email).includes(alvo)) return true;
    // Dois digitos nao filtram nada util e fariam metade da agenda "casar".
    return numeros.length >= 3 && digitos(c.telefone).includes(numeros);
  });
}

/**
 * Quantas linhas desenhar de uma vez.
 *
 * A agenda de quem usa o celular para trabalhar passa de mil contatos, e mil
 * linhas de React numa folha custam segundos de rolagem travada. O resto
 * aparece conforme a busca fecha o cerco — que e o jeito de usar a tela de
 * qualquer forma.
 */
export const LINHAS_POR_VEZ = 60;
