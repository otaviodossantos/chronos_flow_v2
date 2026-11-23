# Chronos Flow v2

Gestao de projetos com **tarefas recursivas**, **progresso em cascata bottom-up**
e uma **timeline telescopica**. Aplicacao desktop (Electron) ou web, com contas
(cada pessoa ve so os proprios projetos), sobre PostgreSQL.

A v2 substitui a tabela plana de tarefas da v1 por uma arvore sem limite de
niveis: meta macro e microtarefa sao a mesma entidade, diferenciadas apenas por
profundidade.

---

## Como rodar

### 1. Banco

Opcao A — o Postgres nativo que voce ja usa:

```bash
createdb chronos_flow_v2
```

Opcao B — container isolado:

```bash
docker compose up -d   # sobe na porta 5433
```

Ajuste `DATABASE_URL` no `.env` conforme a opcao escolhida.

### 2. Dependencias e schema

```bash
npm install
npx prisma generate      # precisa de acesso a binaries.prisma.sh
npm run prisma:migrate   # cria e aplica as migrations
npm run prisma:seed      # ~450 nos em 4 metas macro, 4 membros, dependencias
npm run recompute        # calcula progresso e impacto de toda a base
```

> **O schema so muda por migration.** `prisma db push` nao e usado neste
> projeto: ele aplica direto, sem deixar arquivo para revisar, versionar ou
> reverter. Toda alteracao em `schema.prisma` vira uma migration com
> `npm run prisma:migrate`, que e commitada junto com o codigo.

**Banco criado antes das migrations existirem?** Registre o estado atual como
baseline, sem perder dados:

```bash
npm run db:baseline      # grava o banco atual como a migration 0_init
npm run prisma:migrate   # gera e aplica so o que falta
```

### 3. Subir

```bash
npm run dev       # servidor + cliente + Electron
npm run dev:web   # so servidor + cliente, no navegador (localhost:5173)
```

---

## Como funciona

### A arvore

Uma tabela `nodes` guarda tudo. `parent_id` e a fonte da verdade; `path`
("raiz/n1/n2") e um cache que da os ancestrais sem query e a subarvore com
`LIKE 'prefixo%'`.

### Cascata bottom-up

```
progresso(n) = 100                                    se folha concluida
             = manual(n)                              se folha com valor manual
             = Σ(peso_filho × progresso_filho) / Σ(peso_filho)   caso contrario
```

Um no com filhos **nunca** tem progresso digitado, e nao pode ser concluido
enquanto houver filha pendente. Ao concluir uma folha, o servico le o `path`
dela e recalcula do mais profundo ate a raiz — O(profundidade), nao O(arvore).

### Impacto e o Foco do Dia

A contribuicao de uma folha para a meta macro e o produto dos pesos
normalizados ao longo do caminho:

```
contrib(f) = Π (peso_a / Σ pesos dos irmaos de a)
```

A soma das contribuicoes de todas as folhas de uma raiz e exatamente 1 — ha um
teste que garante isso. O peso vem do esforco estimado quando existe, senao 1.

A fila do dia ordena por `contrib × criticidade_da_raiz × desbloqueio × aderencia`.
Tarefa bloqueada tem fator 0: nunca e a numero 1 do dia.

### Visoes: Timeline, Tabela e Kanban

A tela **Projetos** mostra a mesma arvore de tres jeitos, com o seletor no topo.
Filtros (busca, espaco, responsavel, "Em aberto/Tudo") e a tarefa selecionada
valem para as tres.

- **Tabela** (estilo Monday): cada meta macro e um grupo colorido; as tarefas
  sao linhas e as filhas abrem como subitens, em qualquer profundidade. Status,
  responsavel, prazo e criticidade se editam na celula; duplo clique renomeia.
  O rodape do grupo mostra a distribuicao por status.
- **Kanban**: as folhas (o trabalho de fato) em colunas por status. Arrastar
  para "Concluida" dispara a cascata e destrava dependentes; tirar de
  "Concluida" reabre os ancestrais. "Bloqueada" e automatica: vem das
  dependencias e nao aceita cartao solto.

As duas trocas de status passam por `POST /api/nodes/:id/status`, que decide o
caminho (`server/domain/status.ts`): concluir folha, reabrir ou gravar direto.

### Contas e login

Toda a API exige login (e-mail e senha, sessao por cookie). Cada conta ve e
mexe so nos proprios dados: as rotas conferem o dono de todo id que recebem,
na URL ou no corpo (`server/lib/dono.ts`).

- **Primeiro acesso:** a primeira conta criada herda os dados que ja estavam no
  banco, entao quem usava o app sozinho nao perde nada. Sem convite, ela so pode
  ser criada desta propria maquina (o app desktop); pela rede, exige o convite.
- **Mais contas:** so com o codigo de `CHRONOS_CONVITE` no `.env`. Sem ele, o
  cadastro fecha depois da primeira conta.
- **MCP e scripts:** usam um token de API pessoal (Configuracoes > Conta e
  acesso), passado em `CHRONOS_TOKEN`. O token le e escreve projetos, mas nao
  troca senha, nao cria outros tokens, nao apaga a conta nem transfere dados.
  Trocar a senha revoga todos os tokens.
- **Freios:** 10 tentativas de login por e-mail e 30 por cliente a cada 15 minutos.
- **Esqueceu a senha:** `echo 'senha-nova' | npm run -s conta:senha -- pessoa@exemplo.com`.

### Atualizacoes

Cada tarefa tem um feed de atualizacoes em markdown (aba **Atualizacoes** do
painel lateral, ou o balao na Tabela e no Kanban): quantas forem precisas,
com autor e data, editaveis. A descricao continua sendo o que a tarefa *e*;
o feed e o que foi *acontecendo* com ela. API em `/api/updates`.

O feed nao viaja na transferencia com o iPhone (o app de la nao tem a
tabela); ao importar um pacote, o desktop guarda as atualizacoes que ja tinha
para toda tarefa que continuar existindo.

---

## Estrutura

```
prisma/          schema, migrations, seed
shared/          contratos zod + tipos, compartilhados entre servidor e cliente
server/
  domain/        PURO — cascata, impacto, restricoes temporais, grafo. Sem I/O.
  modules/       rotas por dominio: nodes, spaces, members, focus, reports, life, user, updates
  db/            client Prisma
  scripts/       recompute, migrate-v1
src/
  features/      timeline, board (tabela e kanban), updates, focus, team, reports, life, settings
  components/ui  shadcn
  stores/        zustand (zoom, expansao, filtros, tema)
electron/        processo principal, tray, atalho global
mcp/             servidor MCP com as ferramentas de arvore
tests/domain/    vitest — 53 testes cobrindo cascata, impacto, grafo e path
```

**Regra de disciplina:** nada em `server/domain/` importa Prisma, Express ou
React. Um teste de cascata de sete niveis roda em milissegundos, sem banco.

---

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor, cliente e Electron juntos |
| `npm run dev:web` | So servidor e cliente, no navegador |
| `npm test` | Testes de dominio (vitest) |
| `npm run typecheck` | Typecheck do cliente |
| `npm run build` | Build de cliente, servidor e Electron |
| `npm run prisma:migrate` | Cria e aplica uma migration a partir do schema |
| `npm run prisma:deploy` | Aplica as migrations pendentes (producao, sem gerar) |
| `npm run prisma:status` | Mostra quais migrations faltam |
| `npm run db:baseline` | Registra um banco existente como a migration inicial |
| `npm run recompute` | Recalcula path, progresso, folhas e impacto de toda a base |
| `npm run migrate:v1` | Migra os dados da v1 (precisa de `V1_DATABASE_URL`) |
| `npm run -s mcp` | Sobe o servidor MCP (ver `mcp/README.md`) |
| `npm run conta:senha -- <email>` | Redefine a senha de uma conta (senha nova pela entrada padrao) |

Deploy em servidor (Docker + Postgres, atras de HTTPS): ver
[`deploy/DEPLOY.md`](deploy/DEPLOY.md).

---

## Migrar da v1

```bash
V1_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/chronos_flow?schema=public" \
  npm run migrate:v1
```

Cada projeto da v1 vira um espaco **e** uma meta macro; as tarefas planas viram
filhas dessa meta (nivel 1). O que nao tem destino na v2 — singularidade,
recorrencia, notas de delegacao — e preservado na descricao do no, nunca
descartado em silencio. A urgencia deixa de ser gravada: passa a ser derivada
do prazo a cada leitura.

---

## App desktop e servidores

O app instalado pergunta, na primeira abertura, **em qual servidor do Chronos
entrar**: "Este computador" (o servidor embutido, com os dados so nesta
maquina) ou um servidor na rede, como `https://flow.suaempresa.com.br`. Cada
servidor tem as proprias contas, e o login fica guardado em cada um.

- Trocar depois: "Trocar" na tela de entrada, em Configuracoes > Conta e
  acesso, ou "Trocar servidor..." no icone da barra de menus.
- Endereco novo precisa ser `https://` (so `localhost` pode ser `http`), e o
  app confere que ali responde um Chronos antes de salvar.
- A janela carrega a tela publicada pelo proprio servidor: API e tela na mesma
  origem, sem cookie entre dominios. Link para fora abre no navegador.
- O servidor embutido so sobe quando "Este computador" e o escolhido.

## Atalhos (Electron)

| Atalho | Acao |
| --- | --- |
| `⌥⌘C` | Mostra ou oculta a janela de qualquer lugar |

Fechar a janela oculta o app em vez de encerra-lo, entao reabrir e instantaneo.
O servidor sobe como processo filho gerenciado pelo processo principal, com
reinicio automatico.
