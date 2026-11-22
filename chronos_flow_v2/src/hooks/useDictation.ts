import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

export type DictationMode = 'live' | 'record' | 'none';
export type DictationState = 'idle' | 'listening' | 'transcribing' | 'error';

/**
 * A API de fala do navegador transcreve ao vivo, palavra por palavra, mas
 * depende de um servico do Chrome que o Electron nao embute. Entao ha dois
 * caminhos: ao vivo onde existe, e gravar-e-transcrever onde nao existe.
 * Quem usa o hook nao precisa saber qual esta ativo.
 */
function detectMode(): DictationMode {
  if (typeof window === 'undefined') return 'none';
  const Live = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  // No Electron o construtor existe mas a chamada sempre falha com
  // "network"/"service-not-allowed"; o user agent e o unico sinal confiavel.
  const isElectron = /electron/i.test(navigator.userAgent);
  if (Live && !isElectron) return 'live';
  if (typeof navigator.mediaDevices !== 'undefined' && window.MediaRecorder) return 'record';
  return 'none';
}

/** Formatos que o Gemini aceita, na ordem em que preferimos gravar. */
const PREFERRED_TYPES = [
  'audio/ogg;codecs=opus',
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/webm',
];

function pickMimeType(): string {
  for (const type of PREFERRED_TYPES) {
    if (window.MediaRecorder?.isTypeSupported?.(type)) return type;
  }
  return '';
}

export interface Dictation {
  mode: DictationMode;
  state: DictationState;
  /** O que esta sendo dito agora, antes de virar texto definitivo. */
  partial: string;
  error: string | null;
  /**
   * O bloqueio veio do sistema operacional, nao do app: repetir o pedido nao
   * adianta, e a unica saida e a tela de Configuracoes.
   */
  bloqueadoPeloSistema: boolean;
  abrirConfiguracoes: () => void;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

export function useDictation(onText: (text: string) => void): Dictation {
  const [mode] = useState<DictationMode>(detectMode);
  const [state, setState] = useState<DictationState>('idle');
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [bloqueadoPeloSistema, setBloqueadoPeloSistema] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const fail = useCallback((message: string) => {
    setError(message);
    setState('error');
    setPartial('');
  }, []);

  /**
   * "Permissao negada" pode vir de dois lugares diferentes, e a saida de cada
   * um e outra: negar no dialogo do app se resolve tentando de novo; negar no
   * sistema nao — o macOS guarda a resposta e nunca mais pergunta.
   */
  const explicarNegativa = useCallback(async () => {
    try {
      const info = await window.chronos?.microphoneStatus?.();
      if (info && (info.status === 'denied' || info.status === 'restricted')) {
        setBloqueadoPeloSistema(true);
        fail(
          'O sistema esta bloqueando o microfone. Libere em Configuracoes do Sistema > ' +
            'Privacidade e Seguranca > Microfone — rodando em desenvolvimento, a ' +
            'entrada costuma estar no nome do terminal que abriu o app, nao em ' +
            `"${info.appName}".`,
        );
        return;
      }
      // O macOS so lista um app em Privacidade depois que ele pede acesso uma
      // vez. "Nao determinado" aqui quer dizer que o pedido nao chegou a ser
      // feito — nao adianta procurar o app na lista, ele ainda nao esta la.
      if (info?.status === 'not-determined') {
        fail(
          'O sistema ainda nao foi consultado sobre o microfone. Feche e abra o app: ' +
            'o pedido aparece na primeira vez que voce ditar.',
        );
        return;
      }
      // O sistema libera e mesmo assim nao abre: o bloqueio esta em outro
      // lugar, e dizer "permissao negada" aqui mandaria procurar no lugar errado.
      if (info?.status === 'granted') {
        fail('O sistema libera o microfone, mas o app nao conseguiu abri-lo.');
        return;
      }
    } catch {
      /* fora do Electron: cai na mensagem generica */
    }
    fail('Permissao de microfone negada.');
  }, [fail]);

  const abrirConfiguracoes = useCallback(() => {
    void window.chronos?.openMicrophoneSettings?.();
  }, []);

  const startLive = useCallback(() => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return fail('Reconhecimento de fala indisponivel.');

    const recognition = new Ctor();
    recognition.lang = 'pt-BR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        // Trecho fechado vai para o campo; o resto so aparece como previa.
        if (result.isFinal) onTextRef.current(text.trim());
        else interim += text;
      }
      setPartial(interim);
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (event.error === 'not-allowed') return void explicarNegativa();
      const messages: Record<string, string> = {
        'service-not-allowed': 'O reconhecimento de fala nao esta disponivel aqui.',
        network: 'O reconhecimento de fala precisa de internet.',
        'audio-capture': 'Nenhum microfone encontrado.',
      };
      fail(messages[event.error] ?? `Falha no reconhecimento (${event.error}).`);
    };

    recognition.onend = () => {
      setPartial('');
      setState((s) => (s === 'listening' ? 'idle' : s));
    };

    recognitionRef.current = recognition;
    setError(null);
    setState('listening');
    try {
      recognition.start();
    } catch {
      fail('Nao foi possivel iniciar o microfone.');
    }
  }, [fail, explicarNegativa]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Solta o microfone antes de qualquer trabalho de rede.
        for (const track of stream.getTracks()) track.stop();

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        if (blob.size < 1024) {
          setState('idle');
          return;
        }

        setState('transcribing');
        try {
          const base64 = await blobToBase64(blob);
          const { text } = await api.transcribe(base64, recorder.mimeType);
          if (text) onTextRef.current(text);
          setState('idle');
        } catch (err) {
          fail((err as Error).message || 'Nao foi possivel transcrever o audio.');
        }
      };

      recorderRef.current = recorder;
      setError(null);
      setState('listening');
      recorder.start();
    } catch (err) {
      const name = (err as Error).name;
      if (name === 'NotAllowedError') return void explicarNegativa();
      fail(
        name === 'NotFoundError'
          ? 'Nenhum microfone encontrado.'
          : 'Nao foi possivel acessar o microfone.',
      );
    }
  }, [fail, explicarNegativa]);

  const start = useCallback(() => {
    // Pode ter sido liberado nas Configuracoes entre uma tentativa e outra.
    setBloqueadoPeloSistema(false);
    if (mode === 'live') startLive();
    else if (mode === 'record') void startRecording();
    else fail('Este ambiente nao permite ditado por voz.');
  }, [mode, startLive, startRecording, fail]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    setPartial('');
  }, []);

  const toggle = useCallback(() => {
    if (state === 'listening') stop();
    else start();
  }, [state, start, stop]);

  // Sair da tela com o microfone aberto deixaria o indicador do sistema aceso.
  useEffect(() => stop, [stop]);

  return {
    mode, state, partial, error, bloqueadoPeloSistema, abrirConfiguracoes, start, stop, toggle,
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Falha ao ler o audio.'));
    reader.readAsDataURL(blob);
  });
}
