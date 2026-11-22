import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Wifi, Loader2, Monitor, ArrowDownToLine, ArrowUpFromLine, AlertTriangle, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { rede, sistema, noAparelho, type Desktop, type ResultadoDaBusca } from '@/native/chronos';
import * as wifi from '@/data/wifi';

type Passo =
  | { nome: 'parado' }
  | { nome: 'procurando' }
  | { nome: 'lista'; desktops: Desktop[] }
  | { nome: 'codigo'; desktop: Desktop; rotulo: string }
  | { nome: 'trabalhando'; o_que: 'puxar' | 'empurrar' };

interface Falha {
  titulo: string;
  oQueFazer: string;
  /** O texto cru do sistema, para quando nada mais explicar. */
  tecnico?: string;
}

/**
 * Traduz a busca vazia no motivo de ela ter vindo vazia.
 *
 * Quatro falhas diferentes chegavam aqui como "nenhum computador encontrado":
 * o plugin que nao foi adicionado ao alvo no Xcode, a permissao de rede local
 * negada (ou a chave `NSBonjourServices` ausente), o Mac que nao esta
 * anunciando, e o anuncio que chega mas nao conecta. So a terceira se resolve
 * mexendo no computador, e e a unica que a frase antiga sugeria.
 */
function explicar(r: ResultadoDaBusca): Falha {
  if (!r.ok) {
    if (r.motivo === 'plugin-ausente') {
      return {
        titulo: 'A busca nao existe neste build.',
        oQueFazer:
          'O arquivo DescobertaNaRede.swift nao foi adicionado ao alvo App no Xcode. ' +
          'Adicione-o (junto do ChronosNativePlugin.m) e rode de novo.',
        tecnico: r.detalhe,
      };
    }
    return { titulo: 'A busca falhou.', oQueFazer: 'Tente de novo.', tecnico: r.detalhe };
  }

  const { diagnostico: d } = r;

  if (d.estado === 'waiting' || d.estado === 'failed') {
    return {
      titulo: 'O iPhone nao conseguiu procurar na rede.',
      oQueFazer:
        'Quase sempre e a permissao de rede local: Ajustes do iPhone > Chronos Flow > ' +
        'Rede local. Se ela ja estiver ligada, falta a chave NSBonjourServices com ' +
        '_chronos._tcp no Info.plist do app.',
      tecnico: `${d.estado}: ${d.detalhe}`,
    };
  }

  if (d.vistos > 0 && d.resolvidos === 0) {
    return {
      titulo: `Achei ${d.vistos} anuncio(s), mas nao consegui conectar.`,
      oQueFazer:
        'O computador esta anunciando e a conexao nao completa — tipicamente o ' +
        'firewall do macOS barrando o processo do Node. Em Ajustes do Sistema > ' +
        'Rede > Firewall, permita conexoes de entrada para o node, ou desligue o ' +
        'firewall por um minuto para confirmar.',
      tecnico: `vistos=${d.vistos} resolvidos=${d.resolvidos}`,
    };
  }

  return {
    titulo: 'Nenhum computador anunciando.',
    oQueFazer:
      'O Chronos precisa estar rodando no computador, na mesma rede. Para conferir ' +
      'do lado dele, rode no Terminal: dns-sd -B _chronos._tcp — se nao listar nada, ' +
      'o problema esta la, e costuma ser o bonjour-service faltando (npm i bonjour-service).',
    tecnico: `estado=${d.estado} vistos=0`,
  };
}

/**
 * Trazer do computador, ou mandar para ele, sem arquivo no meio.
 *
 * O iPhone nao pode varrer a rede com UDP: desde o iOS 14 enviar ou receber
 * broadcast exige uma permissao que a Apple concede sob pedido. Bonjour faz o
 * mesmo trabalho e so pede a permissao de rede local — e e por isso que o
 * computador anuncia nos dois jeitos e o celular escuta so num.
 */
export function TransferirPeloWifi() {
  const [passo, setPasso] = useState<Passo>({ nome: 'parado' });
  const [codigo, setCodigo] = useState('');
  const [falha, setFalha] = useState<Falha | null>(null);
  const qc = useQueryClient();

  const procurar = async () => {
    setFalha(null);
    setPasso({ nome: 'procurando' });

    const r = await rede.procurar();
    if (r.ok && r.desktops.length > 0) {
      setPasso({ nome: 'lista', desktops: r.desktops });
      return;
    }

    // A explicacao fica na tela, nao num aviso que some em quatro segundos:
    // ela costuma ter um passo para seguir, e some antes de ser lido.
    setFalha(explicar(r));
    setPasso({ nome: 'parado' });
  };

  const escolher = async (desktop: Desktop) => {
    // Confirma que aquilo e mesmo um Chronos antes de pedir o codigo: um
    // servico com nome parecido na rede nao pode virar uma tela de senha.
    const dados = await wifi.info(desktop);
    if (!dados) {
      toast.error(`${desktop.nome} nao respondeu como Chronos.`);
      return;
    }
    if (!dados.liberado) {
      toast.error('A transferencia nao esta liberada nesse computador.', {
        description: 'La, em Ajustes > Transferir, clique em "Liberar por 5 minutos".',
      });
      return;
    }
    setCodigo('');
    setPasso({ nome: 'codigo', desktop, rotulo: dados.nome });
  };

  const executar = async (o_que: 'puxar' | 'empurrar') => {
    if (passo.nome !== 'codigo') return;
    const { desktop } = passo;
    setPasso({ nome: 'trabalhando', o_que });

    try {
      if (o_que === 'puxar') {
        const { contagem } = await wifi.puxar(desktop, codigo);
        await qc.invalidateQueries();
        void sistema.vibrar('sucesso');
        toast.success(`${contagem.nodes} tarefas vieram do computador.`);
      } else {
        const { contagem } = await wifi.empurrar(desktop, codigo);
        void sistema.vibrar('sucesso');
        toast.success(`${contagem.nodes} tarefas enviadas para o computador.`);
      }
      setPasso({ nome: 'parado' });
    } catch (e) {
      toast.error((e as Error).message);
      // Volta para o codigo, nao para o inicio: quase sempre e so digitar de
      // novo, e recomecar a busca a cada erro seria castigo.
      setPasso({ nome: 'codigo', desktop, rotulo: passo.rotulo });
    }
  };

  if (!noAparelho()) {
    return (
      <p className="text-xs text-muted-foreground">
        A busca pelo Wi-Fi so funciona no iPhone — no navegador nao ha rede local
        para procurar.
      </p>
    );
  }

  if (passo.nome === 'trabalhando') {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {passo.o_que === 'puxar' ? 'Trazendo do computador...' : 'Enviando para o computador...'}
      </div>
    );
  }

  if (passo.nome === 'codigo') {
    return (
      <div className="rounded-lg border p-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Monitor className="h-4 w-4" />
          {passo.rotulo}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Digite os seis digitos que aparecem no computador.
        </p>

        <Input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoFocus
          placeholder="000000"
          aria-label="Codigo de pareamento"
          className="mt-2 h-12 text-center font-mono text-2xl tracking-[0.3em]"
        />

        <div className="mt-3 space-y-2">
          <Button
            className="w-full"
            disabled={codigo.length < 6}
            onClick={() => void executar('puxar')}
          >
            <ArrowDownToLine className="h-4 w-4" />
            Trazer do computador
          </Button>
          <Button
            variant="outline"
            className="w-full"
            disabled={codigo.length < 6}
            onClick={() => void executar('empurrar')}
          >
            <ArrowUpFromLine className="h-4 w-4" />
            Enviar para o computador
          </Button>
        </div>

        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          Os dois sentidos substituem tudo do lado que recebe. Nao ha mescla.
        </p>

        <Button
          variant="ghost"
          size="sm"
          className="mt-1 w-full"
          onClick={() => setPasso({ nome: 'parado' })}
        >
          Cancelar
        </Button>
      </div>
    );
  }

  if (passo.nome === 'lista') {
    return (
      <div className="rounded-lg border">
        {passo.desktops.map((d) => (
          <button
            key={`${d.host}:${d.porta}`}
            type="button"
            onClick={() => void escolher(d)}
            className="flex w-full items-center gap-3 border-b px-3 py-3 text-left last:border-b-0 active:bg-accent"
          >
            <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{d.nome}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {d.host}:{d.porta}
              </span>
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => void procurar()}
          className="flex w-full items-center justify-center gap-2 px-3 py-2.5 text-xs text-muted-foreground active:bg-accent"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Procurar de novo
        </button>
      </div>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        className="w-full"
        disabled={passo.nome === 'procurando'}
        onClick={() => void procurar()}
      >
        {passo.nome === 'procurando' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Wifi className="h-4 w-4" />
        )}
        Buscar no Wi-Fi
      </Button>

      {falha && (
        <div className="mt-2 rounded-lg border border-[hsl(var(--status-warning))] bg-[hsl(var(--status-warning))]/10 p-3">
          <p className="flex items-start gap-2 text-xs font-medium">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--status-warning))]" />
            {falha.titulo}
          </p>
          <p className="mt-1.5 pl-6 text-[11px] leading-relaxed text-muted-foreground">
            {falha.oQueFazer}
          </p>
          {falha.tecnico && (
            <p className="mt-1.5 pl-6 font-mono text-[10px] text-muted-foreground/70">
              {falha.tecnico}
            </p>
          )}
        </div>
      )}
    </>
  );
}
