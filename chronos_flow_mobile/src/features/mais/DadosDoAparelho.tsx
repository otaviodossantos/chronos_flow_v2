import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Upload, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { TransferirPeloWifi } from './TransferirPeloWifi';

/**
 * Levar os dados para outro iPhone.
 *
 * Nao ha sincronizacao: o app e isolado e local por decisao, nao por falta de
 * tempo. O que existe e um arquivo — voce exporta aqui, manda para onde
 * quiser e importa do outro lado.
 */
export function DadosDoAparelho() {
  const [ocupado, setOcupado] = useState<'exportando' | 'importando' | null>(null);
  const [confirmar, setConfirmar] = useState<{ arquivo: File; resumo: Resumo } | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const exportar = async () => {
    setOcupado('exportando');
    try {
      const pacote = await api.exportAll();
      const nome = `chronos-flow-${new Date().toISOString().slice(0, 10)}.json`;
      const arquivo = new File([JSON.stringify(pacote)], nome, { type: 'application/json' });

      // No iPhone a folha de compartilhamento e o unico caminho honesto para
      // um arquivo sair do app: nao ha "pasta de downloads" que o usuario
      // alcance. No navegador ela nao existe, e um link baixa direto.
      if (navigator.canShare?.({ files: [arquivo] })) {
        await navigator.share({ files: [arquivo], title: 'Chronos Flow' });
      } else {
        const url = URL.createObjectURL(arquivo);
        const a = document.createElement('a');
        a.href = url;
        a.download = nome;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      // Cancelar a folha de compartilhamento levanta AbortError: nao e falha.
      if ((e as Error).name !== 'AbortError') toast.error((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const escolher = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    try {
      const resumo = await api.inspectBackup(JSON.parse(await arquivo.text()));
      setConfirmar({ arquivo, resumo });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      // Sem isto, escolher o mesmo arquivo de novo nao dispara `change`.
      if (campo.current) campo.current.value = '';
    }
  };

  const importar = async () => {
    if (!confirmar) return;
    setOcupado('importando');
    try {
      const contagem = await api.importAll(JSON.parse(await confirmar.arquivo.text()));
      setConfirmar(null);
      await qc.invalidateQueries();
      toast.success(`${contagem.nodes} tarefas importadas.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  return (
    <section className="border-t px-4 py-5">
      <h2 className="text-sm font-semibold">Levar para outro aparelho</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Nada sai daqui sozinho e nada passa por servidor. Ou o computador esta
        na mesma rede, ou e um arquivo que voce leva na mao.
      </p>

      <div className="mt-3">
        <TransferirPeloWifi />
      </div>

      <p className="mb-2 mt-5 text-xs font-medium text-muted-foreground">Por arquivo</p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          disabled={ocupado !== null}
          onClick={exportar}
        >
          {ocupado === 'exportando' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Exportar
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          disabled={ocupado !== null}
          onClick={() => campo.current?.click()}
        >
          <Upload className="h-4 w-4" />
          Importar
        </Button>
      </div>

      <input
        ref={campo}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void escolher(e.target.files?.[0])}
      />

      {confirmar && (
        <div className="mt-3 rounded-lg border border-[hsl(var(--status-warning))] bg-[hsl(var(--status-warning))]/10 p-3">
          <p className="flex items-start gap-2 text-xs">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--status-warning))]" />
            <span>
              O arquivo traz <strong>{confirmar.resumo.nos} tarefas</strong>,{' '}
              {confirmar.resumo.espacos} espacos e {confirmar.resumo.backlog} itens de backlog,
              exportados em {new Date(confirmar.resumo.exportadoEm).toLocaleString('pt-BR')}.
              Tudo o que esta neste aparelho sera substituido.
            </span>
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              className="flex-1"
              disabled={ocupado !== null}
              onClick={importar}
            >
              {ocupado === 'importando' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Substituir tudo
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmar(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

type Resumo = Awaited<ReturnType<typeof api.inspectBackup>>;
