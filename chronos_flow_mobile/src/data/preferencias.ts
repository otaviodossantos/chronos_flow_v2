import { eq } from 'drizzle-orm';
import { preferencias } from '@db/schema';
import { bd as banco } from './conexao';

/**
 * Preferencias deste aparelho, em chave e valor.
 *
 * Nao entram no pacote de transferencia de proposito: "avisar 5 minutos
 * antes" e uma escolha deste iPhone, nao do projeto. Mandar isso junto com as
 * tarefas seria levar uma configuracao de notificacao para uma maquina que nao
 * notifica nada.
 *
 * Em tabela e nao no `localStorage` porque o WKWebView pode descartar o
 * armazenamento da pagina sob pressao de espaco — e uma preferencia que some
 * sozinha desligaria os avisos sem ninguem ter pedido.
 */
export async function ler(chave: string): Promise<string | null> {
  const linha = await banco()
    .select({ valor: preferencias.valor })
    .from(preferencias)
    .where(eq(preferencias.chave, chave))
    .get();
  return linha?.valor ?? null;
}

export async function gravar(chave: string, valor: string): Promise<void> {
  await banco()
    .insert(preferencias)
    .values({ chave, valor })
    .onConflictDoUpdate({ target: preferencias.chave, set: { valor } })
    .run();
}

/** Tudo de uma vez, para a tela nao fazer uma consulta por interruptor. */
export async function todas(): Promise<Record<string, string>> {
  const linhas = await banco().select().from(preferencias).all();
  return Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
}
