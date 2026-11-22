import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { NodeDTO } from '@shared/types';
import {
  broadcastTreeChanged, openFloatingWidget, subscribeTreeChanged, type FloatingMount,
} from '@/lib/floatingWindow';
import { FloatingTimerWidget } from './FloatingTimerWidget';

/**
 * Monta o widget no melhor lugar disponivel e mantem a janela principal
 * sincronizada com o que o widget faz.
 */
export function useFloatingWidget() {
  const [mount, setMount] = useState<FloatingMount | null>(null);
  const [node, setNode] = useState<NodeDTO | null>(null);
  const queryClient = useQueryClient();
  const mountRef = useRef(mount);
  mountRef.current = mount;

  // O widget concluiu algo: a janela principal recarrega sem o usuario pedir.
  useEffect(
    () =>
      subscribeTreeChanged(
        () => {
          queryClient.invalidateQueries();
        },
        { ignore: 'main' },
      ),
    [queryClient],
  );

  /**
   * E o caminho de volta: qualquer edicao feita aqui precisa chegar ao widget.
   * O bloco de tempo dele sai da estimativa da tarefa, que se altera nesta
   * janela — sem este aviso ele continuaria contando o prazo antigo ate
   * alguem trocar de tarefa.
   *
   * Assinar o cache de mutacoes em vez de espalhar um aviso por tela: sao
   * mais de vinte pontos de escrita hoje, e o proximo a ser criado ja nasce
   * coberto.
   */
  useEffect(
    () =>
      queryClient.getMutationCache().subscribe((event) => {
        if (event.type === 'updated' && event.action.type === 'success') {
          broadcastTreeChanged('main');
        }
      }),
    [queryClient],
  );

  const open = useCallback(async (target?: NodeDTO | null) => {
    setNode(target ?? null);
    const result = await openFloatingWidget(target ?? null, () => setMount(null));
    setMount(result);
  }, []);

  const close = useCallback(() => {
    const currentMount = mountRef.current;
    if (currentMount?.kind === 'native') window.chronos?.closeFloatingWidget?.();
    if (currentMount?.kind === 'pip') currentMount.window.close();
    setMount(null);
  }, []);

  return { open, close, mount, node };
}

export function FloatingWidgetPortal({
  mount,
  node,
  onClose,
}: {
  mount: FloatingMount | null;
  node: NodeDTO | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries();

  // A janela nativa do Electron renderiza a si mesma; nada a portar aqui.
  if (!mount || mount.kind === 'native') return null;

  if (mount.kind === 'pip') {
    return createPortal(
      <FloatingTimerWidget mount={mount} initialNode={node} onClose={onClose} onChanged={refresh} />,
      mount.container,
    );
  }

  return (
    <div
      className="fixed bottom-5 right-5 z-50 animate-in fade-in zoom-in-95"
      style={{ width: 320, height: 152 }}
    >
      <FloatingTimerWidget mount={mount} initialNode={node} onClose={onClose} onChanged={refresh} />
    </div>
  );
}
