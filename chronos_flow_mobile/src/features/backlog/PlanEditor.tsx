import { Fragment } from 'react';
import { Trash2, RotateCcw, Users, Clock, CalendarRange, Link2 } from 'lucide-react';
import type { AiPlan, PlanTask, PlanRole } from '@shared/schemas/index';
import type { MemberDTO } from '@shared/types';
import { cn } from '@/lib/utils';
import { formatDuration, formatShortDate } from '@/lib/format';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

/**
 * Editor do rascunho. Tudo aqui e local ate o usuario mandar aplicar:
 * nenhuma tecla digitada toca o banco.
 */
export function PlanEditor({
  plan,
  members,
  window,
  onChange,
}: {
  plan: AiPlan;
  members: MemberDTO[];
  /** Janela do projeto, para situar os offsets que a IA propos. */
  window?: { start: string | null; end: string | null };
  onChange: (plan: AiPlan) => void;
}) {
  // Titulo de cada ref, para mostrar dependencia por nome e nao por codigo.
  const titleByRef = new Map<string, string>();
  const collectRefs = (tasks: PlanTask[]) => {
    for (const t of tasks) {
      if (t.ref) titleByRef.set(t.ref, t.title);
      if (t.children) collectRefs(t.children);
    }
  };
  collectRefs(plan.tasks);
  const setTaskAt = (path: number[], patch: Partial<PlanTask>) => {
    const walk = (tasks: PlanTask[], depth: number): PlanTask[] =>
      tasks.map((t, i) => {
        if (i !== path[depth]) return t;
        if (depth === path.length - 1) return { ...t, ...patch };
        return { ...t, children: walk(t.children ?? [], depth + 1) };
      });
    onChange({ ...plan, tasks: walk(plan.tasks, 0) });
  };

  const setRole = (index: number, patch: Partial<PlanRole>) =>
    onChange({
      ...plan,
      roles: plan.roles.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    });

  const countKept = (tasks: PlanTask[]): number =>
    tasks.reduce(
      (sum, t) => (t.keep === false ? sum : sum + 1 + countKept(t.children ?? [])),
      0,
    );

  const totalMinutes = (tasks: PlanTask[]): number =>
    tasks.reduce(
      (sum, t) =>
        t.keep === false
          ? sum
          : sum + (t.estimated_minutes ?? 0) + totalMinutes(t.children ?? []),
      0,
    );

  const renderTasks = (tasks: PlanTask[], path: number[] = []) =>
    tasks.map((task, i) => {
      const here = [...path, i];
      const dropped = task.keep === false;
      const depth = here.length - 1;

      return (
        <Fragment key={here.join('-')}>
          <div
            className={cn(
              'flex items-start gap-2 border-b py-2 last:border-0',
              dropped && 'opacity-40',
            )}
            style={{ paddingLeft: depth * 16 }}
          >
            <div className="min-w-0 flex-1">
              <Input
                value={task.title}
                onChange={(e) => setTaskAt(here, { title: e.target.value })}
                disabled={dropped}
                className={cn(
                  'h-7 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0',
                  depth === 0 && 'font-medium',
                  dropped && 'line-through',
                )}
              />
              {task.detail && (
                <p className="truncate text-[11px] text-muted-foreground">{task.detail}</p>
              )}
            </div>

            {task.offset_days != null && (
              <span
                className="shrink-0 font-mono text-[10px] text-muted-foreground"
                title={`Comeca no dia ${task.offset_days + 1} do projeto${
                  task.duration_days ? `, ocupa ${task.duration_days} dia(s)` : ''
                }`}
              >
                d{task.offset_days + 1}
                {task.duration_days ? `+${task.duration_days}` : ''}
              </span>
            )}

            {task.depends_on?.length ? (
              <span
                className="flex shrink-0 items-center gap-0.5 rounded bg-secondary px-1 text-[10px] text-muted-foreground"
                title={`Depois de: ${task.depends_on
                  .map((r) => titleByRef.get(r) ?? r)
                  .join(', ')}`}
              >
                <Link2 className="h-2.5 w-2.5" />
                {task.depends_on.length}
              </span>
            ) : null}

            {task.role && (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {task.role}
              </Badge>
            )}

            {task.estimated_minutes != null && (
              <div className="flex shrink-0 items-center gap-1">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <Input
                  type="number"
                  min={15}
                  step={15}
                  value={task.estimated_minutes}
                  disabled={dropped}
                  onChange={(e) =>
                    setTaskAt(here, { estimated_minutes: Number(e.target.value) || 60 })
                  }
                  className="h-7 w-16 px-1 text-center text-xs"
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => setTaskAt(here, { keep: dropped })}
              title={dropped ? 'Restaurar' : 'Descartar'}
              aria-label={dropped ? `Restaurar ${task.title}` : `Descartar ${task.title}`}
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {dropped ? <RotateCcw className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          </div>
          {!dropped && task.children?.length ? renderTasks(task.children, here) : null}
        </Fragment>
      );
    });

  return (
    <div className="space-y-4">
      {plan.summary && (
        <p className="rounded-md border-l-2 border-[hsl(var(--status-good))] bg-secondary/40 p-3 text-sm">
          {plan.summary}
        </p>
      )}

      {window?.start || window?.end ? (
        <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
          <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Janela do projeto</span>
          <span className="ml-auto font-medium">
            {window.start ? formatShortDate(window.start) : 'sem inicio'} ate{' '}
            {window.end ? formatShortDate(window.end) : 'sem entrega'}
          </span>
          {window.start && window.end && (
            <span className="font-mono text-muted-foreground">
              {Math.max(
                1,
                Math.round(
                  (new Date(window.end).getTime() - new Date(window.start).getTime()) / 86400000,
                ),
              )}
              d
            </span>
          )}
        </div>
      ) : null}

      <section>
        <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
          <span>Tarefas sugeridas</span>
          <span>
            {countKept(plan.tasks)} mantidas · {formatDuration(totalMinutes(plan.tasks))} estimadas
          </span>
        </div>
        <div className="rounded-lg border px-3">{renderTasks(plan.tasks)}</div>
      </section>

      <section>
        <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          Papeis necessarios
        </div>

        {plan.roles.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
            O modelo nao sugeriu papeis.
          </p>
        ) : (
          <div className="space-y-2">
            {plan.roles.map((role, i) => {
              const dropped = role.keep === false;
              return (
                <div
                  key={`${role.title}-${i}`}
                  className={cn('rounded-lg border p-3', dropped && 'opacity-40')}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className={cn('text-sm font-medium', dropped && 'line-through')}>
                        {role.title}
                        {(role.headcount ?? 1) > 1 && (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            ×{role.headcount}
                          </span>
                        )}
                      </div>
                      {role.description && (
                        <p className="text-[11px] text-muted-foreground">{role.description}</p>
                      )}
                      {role.hours_per_week != null && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          ~{role.hours_per_week}h por semana
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setRole(i, { keep: dropped })}
                      title={dropped ? 'Restaurar' : 'Descartar'}
                      aria-label={dropped ? `Restaurar ${role.title}` : `Descartar ${role.title}`}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {dropped ? (
                        <RotateCcw className="h-3.5 w-3.5" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <label className="text-[11px] text-muted-foreground" htmlFor={`role-${i}`}>
                      Quem assume
                    </label>
                    <Select
                      id={`role-${i}`}
                      value={role.member_id ?? ''}
                      disabled={dropped}
                      onChange={(e) => setRole(i, { member_id: e.target.value || null })}
                      className="h-7 flex-1"
                    >
                      <option value="">Ainda a definir</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                          {m.role ? ` — ${m.role}` : ''}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {plan.risks?.length ? (
        <section>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            Riscos apontados
          </div>
          <ul className="space-y-1">
            {plan.risks.map((risk, i) => (
              <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[hsl(var(--status-warning))]" />
                {risk}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
