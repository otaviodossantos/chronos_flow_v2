import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { App as AppNativo } from '@capacitor/app';
import { api } from '@/lib/api';
import { widgets } from '@/native/chronos';

/**
 * Mantem os widgets da tela inicial em dia.
 *
 * Os widgets do iOS nao rodam JavaScript nem leem o banco do app: eles leem um
 * arquivo no App Group que o app precisa ter deixado la. Entao o resumo e
 * publicado quando os dados mudam e, principalmente, quando o app sai da tela —
 * que e o instante exato antes de o usuario olhar a tela inicial.
 */
export function usePublicarResumo() {
  const { data } = useQuery({
    queryKey: ['resumo-do-dia'],
    queryFn: api.dayDigest,
    // O resumo muda a cada conclusao; 30s evita republicar a cada tique.
    staleTime: 30_000,
  });

  useEffect(() => {
    if (data) void widgets.publicar(data);
  }, [data]);

  useEffect(() => {
    const handle = AppNativo.addListener('appStateChange', ({ isActive }) => {
      if (isActive) return;
      // Sair da tela e o ultimo momento util: republica o que ja esta em maos
      // em vez de consultar o banco com o WebView ja congelando.
      void api.dayDigest().then((r) => widgets.publicar(r), () => {});
    });
    return () => void handle.then((h) => h.remove());
  }, []);
}
