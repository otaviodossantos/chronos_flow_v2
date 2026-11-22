import { Capacitor } from '@capacitor/core';

/**
 * No desktop isto respondia sobre os semaforos do macOS. Aqui a pergunta
 * equivalente e outra: quanto do topo e do rodape pertencem ao sistema.
 *
 * Mantem-se o nome `isMacDesktop` exportado porque telas copiadas do desktop
 * ainda o consultam para reservar faixa — no iPhone a resposta e sempre nao,
 * e a faixa certa vem das variaveis de area segura.
 */
export const isMacDesktop = (): boolean => false;

export const MAC_TRAFFIC_LIGHT_STRIP = 0;

export const noIOS = (): boolean => Capacitor.getPlatform() === 'ios';

/** true quando roda dentro do app, e nao no navegador do desenvolvimento. */
export const nativo = (): boolean => Capacitor.isNativePlatform();

/**
 * Toque grosso. Serve para decidir alvo de 44px e gesto em vez de hover —
 * no navegador do desenvolvimento a resposta acompanha o aparelho emulado.
 */
export const porToque = (): boolean =>
  nativo() || (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);
