/**
 * Contador de tentativas por chave numa janela de tempo, em memoria.
 *
 * A tentativa e contada ANTES do trabalho caro (scrypt): contar so no erro
 * deixava uma rajada de requisicoes paralelas passar inteira pela checagem
 * antes da primeira falha ser registrada.
 *
 * Em memoria porque o app roda numa instancia so. O mapa tem teto: sem ele,
 * um atacante variando e-mails o faria crescer sem limite.
 */
export class Freio {
  private readonly contagens = new Map<string, { n: number; desde: number }>();

  constructor(
    private readonly limite: number,
    private readonly janelaMs: number,
    private readonly maxChaves = 10_000,
  ) {}

  /** Registra uma tentativa; devolve false se a chave ja estourou o limite. */
  tentar(chave: string): boolean {
    const agora = Date.now();
    const atual = this.contagens.get(chave);
    if (!atual || agora - atual.desde > this.janelaMs) {
      this.contagens.delete(chave);
      this.abrirEspaco();
      this.contagens.set(chave, { n: 1, desde: agora });
      return true;
    }
    atual.n += 1;
    return atual.n <= this.limite;
  }

  /** Zera a chave (ex.: login certo depois de alguns erros). */
  liberar(chave: string) {
    this.contagens.delete(chave);
  }

  private abrirEspaco() {
    if (this.contagens.size < this.maxChaves) return;
    // Map guarda a ordem de insercao: as primeiras sao as mais antigas.
    const sobra = this.contagens.size - this.maxChaves + 1;
    let i = 0;
    for (const chave of this.contagens.keys()) {
      if (i++ >= sobra) break;
      this.contagens.delete(chave);
    }
  }
}
