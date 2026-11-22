import { useState } from 'react';
import { Users, Settings, Moon, Sun, ChevronRight, ArrowLeft, Heart } from 'lucide-react';
import { TeamPage } from '@/features/team/TeamPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { DadosDoAparelho } from './DadosDoAparelho';
import { LifeStrip } from '@/features/life/LifeStrip';
import { Switch } from '@/components/ui/switch';
import { useThemeStore } from '@/stores/themeStore';

type Destino = 'equipe' | 'ajustes' | 'vida' | null;

const ITENS: Array<{ id: Exclude<Destino, null>; label: string; nota: string; icon: React.ReactNode }> = [
  { id: 'equipe', label: 'Equipe', nota: 'Pessoas, espacos e modelos', icon: <Users className="h-5 w-5" /> },
  { id: 'vida', label: 'Minha vida', nota: 'As semanas que voce ja viveu', icon: <Heart className="h-5 w-5" /> },
  { id: 'ajustes', label: 'Ajustes', nota: 'Perfil, IA e dados', icon: <Settings className="h-5 w-5" /> },
];

/**
 * As telas que nao couberam na barra de abas.
 *
 * E uma pilha de um nivel so, nao um menu: abrir Equipe cobre esta lista e o
 * botao de voltar traz ela de volta. No iPhone, uma lista que vira tela cheia
 * e o padrao que o dedo ja conhece.
 */
export function MaisPage() {
  const [destino, setDestino] = useState<Destino>(null);
  const { theme, toggle } = useThemeStore();

  if (destino) {
    const titulo = ITENS.find((i) => i.id === destino)!.label;
    return (
      <div className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
          <button
            type="button"
            onClick={() => setDestino(null)}
            aria-label="Voltar"
            className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground active:bg-accent"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-sm font-semibold">{titulo}</h1>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {destino === 'equipe' && <TeamPage />}
          {destino === 'ajustes' && (
            <>
              <SettingsPage />
              <DadosDoAparelho />
            </>
          )}
          {destino === 'vida' && (
            <div className="p-4">
              <LifeStrip />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <h1 className="px-4 pb-2 pt-4 text-2xl font-semibold tracking-tight">Mais</h1>

      <div className="mt-2 divide-y border-y bg-card">
        {ITENS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setDestino(item.id)}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-accent"
          >
            <span className="text-muted-foreground">{item.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{item.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{item.nota}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ))}

        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className="text-muted-foreground">
            {theme === 'dark' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          </span>
          <span className="flex-1 text-sm font-medium">Tema escuro</span>
          <Switch checked={theme === 'dark'} onCheckedChange={toggle} />
        </div>
      </div>

      <p className="px-4 py-6 text-center text-[11px] text-muted-foreground">
        Tudo fica neste aparelho. Nada sai daqui sem voce pedir.
      </p>
    </div>
  );
}
