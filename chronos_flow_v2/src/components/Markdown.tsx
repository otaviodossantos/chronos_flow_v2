import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

/**
 * Markdown das atualizacoes. GFM liga tabela, checklist, tachado e link solto,
 * que e o que se escreve num feed de projeto. HTML cru fica desligado (padrao
 * do react-markdown): o texto pode vir de um agente pelo MCP, e uma tag
 * <script> ali nao deve virar codigo na tela.
 *
 * Link abre fora: no Electron o `setWindowOpenHandler` manda para o navegador
 * do sistema, em vez de trocar a tela do app pela pagina.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('markdown', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
