import { describe, expect, it } from 'vitest';
import type { MemberDTO } from '@shared/types';
import type { Contato } from '../src/native/chronos';
import {
  chaveDoNome, corPara, CORES_DE_MEMBRO, filtrarContatos, jaCadastrado,
} from '../src/features/team/daAgenda';

const membro = (name: string, email: string | null = null) =>
  ({ id: name, name, email } as MemberDTO);

const contato = (nome: string, email = '', telefone = ''): Contato =>
  ({ id: nome, nome, email, telefone });

describe('pessoas vindas da agenda do iPhone', () => {
  it('iguala nomes com acento, caixa e espaco sobrando', () => {
    expect(chaveDoNome(' João  Pedro ')).toBe(chaveDoNome('joao pedro'));
    expect(chaveDoNome('MARIANA ALBUQUERQUE')).toBe(chaveDoNome('Mariana Albuquerque'));
    expect(chaveDoNome('Camila')).not.toBe(chaveDoNome('Camilo'));
  });

  it('reconhece quem ja esta no time pelo email, mesmo com outro nome', () => {
    // Na agenda ela e "Mari"; no sistema, "Mariana Albuquerque". O email e o
    // unico identificador de verdade aqui.
    const time = [membro('Mariana Albuquerque', 'mariana@empresa.test')];
    expect(jaCadastrado(contato('Mari', 'MARIANA@empresa.test'), time)).toBe(true);
  });

  it('reconhece pelo nome quando nao ha email dos dois lados', () => {
    const time = [membro('João Pedro')];
    expect(jaCadastrado(contato('joao pedro'), time)).toBe(true);
    expect(jaCadastrado(contato('Joana Pedrosa'), time)).toBe(false);
  });

  it('nao confunde pessoas diferentes que so tem telefone', () => {
    const time = [membro('Henrique Oliveira')];
    expect(jaCadastrado(contato('Camila Nogueira', '', '+55 48 99999-0000'), time)).toBe(false);
  });

  it('contato sem nome nenhum nao vira "ja existe" por engano', () => {
    // Um contato so com telefone volta da agenda com nome vazio. Comparar
    // vazio com vazio marcaria todo mundo como repetido.
    const time = [membro('')];
    expect(jaCadastrado(contato(''), time)).toBe(false);
  });

  it('da uma cor diferente a cada pessoa e volta ao inicio ao fim da lista', () => {
    const cores = CORES_DE_MEMBRO.map((_, i) => corPara(i));
    expect(new Set(cores).size).toBe(CORES_DE_MEMBRO.length);
    expect(corPara(CORES_DE_MEMBRO.length)).toBe(corPara(0));
    // Indice negativo nao pode virar `undefined` no campo de cor.
    expect(corPara(-1)).toBe(CORES_DE_MEMBRO[CORES_DE_MEMBRO.length - 1]);
  });

  describe('busca na agenda', () => {
    const agenda = [
      contato('Mariana Albuquerque', 'mariana@empresa.test', '+55 48 99111-2233'),
      contato('João Pedro', '', '+55 48 98222-3344'),
      contato('Camila Nogueira Santos', 'camila@exemplo.com.br'),
      contato('Ação Fitness Academia'),
    ];

    it('acha pelo nome ignorando acento e caixa', () => {
      expect(filtrarContatos(agenda, 'joao').map((c) => c.nome)).toEqual(['João Pedro']);
      expect(filtrarContatos(agenda, 'ACAO').map((c) => c.nome)).toEqual(['Ação Fitness Academia']);
    });

    it('acha no meio do nome, nao so no comeco', () => {
      // A lista do iOS so ajuda quem lembra a inicial; aqui "albuquerque"
      // tambem encontra.
      expect(filtrarContatos(agenda, 'albuquerque')).toHaveLength(1);
      expect(filtrarContatos(agenda, 'nogueira')).toHaveLength(1);
    });

    it('acha pelo email', () => {
      expect(filtrarContatos(agenda, 'exemplo.com').map((c) => c.nome)).toEqual([
        'Camila Nogueira Santos',
      ]);
    });

    it('acha pelo telefone, sem se importar com a formatacao', () => {
      expect(filtrarContatos(agenda, '48 99111').map((c) => c.nome)).toEqual([
        'Mariana Albuquerque',
      ]);
      expect(filtrarContatos(agenda, '4898222').map((c) => c.nome)).toEqual(['João Pedro']);
    });

    it('nao casa meia agenda com dois digitos soltos', () => {
      expect(filtrarContatos(agenda, '48')).toHaveLength(0);
    });

    it('busca vazia devolve a agenda inteira', () => {
      expect(filtrarContatos(agenda, '   ')).toHaveLength(agenda.length);
    });
  });
});
