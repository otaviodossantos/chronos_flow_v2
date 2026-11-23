/**
 * Redefine a senha de uma conta, para quem tem acesso ao servidor. Nao ha
 * e-mail de recuperacao: este e o caminho quando alguem esquece a senha.
 *
 *   echo 'senha-nova' | npx tsx server/scripts/senha.ts pessoa@exemplo.com
 *   # no container:  echo 'senha-nova' | docker exec -i chronos node dist-server/server/scripts/senha.js pessoa@exemplo.com
 *
 * A senha vem pela entrada padrao para nao ficar no historico do shell nem na
 * lista de processos. Todas as sessoes e tokens de API da conta sao encerrados.
 */
import { prisma } from '../db/client.js';
import { hashSenha } from '../lib/senha.js';

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!email) throw new Error('Informe o e-mail da conta: senha.ts pessoa@exemplo.com');

  let entrada = '';
  for await (const parte of process.stdin) entrada += parte;
  const senha = entrada.replace(/\r?\n$/, '');
  if (senha.length < 8) throw new Error('A senha nova precisa de pelo menos 8 caracteres (via entrada padrao).');

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`Nenhuma conta com o e-mail ${email}.`);

  await prisma.user.update({ where: { id: user.id }, data: { password_hash: await hashSenha(senha) } });
  const sessoes = await prisma.session.deleteMany({ where: { user_id: user.id } });
  const tokens = await prisma.apiToken.deleteMany({ where: { user_id: user.id } });
  console.log(
    `Senha de ${email} redefinida. ${sessoes.count} sessao(oes) encerrada(s), ${tokens.count} token(s) de API revogado(s).`,
  );
}

main()
  .catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
