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

Configure no cliente MCP apontando para `npm run mcp` nesta pasta, com a API
rodando em `http://localhost:3101`.
