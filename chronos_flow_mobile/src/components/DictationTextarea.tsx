import { useRef } from 'react';
import { Mic, MicOff, Square, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { useDictation } from '@/hooks/useDictation';

interface Props extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}

/**
 * Campo de texto com ditado. O texto reconhecido e anexado ao que ja esta
 * escrito, nunca substitui — falar por cima de uma nota longa seria perde-la.
 */
export function DictationTextarea({ value, onChange, label, className, ...props }: Props) {
  const valueRef = useRef(value);
  valueRef.current = value;

  const dictation = useDictation((text) => {
    if (!text) return;
    const current = valueRef.current;
    const needsSpace = current.length > 0 && !/\s$/.test(current);
    onChange(`${current}${needsSpace ? ' ' : ''}${text}`);
  });

  const listening = dictation.state === 'listening';
  const transcribing = dictation.state === 'transcribing';
  const unsupported = dictation.mode === 'none';

  return (
    <div>
      {label && (
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          {dictation.mode === 'record' && listening && (
            <span className="text-[10px] text-muted-foreground">
              o texto aparece quando voce parar
            </span>
          )}
        </div>
      )}

      <div className="relative">
        <Textarea
          value={listening && dictation.partial ? `${value}${value ? ' ' : ''}${dictation.partial}` : value}
          onChange={(e) => onChange(e.target.value)}
          className={cn('pr-11', className)}
          {...props}
        />

        {/* Sem suporte o botao continua visivel, porem desabilitado: um botao
            que some sem explicacao parece defeito. */}
        <button
          type="button"
          onClick={dictation.toggle}
          disabled={transcribing || unsupported}
          aria-label={listening ? 'Parar o ditado' : 'Ditar por voz'}
          title={
            unsupported
              ? 'Ditado indisponivel: este ambiente nao da acesso ao microfone.'
              : listening
                ? 'Parar o ditado'
                : dictation.mode === 'live'
                  ? 'Ditar por voz (o texto aparece enquanto voce fala)'
                  : 'Gravar e transcrever ao parar'
          }
          className={cn(
            'absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full transition-colors',
            listening
              ? 'bg-[hsl(var(--status-critical))] text-white'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            unsupported && 'cursor-not-allowed opacity-30 hover:bg-transparent',
          )}
        >
          {transcribing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : listening ? (
            <Square className="h-3 w-3 fill-current" />
          ) : unsupported ? (
            <MicOff className="h-3.5 w-3.5" />
          ) : (
            <Mic className="h-3.5 w-3.5" />
          )}
          {listening && (
            <span className="absolute inset-0 animate-ping rounded-full bg-[hsl(var(--status-critical))] opacity-40" />
          )}
        </button>
      </div>

      {listening && (
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[hsl(var(--status-critical))]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
          {dictation.mode === 'live' ? 'Ouvindo — fale naturalmente' : 'Gravando'}
        </p>
      )}
      {transcribing && (
        <p className="mt-1 text-[11px] text-muted-foreground">Transcrevendo o audio...</p>
      )}
      {dictation.error && (
        <div className="mt-1 flex items-start gap-1.5 text-[11px] text-[hsl(var(--status-critical))]">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <div>
            {dictation.error}
            {/* Quem bloqueou foi o sistema: sem este atalho a mensagem seria um
                beco sem saida, porque o app nao pode mais perguntar. */}
            {dictation.bloqueadoPeloSistema && (
              <button
                type="button"
                onClick={dictation.abrirConfiguracoes}
                className="ml-1 whitespace-nowrap font-medium underline underline-offset-2 hover:no-underline"
              >
                Abrir as Configuracoes
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
