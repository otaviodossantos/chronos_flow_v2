-- Despertador por tarefa, um recurso do iPhone.
--
-- A coluna existe aqui sem nenhuma tela que a edite: o pacote de
-- transferencia leva as colunas que o schema declara, e uma coluna a mais de
-- um lado so faria a importacao recusar a primeira linha. Simetria entre os
-- dois bancos e o que mantem a transferencia funcionando nos dois sentidos.
ALTER TABLE "nodes" ADD COLUMN "alarme" BOOLEAN NOT NULL DEFAULT false;
