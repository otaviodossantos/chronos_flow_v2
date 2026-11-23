import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Eye, Pencil, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { NodeUpdateDTO } from '@shared/types';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { DictationTextarea } from '@/components/DictationTextarea';
import { Markdown } from '@/components/Markdown';

/**
 * Feed de atualizacoes da tarefa, como o painel "Updates" do Monday: quantas
 * a tarefa precisar, em markdown, a mais nova em cima. A descricao continua
 * sendo o que a tarefa E; aqui fica o que foi ACONTECENDO com ela.
 */
export function UpdatesPanel({ nodeId }: { nodeId: string }) {
  const queryClient = useQueryClient();
  const { data: updates = [], isLoading } = useQuery({
    queryKey: ['updates', nodeId],
    queryFn: () => api.updates(nodeId),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['updates', nodeId] });
    // O balao com a contagem mora na arvore e no detalhe.
    queryClient.invalidateQueries({ queryKey: ['tree'] });
    queryClient.invalidateQueries({ queryKey: ['node', nodeId] });
  };

  return (
    <div className="flex flex-col">
      <Composer nodeId={nodeId} onPosted={refresh} />

      <div className="space-y-3 p-4 pt-0">
        {isLoading && <p className="text-xs text-muted-foreground">Carregando...</p>}
        {!isLoading && updates.length === 0 && (
          <div className="rounded-md border border-dashed p-6 text-center">
            <p className="text-sm font-medium">Nenhuma atualizacao ainda</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Registre andamento, decisoes, links e pendencias. Um agente pelo MCP escreve aqui
              tambem.
            </p>
          </div>
        )}
        {updates.map((u) => (
          <UpdateCard key={u.id} update={u} onChanged={refresh} />
        ))}
      </div>
    </div>
  );
}

function Composer({ nodeId, onPosted }: { nodeId: string; onPosted: () => void }) {
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(false);

  const post = useMutation({
    mutationFn: () => api.createUpdate(nodeId, body.trim()),
    onSuccess: () => {
      setBody('');
      setPreview(false);
      onPosted();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const submit = () => {
    if (body.trim() && !post.isPending) post.mutate();
  };

  return (
    <div className="border-b p-4">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Nova atualizacao
        </span>
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          disabled={!body.trim()}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          {preview ? <Pencil className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          {preview ? 'Escrever' : 'Visualizar'}
        </button>
      </div>

      {preview ? (
        <div className="min-h-[96px] rounded-md border bg-muted/30 px-3 py-2">
          <Markdown>{body}</Markdown>
        </div>
      ) : (
        <DictationTextarea
          value={body}
          onChange={setBody}
          rows={4}
          placeholder="Escreva em markdown: **negrito**, - listas, - [ ] checklist, `codigo`, [link](https://...)"
          className="resize-y text-[13px]"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
      )}

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {isMac() ? '⌘' : 'Ctrl'}+Enter publica
        </span>
        <Button size="xs" onClick={submit} disabled={!body.trim() || post.isPending}>
          <Send className="h-3 w-3" />
          {post.isPending ? 'Publicando...' : 'Publicar'}
        </Button>
      </div>
    </div>
  );
}

/** Atalho de teclado, nao semaforo de janela: vale tambem no navegador do Mac. */
const isMac = () => /mac/i.test(navigator.platform || navigator.userAgent);

/** Cor estavel por autor: a mesma pessoa (ou agente) tem sempre a mesma bolinha. */
function authorColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 48%)`;
}

const pareceAgente = (author: string) => /\b(ia|mcp|agente|claude|bot)\b/i.test(author);

function UpdateCard({ update, onChanged }: { update: NodeUpdateDTO; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(update.body);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = useMutation({
    mutationFn: () => api.editUpdate(update.id, draft.trim()),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteUpdate(update.id),
    onSuccess: onChanged,
    onError: (e: ApiError) => toast.error(e.message),
  });

  const agente = pareceAgente(update.author);

  return (
    <article className="group rounded-md border bg-card">
      <header className="flex items-center gap-2 px-3 pt-2.5">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
          style={{ backgroundColor: authorColor(update.author) }}
        >
          {agente ? <Bot className="h-3.5 w-3.5" /> : update.author.slice(0, 2).toUpperCase()}
        </span>
        <span className="truncate text-xs font-medium">{update.author}</span>
        <span
          className="shrink-0 text-[11px] text-muted-foreground"
          title={formatDateTime(update.created_at)}
        >
          {formatRelativeTime(update.created_at)}
          {update.edited && ' · editado'}
        </span>

        {!editing && (
          <span className="ml-auto flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={() => {
                setDraft(update.body);
                setEditing(true);
              }}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Editar atualizacao"
              title="Editar"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
              aria-label="Excluir atualizacao"
              title="Excluir"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </header>

      <div className="px-3 pb-3 pt-1.5">
        {editing ? (
          <>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              autoFocus
              className="text-[13px]"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && draft.trim()) save.mutate();
                if (e.key === 'Escape') setEditing(false);
              }}
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button size="xs" variant="outline" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
              <Button
                size="xs"
                onClick={() => save.mutate()}
                disabled={!draft.trim() || save.isPending}
              >
                Salvar
              </Button>
            </div>
          </>
        ) : (
          <Markdown>{update.body}</Markdown>
        )}

        {confirmDelete && (
          <div
            className={cn(
              'mt-2 flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs',
            )}
          >
            <span>Excluir esta atualizacao?</span>
            <span className="flex gap-1.5">
              <Button size="xs" variant="outline" onClick={() => setConfirmDelete(false)}>
                Nao
              </Button>
              <Button
                size="xs"
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Excluir
              </Button>
            </span>
          </div>
        )}
      </div>
    </article>
  );
}
