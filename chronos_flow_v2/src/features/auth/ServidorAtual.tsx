import { useEffect, useState } from 'react';
import { Server } from 'lucide-react';
import { cn } from '@/lib/utils';

type Servidor = { nome: string; url: string; local?: boolean };

/**
 * "Servidor: X · Trocar", so dentro do app instalado. No navegador o servidor
 * e o endereco da propria pagina, e nao ha o que trocar aqui.
 */
export function ServidorAtual({ className }: { className?: string }) {
  const ponte = typeof window !== 'undefined' ? window.chronos?.servidor : undefined;
  const [servidor, setServidor] = useState<Servidor | null>(null);

  useEffect(() => {
    void ponte?.atual().then(setServidor).catch(() => setServidor(null));
  }, [ponte]);

  if (!ponte || !servidor) return null;

  return (
    <div className={cn('flex items-center justify-center gap-1.5 text-xs text-muted-foreground', className)}>
      <Server className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">
        Servidor: <span className="font-medium text-foreground">{servidor.nome}</span>
        {!servidor.local && <span className="font-mono"> · {new URL(servidor.url).host}</span>}
      </span>
      <button
        type="button"
        onClick={() => void ponte.trocar()}
        className="shrink-0 font-medium text-foreground underline-offset-2 hover:underline"
      >
        Trocar
      </button>
    </div>
  );
}
