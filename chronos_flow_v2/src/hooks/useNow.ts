import { useEffect, useState } from 'react';

/**
 * Relogio que provoca re-render. Sem ele, qualquer coisa derivada de
 * `new Date()` congela no instante em que o componente montou — era o que
 * prendia a linha de "hoje" na timeline ate alguem trocar de tela.
 *
 * Alem do intervalo, atualiza quando a janela volta a ficar visivel: com o
 * computador suspenso o `setInterval` nao dispara, e sem esse empurrao a
 * linha reapareceria no lugar de horas atras.
 */
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, intervalMs);

    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', tick);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', tick);
    };
  }, [intervalMs]);

  return now;
}
