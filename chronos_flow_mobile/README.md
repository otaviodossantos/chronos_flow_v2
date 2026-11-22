# Chronos Flow — iPhone

Tudo no aparelho. Sem servidor, sem sincronizacao, sem rede — a unica saida
para a internet e o Gemini, e so quando voce pede um rascunho no backlog.

## A decisao que organiza o resto

O desktop tem 4.730 linhas de servidor escritas contra o Prisma, que nao roda
numa WebView. Havia tres saidas, e a escolha nao foi por gosto:

| caminho | custo | risco |
|---|---|---|
| reescrever tudo em SQL cru | ~2.900 linhas | baixo, mas longo |
| imitar o Prisma com um ORM caseiro | ~800 linhas | **alto**: bug sutil bem onde mora a cascata |
| **Drizzle sobre SQLite** | traducao mecanica | baixo |

Medindo a superficie do Prisma em uso — 15 metodos, 10 operadores de `where`,
`include` em poucas relacoes — ficou claro que a traducao para Drizzle e
mecanica (`findMany` -> `db.query.x.findMany`, `startsWith` -> `like`). Drizzle
tem **zero dependencias**, que e o que o faz caber numa WebView.

## O que e compartilhado e o que nao e

Por alias de build, fonte unica, **nunca copiado**:

- `@core/*` -> `../chronos_flow_v2/server/domain` (1.092 linhas)
- `@shared/*` -> `../chronos_flow_v2/shared` (454 linhas)

Cascata de pesos, impacto na meta macro, agendamento do backlog, caminho
hierarquico: logica pura, identica nos dois apps. Divergir aqui seria ter dois
apps que discordam do mesmo numero.

A **interface nao e compartilhada**, de proposito. Ela precisa divergir para
caber no dedo: o desktop usa arrastar-e-soltar do HTML5 (que nao dispara em
toque), alcas reveladas por `hover` (que nao existe) e teclas modificadoras
(Shift, Alt) que um iPhone nao tem. O visual e o mesmo; o gesto, nao.

## Camada nativa

Live Activity e WidgetKit sao Swift — nao ha atalho. Ficam em `ios-native/`:

- `Compartilhado/` — modelos que o app e as extensoes dividem pelo App Group
- `Widgets/` — a Ilha Dinamica e o widget da tela inicial
- `Plugin/` — a ponte Capacitor, chamada de `src/native/chronos.ts`

O cronometro da Ilha usa `Text(timerInterval:pauseTime:)`: conta sozinho,
desenhado pelo sistema. O app nao acorda a cada segundo — o ActivityKit limita
updates, e empurrar um relogio a mao gastaria esse orcamento em minutos.

Os widgets leem um JSON pequeno do App Group, nao o SQLite. Abrir o banco na
extensao obrigaria a conhecer o schema inteiro e pagar uma consulta recursiva a
cada recarga, com orcamento de CPU contado.

**Limites do ActivityKit, confirmados na documentacao da Apple:** 8 horas ativa,
ate 12 na tela bloqueada, 4 KB de conteudo. O teto de 8h coincide com o teto do
bloco de foco que o app ja aplicava (`duracaoDoBloco`) — nao ha conflito.

## O que falta fazer no Xcode (so voce pode)

1. `npm install` e `npx cap add ios`
2. Capability **App Groups** no alvo do app: `group.br.com.turisky.chronosflow`
3. Novo alvo **Widget Extension** chamado `ChronosWidgets`, marcando
   "Include Live Activity"; mesmo App Group
4. Arrastar `ios-native/Compartilhado/*` para **os dois** alvos; `Widgets/*` so
   para a extensao; `Plugin/*` so para o app
5. No `Info.plist` do app: `NSSupportsLiveActivities` = `YES`
6. URL scheme `chronosflow` no alvo do app (para o toque na Ilha abrir a tarefa)

## Risco em aberto

Nao consegui confirmar `Text(timerInterval:)` na documentacao da Apple — as
paginas foram bloqueadas na consulta. A API e a usada para cronometro em widget
e deve funcionar; se nao funcionar, o plano B e `atualizarFoco` chamado a cada
troca de minuto enquanto o app estiver em primeiro plano, com a Ilha mostrando
o horario de termino em vez da contagem. Isso se descobre no primeiro build.

Tambem nao consigo compilar Swift daqui: o ambiente e Linux, sem Xcode. O
codigo nativo esta escrito e revisado, mas **nao compilado**.
