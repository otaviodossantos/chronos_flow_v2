import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, LogOut, Server, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import type { AuthEstado } from '@shared/types';
import { conta } from '@/lib/api';
import { esquecerSessao, servidorAtual, useConexao, voltarParaEscolha } from '@/data/servidores';
import { chaveDoLogin, limparDados } from './Porteira';

/** No topo de Mais: onde o app esta trabalhando, com quem, e como trocar. */
export function ContaEServidor() {
  const queryClient = useQueryClient();
  const { atual, geracao } = useConexao();
  const servidor = servidorAtual();
  const { data: auth } = useQuery<AuthEstado>({ queryKey: chaveDoLogin(atual, geracao), enabled: false });

  const trocar = useMutation({
    mutationFn: async () => {
      limparDados(queryClient);
      await voltarParaEscolha();
    },
  });

  const sair = useMutation({
    // Mesmo sem internet o aparelho esquece o token: sair e sair.
    mutationFn: () => conta.sair().catch(() => null),
    onSettled: async () => {
      limparDados(queryClient);
      await esquecerSessao();
      toast.success('Voce saiu da conta.');
    },
  });

  return (
    <div className="mt-2 border-y bg-card px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">
          {servidor ? <Server className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{servidor ? servidor.nome : 'Neste iPhone'}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {servidor
              ? `${auth?.usuario?.name ?? ''}${auth?.usuario?.email ? ` · ${auth.usuario.email}` : ''}`
              : 'Sem conta: os projetos ficam so no aparelho'}
          </span>
        </span>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => trocar.mutate()}
          disabled={trocar.isPending}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border text-xs font-medium active:bg-accent"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          Trocar servidor
        </button>
        {servidor && (
          <button
            type="button"
            onClick={() => sair.mutate()}
            disabled={sair.isPending}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border text-xs font-medium text-destructive active:bg-accent"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sair da conta
          </button>
        )}
      </div>
    </div>
  );
}
