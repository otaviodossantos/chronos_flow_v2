# Documento de Visão: Gerenciador de Projetos de Tarefas Recursivas

## 1. Visão Geral do Produto
O software é uma plataforma avançada de gestão de projetos projetada para resolver o problema da desconexão entre o planejamento estratégico (longo prazo) e a execução diária (curto prazo). Ele utiliza uma arquitetura de **tarefas recursivas** (infinitamente divisíveis) combinada com um motor de **progresso em cascata** e **priorização inteligente**. 

A grande inovação visual é a sua **Timeline Telescópica**, que permite visualizar desde o grande objetivo anual até a microtarefa de 15 minutos de um colaborador específico, tudo em uma única interface fluida e interativa.

---

## 2. A Interface Principal: Timeline de Múltiplos Níveis
Em vez de listas estáticas ou quadros Kanban fragmentados, o coração do software é uma linha do tempo (Timeline) altamente dinâmica.

*   **Navegação por Zoom (Efeito Telescópio):** Ao abrir o software, o gestor vê blocos longos representando as Metas de Longo Prazo ao longo dos meses. Ao clicar em um bloco, ele se expande (abre para baixo), revelando os blocos menores (tarefas filhas) que o compõem, alinhados no tempo. O usuário pode continuar clicando e expandindo até chegar às tarefas diárias.
*   **Visão de Contexto Absoluto:** Nenhuma microtarefa fica "flutuando". Na timeline, uma tarefa de 2 horas de duração sempre será mostrada visualmente aninhada "dentro" do grande bloco da sua meta superior.
*   **Drag-and-Drop Temporal:** Ajustar o prazo de uma Meta de Longo Prazo pode alertar ou mover automaticamente as tarefas filhas para garantir que os prazos não sejam violados.

---

## 3. Arquitetura de Tarefas (Encadeamento Recursivo)
A quebra de trabalho funciona de maneira orgânica, sem limite de níveis (Epics, Features, ou Stories são substituídos por um sistema infinito de Pai e Filho).

*   **Metas de Longo Prazo (Nível 0):** O topo da cadeia. O objetivo macro do projeto.
*   **Microtarefas Recursivas:** Toda tarefa pode ter subtarefas. O usuário quebra o problema até chegar a ações executáveis.
*   **Progresso Bottom-Up (Cascata Ascendente):** É impossível concluir uma tarefa Pai manualmente se ela tiver tarefas Filhas pendentes. Quando um membro da equipe dá *check* na menor tarefa da cadeia, o sistema calcula o peso dessa tarefa e atualiza a barra de progresso de todas as tarefas acima dela na hierarquia, chegando até a meta final.

---

## 4. Gestão de Equipe e Delegação
O software foi desenhado para escalar do uso individual para equipes complexas, permitindo a distribuição clara de responsabilidades.

*   **Delegação Flexível:** Você pode atribuir responsáveis (Assignees) a qualquer nível da árvore. 
    *   *Exemplo:* O "Diretor" é o responsável pela Meta Macro. O "Gerente" é responsável pela Tarefa Nível 1. O "Analista" é responsável pelas Microtarefas Nível 2 e 3.
*   **Quebra e Repasse:** Um funcionário que recebe uma tarefa de médio prazo pode, ele mesmo, quebrar essa tarefa em etapas menores e delegar partes dela para seus próprios subordinados ou colegas, criando sub-ramificações de responsabilidade.
*   **Notificações de Dependência:** Se a microtarefa do "Usuário A" estiver atrasada e isso comprometer a tarefa pai do "Usuário B", o sistema alerta ambos automaticamente.

---

## 5. Algoritmo de Priorização Dinâmica
Com milhares de tarefas na árvore, saber o que fazer hoje pode ser difícil. O sistema faz esse cálculo automaticamente.

*   **Cálculo de Impacto:** O software entende quais metas de longo prazo têm prazos mais apertados ou prioridades maiores marcadas pela diretoria.
*   **O "Foco do Dia":** Para o executor (quem vai botar a mão na massa), o software oferece um painel paralelo chamado *Modo Foco*. Ele puxa as tarefas mais profundas da árvore (as "folhas") que estão atribuídas àquela pessoa e as ordena. A tarefa nº 1 do dia será aquela que, ao ser concluída, destrava o maior progresso na Meta de Longo Prazo mais urgente da empresa.

---

## 6. Sistema de Filtros e Visualizações
Para que a Timeline gigante não fique caótica, o sistema conta com um motor de filtros robusto, permitindo fatiar os dados de múltiplas formas:

*   **Filtro por Pessoa:** Selecione "João" para ocultar o resto da empresa e ver na timeline apenas as ramificações onde João tem tarefas, entendendo perfeitamente o impacto do trabalho dele no todo.
*   **Filtro por Projeto:** Isole a visualização para mostrar apenas as árvores pertencentes a um escopo específico (Ex: "Campanha de Marketing Q3").
*   **Filtro por Status:** Esconda tudo que já foi concluído e mostre apenas a timeline de tarefas "Em Andamento" ou "Atrasadas".
*   **Nível de Profundidade:** Um botão rápido para "Expandir apenas até o Nível 2", permitindo que os diretores vejam um resumo, enquanto os gerentes podem "Expandir até o Nível 5" para ver os detalhes da operação.