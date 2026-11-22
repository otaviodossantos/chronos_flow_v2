import type { NodeDTO } from '@shared/types';

export const FLOATING_CARD = { width: 320, height: 152 };
export const FLOATING_PILL = { width: 236, height: 46 };

/** A janela atual e a do widget? Decide o que o App renderiza. */
export function isFloatingWindow(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.search.includes('window=floating') ||
    window.location.hash.includes('floating')
  );
}

/**
 * Canal unico de sincronizacao entre a janela principal e o widget.
 * No Electron vai por IPC; no navegador, por BroadcastChannel. Os dois
 * convergem no mesmo evento de DOM, entao quem escuta so precisa de um lugar.
 */
const CHANNEL = 'chronos_active_node';

export function broadcastActiveNode(node: NodeDTO | null) {
  window.chronos?.syncActiveNode?.(node ?? null);
  try {
    const bc = new BroadcastChannel(CHANNEL);
    bc.postMessage({ type: 'ACTIVE_NODE', node, at: Date.now() });
    bc.close();
  } catch {
    /* navegador sem BroadcastChannel */
  }
  window.dispatchEvent(new CustomEvent('chronos:active-node', { detail: node }));
}

export function subscribeActiveNode(cb: (node: NodeDTO | null) => void): () => void {
  const onDom = (e: Event) => cb((e as CustomEvent).detail ?? null);
  window.addEventListener('chronos:active-node', onDom);

  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = (e) => {
      if (e.data?.type === 'ACTIVE_NODE') cb(e.data.node ?? null);
    };
  } catch {
    /* ignora */
  }

  const unsubElectron = window.chronos?.onSyncActiveNode?.(cb);

  return () => {
    window.removeEventListener('chronos:active-node', onDom);
    bc?.close();
    unsubElectron?.();
  };
}

/**
 * Quem anunciou a mudanca. Nao e "qual janela": no Picture-in-Picture e no
 * overlay as duas pontas dividem o mesmo contexto de JavaScript, entao marcar
 * a janela silenciaria justamente o widget. Marca-se o papel, e cada lado
 * ignora apenas o proprio anuncio.
 */
export type OrigemArvore = 'main' | 'widget';

/**
 * Avisa o outro lado que a arvore mudou: conclusao feita pelo widget, ou
 * qualquer edicao feita na janela principal. Vai pelos tres caminhos porque
 * so um deles serve em cada montagem — IPC entre as janelas do Electron (que
 * sao processos distintos e nao compartilham BroadcastChannel), o canal do
 * navegador para o Picture-in-Picture, o evento de DOM para o overlay.
 */
export function broadcastTreeChanged(from: OrigemArvore = 'widget') {
  window.chronos?.notifyTreeChanged?.(from);
  try {
    const bc = new BroadcastChannel('chronos_tree');
    bc.postMessage({ type: 'TREE_CHANGED', from, at: Date.now() });
    bc.close();
  } catch {
    /* ignora */
  }
  window.dispatchEvent(new CustomEvent('chronos:tree-changed', { detail: { from } }));
}

export function subscribeTreeChanged(
  cb: () => void,
  options: { ignore?: OrigemArvore } = {},
): () => void {
  const { ignore } = options;
  const aceita = (from: unknown) => !ignore || from !== ignore;

  const onDom = (e: Event) => {
    if (aceita((e as CustomEvent).detail?.from)) cb();
  };
  window.addEventListener('chronos:tree-changed', onDom);

  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel('chronos_tree');
    bc.onmessage = (e) => {
      if (e.data?.type === 'TREE_CHANGED' && aceita(e.data.from)) cb();
    };
  } catch {
    /* ignora */
  }

  const unsubElectron = window.chronos?.onTreeChanged?.((from) => {
    if (aceita(from)) cb();
  });

  return () => {
    window.removeEventListener('chronos:tree-changed', onDom);
    bc?.close();
    unsubElectron?.();
  };
}

/** Copia os estilos da pagina para a janela Picture-in-Picture. */
function cloneStyles(target: Window) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      if (sheet.href) {
        const link = target.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        target.document.head.appendChild(link);
      } else if (sheet.cssRules) {
        const style = target.document.createElement('style');
        style.textContent = Array.from(sheet.cssRules)
          .map((r) => r.cssText)
          .join('');
        target.document.head.appendChild(style);
      }
    } catch {
      /* stylesheet cross-origin: ignora */
    }
  }
}

export type FloatingMount =
  | { kind: 'native' }
  | { kind: 'pip'; container: HTMLElement; window: Window }
  | { kind: 'overlay' };

/**
 * Tres caminhos, do melhor para o pior:
 * 1. Electron  -> janela nativa sem moldura, sempre no topo, em todos os espacos.
 * 2. Navegador -> Document Picture-in-Picture (flutua sobre os outros apps).
 * 3. Fallback  -> overlay no canto da propria pagina.
 */
export async function openFloatingWidget(
  node?: NodeDTO | null,
  onPipClosed?: () => void,
): Promise<FloatingMount> {
  if (window.chronos?.openFloatingWidget) {
    const ok = await window.chronos.openFloatingWidget(node ?? null).catch(() => false);
    if (ok) return { kind: 'native' };
  }

  if (window.documentPictureInPicture) {
    try {
      const existing = window.documentPictureInPicture.window;
      if (existing) {
        existing.focus();
        return { kind: 'pip', container: existing.document.body, window: existing };
      }

      const pip = await window.documentPictureInPicture.requestWindow(FLOATING_CARD);
      cloneStyles(pip);
      pip.document.documentElement.className = `${document.documentElement.className} is-floating-window`;
      pip.document.body.className =
        'm-0 p-0 h-full w-full overflow-hidden bg-transparent font-sans antialiased';
      pip.addEventListener('pagehide', () => onPipClosed?.());
      return { kind: 'pip', container: pip.document.body, window: pip };
    } catch {
      /* usuario negou ou navegador nao suporta */
    }
  }

  return { kind: 'overlay' };
}

export function resizeFloating(mount: FloatingMount | null, size: { width: number; height: number }) {
  if (!mount) return;
  if (mount.kind === 'native') {
    window.chronos?.resizeFloatingWidget?.(size.width, size.height);
  } else if (mount.kind === 'pip') {
    try {
      mount.window.resizeTo(size.width, size.height);
    } catch {
      /* alguns navegadores recusam */
    }
  }
}
