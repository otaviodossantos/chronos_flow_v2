import { useEffect } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, X } from 'lucide-react';
import type { NodeDTO } from '@shared/types';
import { cn } from '@/lib/utils';
import {
  formatOffset, formatShortDate, formatTimeOfDay, parseISO, progressTone, TONE_TEXT,
} from '@/lib/format';
import { Select } from '@/components/ui/select';
import type { ZoomLevel } from '@/stores/timelineStore';
import { MODOS, PASSOS, dataNecessaria, passoPadrao, type Ajuste, type ModoAjuste } from './ajuste';

interface Props {
  node: NodeDTO;
  /** O deslocamento ainda na tela, para o rotulo contar o que a barra ja mostra. */
  previa: Ajuste | null;
  zoom: ZoomLevel;
  /*
    Modo, passo e cascata moram na pagina, e nao aqui, porque o arraste por
    dedo na timeline usa os tres: o passo e o encaixe do arraste, a cascata
    decide se as filhas vao junto, e pegar a borda direita da barra muda o modo
    para "Fim" — assim as setas continuam de onde o dedo parou.
  */
  modo: ModoAjuste;
  passo: number;
  cascata: boolean;
  onModo: (modo: ModoAjuste) => void;
  onPasso: (minutos: number) => void;
  onCascata: (cascata: boolean) => void;
  onAndar: (modo: ModoAjuste, minutos: number, cascata: boolean) => void;
  onAbrir: () => void;
  onFechar: () => void;
}

/** "12 Out · 09:00 → 10:00", encurtado quando comeca e termina no mesmo dia. */
function janela(node: NodeDTO): string {
  const inicio = parseISO(node.start_date);
  const fim = parseISO(node.due_date);
  if (!inicio && !fim) return 'sem datas';

  const dia = (d: Date) => formatShortDate(d);
  const hora = (d: Date) => (node.all_day ? '' : ` · ${formatTimeOfDay(d)}`);
  if (!inicio) return `ate ${dia(fim!)}${hora(fim!)}`;
  if (!fim) return `a partir de ${dia(inicio)}${hora(inicio)}`;

  const mesmoDia = dia(inicio) === dia(fim);
  const direita = mesmoDia && !node.all_day ? formatTimeOfDay(fim) : `${dia(fim)}${hora(fim)}`;
  return `${dia(inicio)}${hora(inicio)} → ${direita}`;
}

/**
 * A barra de ajuste da tarefa marcada.
 *
 * Existe porque o arraste morreu no aparelho. O WebKit decide que um toque que
 * se desloca e rolagem — manda `pointercancel` antes de o app ver o segundo
 * evento de movimento — e nenhuma combinacao de `touch-action`, captura de
 * ponteiro ou pressao longa deu a volta nisso em tres tentativas. Toque e
 * botao, por outro lado, sempre funcionaram.
 *
 * O ganho inesperado e o passo explicito: arrastando, o deslocamento minimo
 * era refem do zoom (na visao de meses, um dia inteiro). Aqui da para estar na
 * visao de trimestres e ainda assim empurrar a tarefa quinze minutos.
 */
export function BarraDoItem({
  node, previa, zoom, modo, passo, cascata, onModo, onPasso, onCascata,
  onAndar, onAbrir, onFechar,
}: Props) {
  // Trocar de zoom costuma ser trocar de intencao: quem foi para a visao de
  // horas quer mexer em horas. Continua sendo so um palpite — o passo fica
  // onde a pessoa deixar depois disso.
  useEffect(() => onPasso(passoPadrao(zoom)), [zoom]);

  const precisa = dataNecessaria(modo);
  const travado =
    (precisa === 'start' && !node.start_date) || (precisa === 'due' && !node.due_date);
  const tone = progressTone(node.progress);
  const deslocamento = previa && previa.id === node.id ? previa.minutos : 0;

  return (
    <div className="shrink-0 border-t bg-card px-2 pb-1 pt-1.5 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{node.title}</span>
        <span className={cn('shrink-0 font-mono text-[11px]', TONE_TEXT[tone])}>
          {Math.round(node.progress)}%
        </span>
        <button
          type="button"
          onClick={onAbrir}
          className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-secondary px-2 text-[11px] font-medium active:opacity-70"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Abrir
        </button>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Desmarcar"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {janela(node)}
          {deslocamento !== 0 && (
            <span className="ml-1.5 font-medium text-primary">{formatOffset(deslocamento)}</span>
          )}
        </span>
        {/*
          O equivalente ao Shift do desktop. Fica visivel, e nao escondido num
          gesto, porque num aparelho nao ha tecla para segurar — e porque a
          diferenca entre arrastar o pai com e sem as filhas e grande demais
          para ficar implicita.
        */}
        {!node.isLeaf && (
          <button
            type="button"
            onClick={() => onCascata(!cascata)}
            className={cn(
              'shrink-0 rounded-full border px-2 py-0.5 text-[10px]',
              cascata ? 'border-primary/50 text-primary' : 'border-border',
            )}
          >
            {cascata ? 'com as filhas' : 'so esta'}
          </button>
        )}
      </div>

      <div className="mt-1.5 flex rounded-lg border p-0.5">
        {MODOS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onModo(m.id)}
            aria-label={`${m.label}: ${m.ajuda}`}
            className={cn(
              'min-h-[34px] flex-1 rounded-md text-xs font-medium',
              modo === m.id ? 'bg-secondary text-foreground' : 'text-muted-foreground',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          type="button"
          disabled={travado}
          onClick={() => onAndar(modo, -passo, cascata)}
          aria-label={`${MODOS.find((m) => m.id === modo)!.label} para tras`}
          className="flex h-11 flex-1 items-center justify-center rounded-lg bg-secondary active:opacity-70 disabled:opacity-30"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>

        <Select
          value={String(passo)}
          onChange={(e) => onPasso(Number(e.target.value))}
          aria-label="Passo do ajuste"
          className="h-11 w-[94px] text-center text-xs"
        >
          {PASSOS.map((p) => (
            <option key={p.minutos} value={p.minutos}>{p.label}</option>
          ))}
        </Select>

        <button
          type="button"
          disabled={travado}
          onClick={() => onAndar(modo, passo, cascata)}
          aria-label={`${MODOS.find((m) => m.id === modo)!.label} para a frente`}
          className="flex h-11 flex-1 items-center justify-center rounded-lg bg-secondary active:opacity-70 disabled:opacity-30"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>

      {travado && (
        <p className="mt-1 text-center text-[10px] text-muted-foreground">
          Esta tarefa nao tem {precisa === 'start' ? 'data de inicio' : 'prazo'}: abra para definir.
        </p>
      )}
    </div>
  );
}
