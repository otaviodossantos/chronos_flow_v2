import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Eye } from 'lucide-react';
import { toast } from 'sonner';
import type { AuthEstado } from '@shared/types';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { AUTH_KEY, useTrocarEspaco } from '@/features/auth/AuthGate';

/**
 * Faixa fixa no topo enquanto o admin esta no espaco de outra conta. Tem de
 * ser impossivel esquecer: tudo o que aparece embaixo e de outra pessoa.
 */
export function FaixaDeOutraConta({ onVoltou }: { onVoltou: () => void }) {
  const { data: auth } = useQuery<AuthEstado>({ queryKey: AUTH_KEY, enabled: false });
  const espaco = useTrocarEspaco();
  const alvo = auth?.atuandoComo;
  if (!alvo) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-status-warning/50 bg-status-warning/15 px-4 py-2 text-sm"
    >
      <Eye className="h-4 w-4 shrink-0 text-status-warning" />
      <span className="min-w-0 flex-1">
        Voce esta no espaco de <strong>{alvo.name}</strong>
        <span className="text-muted-foreground"> ({alvo.email})</span>. O que mudar aqui fica registrado como{' '}
        {auth?.usuario?.name} (admin).
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-7 bg-background"
        disabled={espaco.isPending}
        onClick={() =>
          espaco.mutate(null, {
            onSuccess: onVoltou,
            onError: (e) => toast.error((e as ApiError).message),
          })
        }
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para o meu espaco
      </Button>
    </div>
  );
}
