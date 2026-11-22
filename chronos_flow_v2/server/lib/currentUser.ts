import { prisma } from '../db/client.js';

/**
 * App local single-user: ha exatamente um usuario, criado no primeiro acesso.
 * Isolado aqui para que trocar por autenticacao mais tarde toque um arquivo so.
 */
let cached: string | null = null;

export async function currentUserId(): Promise<string> {
  if (cached) return cached;
  const existing = await prisma.user.findFirst({ orderBy: { created_at: 'asc' } });
  if (existing) {
    cached = existing.id;
    return existing.id;
  }
  const created = await prisma.user.create({
    data: { name: 'Voce', birth_date: new Date('1990-01-01T00:00:00.000Z') },
  });
  cached = created.id;
  return created.id;
}

export function resetUserCache() {
  cached = null;
}
