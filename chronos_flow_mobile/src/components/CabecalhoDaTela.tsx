/**
 * O cabecalho das telas de conteudo.
 *
 * O desktop abre cada tela com um bloco de apresentacao: uma sobrancalha em
 * maiusculas, um titulo de 30px e um paragrafo explicando o que a tela faz.
 * Numa tela de 1440px isso custa nada; nas de 390 custava entre 150 e 200
 * pixels — um quinto da altura util — para dizer o que a aba acesa no rodape
 * ja dizia. A conta e cruel no Foco e nos Relatorios, onde o conteudo que
 * importa comecava abaixo da dobra.
 *
 * Aqui sobra um titulo curto, uma linha de nota e o lugar de uma acao. Fica
 * grudado no topo porque, rolando uma lista longa, saber onde se esta custa
 * 44px e vale mais que eles.
 */
export function CabecalhoDaTela({
  titulo,
  nota,
  contagem,
  acao,
}: {
  titulo: string;
  /** Uma linha, no maximo. O que nao couber aqui nao precisava ser dito. */
  nota?: string;
  contagem?: React.ReactNode;
  acao?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 shrink-0 border-b bg-background/95 px-3 py-2 backdrop-blur">
      <div className="flex items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">{titulo}</h1>
        {contagem}
        {acao}
      </div>
      {nota && (
        <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">{nota}</p>
      )}
    </header>
  );
}
