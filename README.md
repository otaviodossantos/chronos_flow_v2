# Chronos Flow v2

Gestao de projetos com **tarefas recursivas**, **progresso em cascata bottom-up**
e **timeline telescopica** — em duas frentes que compartilham o mesmo dominio.

| Pasta | O que e | Stack |
| --- | --- | --- |
| [`chronos_flow_v2/`](chronos_flow_v2/) | App desktop (Electron) + servidor local | React, Express, Prisma, PostgreSQL |
| [`chronos_flow_mobile/`](chronos_flow_mobile/) | App de iPhone, tudo no aparelho | React, Capacitor, Drizzle, SQLite, Swift (widgets / Live Activity) |

## Por que as duas pastas ficam juntas

O app de iPhone importa a logica de dominio e os tipos **direto do desktop**, por
alias de build, sem copia:

- `@core/*` → `chronos_flow_v2/server/domain`
- `@shared/*` → `chronos_flow_v2/shared`
- `@ia/*` → `chronos_flow_v2/server/modules/ai`

Os caminhos sao relativos (`../chronos_flow_v2`), entao as duas pastas precisam
continuar lado a lado.

## Como comecar

```bash
# desktop
cd chronos_flow_v2
cp .env.example .env      # ajuste DATABASE_URL
npm install
npm run db:setup
npm run dev

# iPhone (precisa do chronos_flow_v2 ao lado)
cd chronos_flow_mobile
npm install
npm run dev
```

Detalhes em [`chronos_flow_v2/README.md`](chronos_flow_v2/README.md) e
[`chronos_flow_mobile/README.md`](chronos_flow_mobile/README.md).

## Licenca

Copyright (c) 2026 Otávio dos Santos.

Distribuido sob a [PolyForm Noncommercial 1.0.0](LICENSE):

- **Liberado:** uso pessoal, estudo, pesquisa, projetos de hobby e uso por
  ONGs, instituicoes de ensino e orgaos publicos. Pode copiar, modificar e
  compartilhar, mantendo o aviso de copyright e o texto da licenca.
- **Nao liberado:** qualquer uso comercial — vender, embutir em produto pago ou
  usar dentro de uma empresa — sem autorizacao.

Quer usar comercialmente? Abra uma
[issue](https://github.com/otaviodossantos/chronos_flow_v2/issues) para
conversarmos sobre uma licenca comercial.

## v1

A versao anterior (tabela plana de tarefas) vive em um repositorio separado:
[otaviodossantos/chronos_flow](https://github.com/otaviodossantos/chronos_flow).
A v2 traz um script de migracao: `npm run migrate:v1`.
