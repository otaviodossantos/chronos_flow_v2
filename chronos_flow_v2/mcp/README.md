# Servidor MCP — Chronos Flow v2

Ferramentas que expoem a arvore recursiva a agentes de IA. O conjunto e menor
que o da v1 porque a arvore permite composicao: `break_down` + `get_focus_queue`
fazem o que antes exigia uma dezena de chamadas.

| Ferramenta | O que faz |
| --- | --- |
| `get_tree` | Subarvore ate uma profundidade, com filtros |
| `get_node` | Um no com ancestrais, filhas e dependencias |
| `create_node` | Cria no em qualquer nivel |
| `break_down` | Quebra um no em varias filhas numa chamada |
| `complete_leaf` | Conclui e devolve a cascata resultante |
| `get_focus_queue` | Fila do dia com impacto por item |
| `simulate` | Projecao de progresso para um conjunto de folhas |
| `assign` | Delega e reporta a carga do membro |
| `get_risk_map` | Diagnostico por ramificacao |

## Como funciona

O servidor fala MCP por stdio e nao toca no banco: ele chama a API REST local,
para que a logica de cascata e prioridade viva num lugar so. Por isso **a API
precisa estar rodando** (`npm run dev:server`, ou o app desktop aberto).

## Configurar no cliente

Use `npx tsx mcp/server.ts`, e **nao** `npm run mcp`: o npm escreve o
cabecalho `> chronos-flow-v2@2.0.0 mcp` na saida padrao, que e o canal do
protocolo, e o cliente recebe lixo antes do primeiro JSON. Se preferir o
script, use `npm run -s mcp` (o `-s` silencia o npm).

Claude Code:

```bash
claude mcp add chronos -- npx tsx /caminho/para/chronos_flow_v2/mcp/server.ts
```

Claude Desktop e outros clientes com arquivo de configuracao:

```json
{
  "mcpServers": {
    "chronos": {
      "command": "npx",
      "args": ["tsx", "/caminho/para/chronos_flow_v2/mcp/server.ts"]
    }
  }
}
```

## Variaveis de ambiente

| Variavel | Padrao | Para que serve |
| --- | --- | --- |
| `CHRONOS_API` | `http://localhost:3101/api` | Endereco da API |
| `CHRONOS_ACCESS_TOKEN` | vazio | So quando a API esta em outra maquina; mesmo valor do `.env` dela |
