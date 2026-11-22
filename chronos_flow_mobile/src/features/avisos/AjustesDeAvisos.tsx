import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BellRing } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { avisos, noAparelho, sistema } from '@/native/chronos';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ANTECEDENCIAS } from './planoDeAvisos';
import { CHAVE_ANTECEDENCIA, CHAVE_LIGADO, lerAjustes } from './useAvisos';

const rotulo = (minutos: number) =>
  minutos === 0 ? 'Na hora de comecar' : `${minutos} min antes`;

/**
 * O interruptor dos avisos de tarefa.
 *
 * A permissao e pedida aqui, no momento em que a pessoa liga a chave — e nao
 * na primeira abertura do app. Pedir antes de existir o recurso gasta a unica
 * chance que o iOS da: negado uma vez, o dialogo nunca mais aparece, e so os
 * Ajustes do sistema desfazem.
 */
export function AjustesDeAvisos() {
  const queryClient = useQueryClient();

  const { data: prefs } = useQuery({ queryKey: ['preferencias'], queryFn: api.preferencias });
  const { data: estado } = useQuery({
    queryKey: ['avisos', 'estado'],
    queryFn: () => avisos.estado(),
    // O estado real mora no iOS, e a pessoa pode ter mexido nos Ajustes do
    // sistema sem passar por aqui.
    refetchOnWindowFocus: true,
  });

  const ajustes = lerAjustes(prefs);

  const gravar = useMutation({
    mutationFn: ({ chave, valor }: { chave: string; valor: string }) =>
      api.gravarPreferencia(chave, valor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preferencias'] });
      // O rearme acontece no `useAvisos`, que escuta as preferencias; a
      // contagem na tela so precisa esperar o sistema confirmar.
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['avisos', 'estado'] }), 600);
    },
  });

  const ligar = async (ligado: boolean) => {
    if (ligado && noAparelho()) {
      const permissao = await avisos.pedirPermissao();
      if (permissao === 'negada') {
        toast.error('O Chronos nao tem permissao para avisar.', {
          description: 'Libere as notificacoes nos Ajustes do iPhone.',
          action: { label: 'Ajustes', onClick: () => void sistema.abrirAjustes() },
        });
        return;
      }
    }
    gravar.mutate({ chave: CHAVE_LIGADO, valor: ligado ? '1' : '0' });
  };

  const negada = estado?.permissao === 'negada';

  return (
    <Card className="mt-4">
      <CardHeader className="p-3 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BellRing className="h-4 w-4" />
          Avisos de tarefa
        </CardTitle>
        <CardDescription className="text-[11px]">
          Um aviso antes de cada tarefa comecar. Dispara com o app fechado — quem guarda o
          compromisso e o proprio iPhone.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 p-3 pt-0">
        <label className="flex items-center gap-3 py-1">
          <span className="flex-1 text-sm">Avisar antes de comecar</span>
          <Switch
            aria-label="Avisar antes de cada tarefa comecar"
            checked={ajustes.ligado}
            onCheckedChange={(v) => void ligar(v)}
          />
        </label>

        {ajustes.ligado && (
          <div>
            <Label className="mb-1 block">Antecedencia</Label>
            <Select
              value={String(ajustes.antecedencia)}
              aria-label="Antecedencia do aviso"
              className="h-10 w-full"
              onChange={(e) =>
                gravar.mutate({ chave: CHAVE_ANTECEDENCIA, valor: e.target.value })
              }
            >
              {ANTECEDENCIAS.map((m) => (
                <option key={m} value={m}>
                  {rotulo(m)}
                </option>
              ))}
            </Select>
          </div>
        )}

        {/*
          O que o sistema realmente tem na fila, e nao o que o app acha que
          mandou. Sao coisas diferentes quando a permissao cai, quando o teto
          de 64 estoura, ou quando a pessoa limpa as notificacoes nos Ajustes.
        */}
        <p className="text-[11px] text-muted-foreground">
          {negada
            ? 'Sem permissao para notificar.'
            : ajustes.ligado
              ? `${estado?.armados ?? 0} aviso(s) armado(s) no iPhone.`
              : 'Nenhum aviso armado.'}
        </p>

        {negada && (
          <Button variant="outline" size="sm" onClick={() => void sistema.abrirAjustes()}>
            Abrir os Ajustes do iPhone
          </Button>
        )}

        <p className="text-[11px] leading-tight text-muted-foreground">
          Sao armados os avisos dos proximos 7 dias, ate 56 de uma vez — o iOS guarda no maximo 64
          por app. A fila e refeita toda vez que voce abre o Chronos.
        </p>
      </CardContent>
    </Card>
  );
}
