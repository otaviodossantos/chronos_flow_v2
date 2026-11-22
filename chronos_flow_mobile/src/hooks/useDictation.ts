import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { noAparelho, sistema } from '@/native/chronos';

export type DictationMode = 'live' | 'record' | 'none';
export type DictationState = 'idle' | 'listening' | 'transcribing' | 'error';

/**
 * No iPhone so existe um caminho: gravar e transcrever.
 *
 * O WKWebView nao embute o reconhecimento de fala do Safari — o construtor
 * nem aparece —, entao o modo "ao vivo" do desktop foi removido em vez de
 * ficar como tentativa que sempre falha. O audio vai inteiro para o Gemini
 * quando voce para de falar, pelo mesmo `api.transcribe` do desktop.
 */
function detectMode(): DictationMode {
  if (typeof window === 'undefined') return 'none';
  const Live = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (Live && !noAparelho()) return 'live';
  if (typeof navigator.mediaDevices !== 'undefined' && window.MediaRecorder) return 'record';
  return 'none';
}

/**
 * O iOS grava em AAC dentro de um container MP4; os formatos Opus do desktop
 * nao existem la. A ordem muda de proposito conforme o aparelho, porque
 * `isTypeSupported` do WebKit ja respondeu `true` para formatos que depois
 * gravaram silencio.
 */
const TIPOS_IOS = ['audio/mp4', 'audio/aac', 'audio/mp4;codecs=mp4a.40.2'];
const TIPOS_WEB = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];

function pickMimeType(): string {
  for (const type of noAparelho() ? TIPOS_IOS : TIPOS_WEB) {
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
   * O bloqueio veio do sistema, nao do app: repetir o pedido nao adianta, e a
   * unica saida sao os Ajustes do iPhone.
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

  const liveRef = useRef<SpeechRecognitionLike | null>(null);
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
   * "Negado" tem dois donos. Negar no dialogo do app se resolve tentando de
   * novo; negar no sistema nao — o iOS guarda a resposta e nao pergunta mais.
   */
  const explicarNegativa = useCallback(async () => {
    const info = await sistema.microfone();
    if (info?.status === 'denied' || info?.status === 'restricted') {
      setBloqueadoPeloSistema(true);
      fail('O iPhone esta bloqueando o microfone para o Chronos Flow.');
      return;
    }
    fail('Permissao de microfone negada.');
  }, [fail]);

  const abrirConfiguracoes = useCallback(() => {
    void sistema.abrirAjustes();
  }, []);

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
        // Solta o microfone antes de qualquer trabalho de rede: no iPhone o
        // indicador laranja fica aceso enquanto a faixa nao for liberada.
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
          void sistema.vibrar('sucesso');
          setState('idle');
        } catch (err) {
          fail((err as Error).message || 'Nao foi possivel transcrever o audio.');
        }
      };

      recorderRef.current = recorder;
      setError(null);
      setState('listening');
      void sistema.vibrar('leve');
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
        if (result.isFinal) onTextRef.current(text.trim());
        else interim += text;
      }
      setPartial(interim);
    };
    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (event.error === 'not-allowed') return void explicarNegativa();
      fail(`Falha no reconhecimento (${event.error}).`);
    };
    recognition.onend = () => {
      setPartial('');
      setState((s) => (s === 'listening' ? 'idle' : s));
    };

    liveRef.current = recognition;
    setError(null);
    setState('listening');
    try {
      recognition.start();
    } catch {
      fail('Nao foi possivel iniciar o microfone.');
    }
  }, [fail, explicarNegativa]);

  const start = useCallback(() => {
    // Pode ter sido liberado nos Ajustes entre uma tentativa e outra.
    setBloqueadoPeloSistema(false);
    if (mode === 'live') startLive();
    else if (mode === 'record') void startRecording();
    else fail('Este aparelho nao permite ditado por voz.');
  }, [mode, startLive, startRecording, fail]);

  const stop = useCallback(() => {
    liveRef.current?.stop();
    liveRef.current = null;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    setPartial('');
  }, []);

  const toggle = useCallback(() => {
    if (state === 'listening') stop();
    else start();
  }, [state, start, stop]);

  // Sair da tela gravando deixaria o indicador do sistema aceso.
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
