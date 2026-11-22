# Banco de dados

## Regra

**O schema so muda por migration.** `prisma db push` nao e usado aqui.

`push` aplica a diferenca direto no banco e nao deixa arquivo nenhum: nao da
para revisar em code review, nao entra no histórico do git, e nao existe
caminho de volta. Numa base com dados reais isso e um risco sem contrapartida.

## Fluxo normal

1. Edite `prisma/schema.prisma`.
2. `npm run prisma:migrate` — o Prisma gera `prisma/migrations/<data>_<nome>/migration.sql`,
   aplica no banco de desenvolvimento e regenera o client.
3. Leia o SQL gerado antes de commitar. Renomeacoes de coluna, por exemplo,
   o Prisma costuma interpretar como "apaga e cria", o que perde dados —
   nesse caso edite o SQL para um `ALTER TABLE ... RENAME COLUMN`.
4. Commite a pasta da migration junto com a mudanca no schema.

## Em producao

```bash
npm run prisma:deploy
```

Aplica as migrations pendentes sem gerar nada novo e sem prompts.
`npm run prisma:status` mostra o que falta antes de aplicar.

## Banco anterior as migrations

Um banco criado com `db push` nao tem a tabela `_prisma_migrations`, entao o
Prisma o considera fora de sincronia e oferece resetar — o que apagaria tudo.
Para adota-lo sem perder dados:

```bash
npm run db:baseline
```

O script pede ao proprio Prisma o SQL que recria o banco **como ele esta
agora**, salva como `migrations/0_init` e marca essa migration como aplicada.
Nenhum comando roda no banco. Depois disso, `npm run prisma:migrate` gera
apenas o delta que falta.

## Comandos que nao devem ser usados

| Comando | Por que |
| --- | --- |
| `prisma db push` | Sem historico, sem revisao, sem volta |
| `prisma migrate reset` | Apaga o banco inteiro. So em desenvolvimento descartavel, e conscientemente |
