-- Teto de tarefas que a IA pode propor para um item do backlog, somando todos
-- os niveis da arvore. Nulo e o padrao e significa "sem teto": o modelo decide
-- quantas tarefas o trabalho pede, como fazia antes desta coluna existir.
ALTER TABLE "backlog_items" ADD COLUMN "max_tasks" INTEGER;
