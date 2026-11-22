import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { avisos } from '@/native/chronos';
import { AJUSTES_PADRAO, mesmoPlano, planoDeAvisos, type Aviso, type AjustesDeAviso } from './planoDeAvisos';

export const CHAVE_LIGADO = 'avisos.ligado';
export const CHAVE_ANTECEDENCIA = 'avisos.antecedencia';

export function lerAjustes(prefs: Record<string, string> | undefined): AjustesDeAviso {
  if (!prefs) return AJUSTES_PADRAO;
  const minutos = Number(prefs[CHAVE_ANTECEDENCIA]);
  return {
    ligado: prefs[CHAVE_LIGADO] === '1',
    antecedencia: Number.isFinite(minutos) ? minutos : AJUSTES_PADRAO.antecedencia,
  };
}

/**
 * Mantem os avisos do iOS em dia com as tarefas.
 *
 * Quem arma os avisos e o app rodando — o sistema guarda o que foi armado e
 * dispara sozinho depois, mesmo com o app encerrado, mas nada *novo* entra na
 * fila enquanto ninguem abre o app. Entao o rearme acontece sempre que a
 * arvore muda e sempre que o app volta do segundo plano (o `App.tsx` invalida
 * as consultas ali, e a invalidacao chega aqui como dado novo).
 *
 * A arvore vem de uma consulta propria, sem filtro nenhum, e **nao** da que a
 * timeline usa. Se dependesse dela, esconder as concluidas ou filtrar por um
 * espaco desarmaria os avisos de tudo o que saiu da tela — um filtro de
 * visualizacao apagando lembretes.
 */
export function useAvisos(): void {
  const { data: nodes = [] } = useQuery({
    queryKey: ['avisos', 'arvore'],
    queryFn: () => api.tree({ maxDepth: 12 }),
  });
  const { data: prefs } = useQuery({ queryKey: ['preferencias'], queryFn: api.preferencias });

  const ajustes = lerAjustes(prefs);

  const plano = useMemo(
    () => planoDeAvisos(nodes, ajustes),
    // `ajustes` e um objeto novo a cada render; o que importa sao os dois
    // valores dentro dele.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, ajustes.ligado, ajustes.antecedencia],
  );

  /**
   * O ultimo plano enviado ao sistema.
   *
   * Rearmar e apagar e regravar tudo: barato, mas nao de graca, e com o app em
   * uso a arvore e reconsultada o tempo todo. Comparar antes evita refazer a
   * fila inteira do iOS a cada toque numa tarefa que nao mudou de data.
   */
  const ultimo = useRef<Aviso[] | null>(null);

  useEffect(() => {
    if (ultimo.current && mesmoPlano(plano, ultimo.current)) return;
    ultimo.current = plano;
    void avisos.sincronizar(
      plano.map((a) => ({
        id: a.id,
        nodeId: a.nodeId,
        titulo: a.titulo,
        corpo: a.corpo,
        quando: a.quando,
      })),
    );
  }, [plano]);
}
