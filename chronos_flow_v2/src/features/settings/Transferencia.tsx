import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Smartphone, Download, Upload, Loader2, AlertTriangle, Wifi, Copy, Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { validarPacote, resumoDoPacote, type ResumoDoPacote } from '@shared/transferencia';

/**
 * Levar os dados daqui para o iPhone, e de volta.
 *
 * Nao ha sincronizacao e nao ha nuvem: ou e um arquivo que voce leva na mao,
 * ou e o celular puxando daqui pela rede de casa. O segundo caminho abre uma
 * porta, entao ele e deliberado e curto — um codigo de seis digitos que dura
 * cinco minutos e serve uma vez.
 */
export function Transferencia() {
  const [codigo, setCodigo] = useState<{ codigo: string; expiraEm: string } | null>(null);
  const [restante, setRestante] = useState(0);
  const [copiado, setCopiado] = useState(false);
  const [confirmar, setConfirmar] = useState<{ bruto: unknown; resumo: ResumoDoPacote } | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  // Conta para tras na tela: um codigo que expira em silencio faria o celular
  // dizer "codigo incorreto" sem que ninguem entendesse por que.
  useEffect(() => {
    if (!codigo) return;
    const fim = new Date(codigo.expiraEm).getTime();
    const tique = () => {
      const s = Math.max(0, Math.round((fim - Date.now()) / 1000));
      setRestante(s);
      if (s === 0) setCodigo(null);
    };
    tique();
    const id = window.setInterval(tique, 1000);
    return () => window.clearInterval(id);
  }, [codigo]);

  const liberar = useMutation({
    mutationFn: api.liberarTransferencia,
    onSuccess: setCodigo,
    onError: (e: ApiError) => toast.error(e.message),
  });

  const fechar = useMutation({
    mutationFn: api.fecharTransferencia,
    onSuccess: () => setCodigo(null),
  });

  const exportar = useMutation({
    mutationFn: api.exportarTudo,
    onSuccess: (pacote) => {
      const nome = `chronos-flow-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(pacote)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = nome;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${nome} salvo.`);
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const importar = useMutation({
    mutationFn: (bruto: unknown) => api.importarTudo(bruto),
    onSuccess: (r) => {
      setConfirmar(null);
      void qc.invalidateQueries();
      toast.success(`${r.contagem.nodes} tarefas importadas.`);
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const escolher = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    try {
      // Conferido aqui mesmo: o formato mora em `shared/`, entao a tela sabe
      // recusar um arquivo errado sem precisar mandar 40mb ao servidor antes.
      const bruto: unknown = JSON.parse(await arquivo.text());
      setConfirmar({ bruto, resumo: resumoDoPacote(validarPacote(bruto)) });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      // Sem isto, escolher o mesmo arquivo de novo nao dispara `change`.
      if (campo.current) campo.current.value = '';
    }
  };

  const mmss = `${String(Math.floor(restante / 60))}:${String(restante % 60).padStart(2, '0')}`;

  return (
    <Card className="mt-5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-4 w-4" />
          Transferir
        </CardTitle>
        <CardDescription>
          Levar tudo para o iPhone, ou trazer de volta. Pela rede de casa, ou por
          um arquivo — nada passa por servidor nenhum.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <Wifi className="h-3.5 w-3.5" />
            Pelo Wi-Fi
          </p>

          {codigo ? (
            <div className="rounded-lg border border-primary bg-primary/5 p-4">
              <p className="text-xs text-muted-foreground">
                No iPhone, em <strong>Mais &gt; Ajustes &gt; Levar para outro aparelho</strong>,
                toque em "Buscar no Wi-Fi", escolha este computador e digite:
              </p>
              <div className="mt-2 flex items-center gap-3">
                <span className="font-mono text-3xl font-semibold tracking-[0.3em]">
                  {codigo.codigo}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Copiar o codigo"
                  onClick={() => {
                    void navigator.clipboard.writeText(codigo.codigo);
                    setCopiado(true);
                    window.setTimeout(() => setCopiado(false), 1500);
                  }}
                >
                  {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
                <span className="ml-auto font-mono text-sm text-muted-foreground">{mmss}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => fechar.mutate()}
              >
                Fechar agora
              </Button>
            </div>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => liberar.mutate()}
                disabled={liberar.isPending}
              >
                {liberar.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wifi className="h-4 w-4" />
                )}
                Liberar por 5 minutos
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                O iPhone acha este computador sozinho na mesma rede. Enquanto
                liberado, quem souber o codigo pode ler ou substituir seus dados —
                por isso ele dura pouco e vale uma vez so.
              </p>
            </>
          )}
        </div>

        <div className="border-t pt-4">
          <p className="mb-2 text-sm font-medium">Por arquivo</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => exportar.mutate()}
              disabled={exportar.isPending}
            >
              {exportar.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Salvar em arquivo
            </Button>
            <Button variant="outline" onClick={() => campo.current?.click()}>
              <Upload className="h-4 w-4" />
              Importar arquivo
            </Button>
          </div>
          <input
            ref={campo}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => void escolher(e.target.files?.[0])}
          />
        </div>

        {confirmar && (
          <div className="rounded-lg border border-[hsl(var(--status-warning))] bg-[hsl(var(--status-warning))]/10 p-3">
            <p className="flex items-start gap-2 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--status-warning))]" />
              <span>
                O arquivo traz <strong>{confirmar.resumo.nos} tarefas</strong>,{' '}
                {confirmar.resumo.espacos} espacos e {confirmar.resumo.backlog} itens de
                backlog
                {confirmar.resumo.origem ? `, de "${confirmar.resumo.origem}"` : ''}, exportados
                em {new Date(confirmar.resumo.exportadoEm).toLocaleString('pt-BR')}. Tudo o que
                esta neste computador sera substituido.
              </span>
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={importar.isPending}
                onClick={() => importar.mutate(confirmar.bruto)}
              >
                {importar.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Substituir tudo
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmar(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
