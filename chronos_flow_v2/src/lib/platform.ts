/**
 * No macOS a janela usa `titleBarStyle: 'hiddenInset'`: os semaforos ficam
 * dentro da area do app, sobre o conteudo. Quem desenha o topo precisa saber
 * disso para reservar a faixa. No navegador nao ha semaforo nenhum.
 *
 * Duas fontes porque uma so ja falhou: `window.chronos` depende do preload
 * ter carregado, e o user agent nao depende de nada nosso.
 */
export const isMacDesktop = (): boolean => {
  const fromPreload = window.chronos?.platform;
  if (fromPreload) return fromPreload === 'darwin';

  const ua = navigator.userAgent;
  return /electron/i.test(ua) && /mac os x|macintosh/i.test(ua);
};

/** Altura da faixa reservada para os semaforos do macOS, em pixels. */
export const MAC_TRAFFIC_LIGHT_STRIP = 32;
