import { AppError } from './errors.js';
import { contexto } from './sessao.js';

/**
 * Dono da requisicao em curso: quem o porteiro autenticou (ver `sessao.ts`).
 *
 * Nao ha mais "na duvida, o primeiro usuario do banco". Com varias contas
 * esse atalho entregaria os dados de uma pessoa a outra, e ele disparava
 * justamente quando algo dava errado — um callback que perdeu o contexto.
 * Scripts e tarefas de inicializacao passam o id da conta explicitamente.
 */
export async function currentUserId(): Promise<string> {
  const ctx = contexto.getStore();
  if (ctx?.userId) return ctx.userId;
  if (ctx) throw new AppError('NAO_AUTENTICADO', 'Entre na sua conta para continuar.');
  throw new Error('currentUserId() chamado fora de uma requisicao: passe o id da conta explicitamente.');
}
