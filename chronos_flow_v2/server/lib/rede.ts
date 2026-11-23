import { networkInterfaces } from 'node:os';

/** Enderecos de rede desta maquina, para dizer por onde entrar. */
export function enderecosDaRede(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((lista) => lista ?? [])
    .filter((n) => n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}
