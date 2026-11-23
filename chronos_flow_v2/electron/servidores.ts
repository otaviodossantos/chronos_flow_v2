import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/**
 * Em qual servidor do Chronos o app esta trabalhando.
 *
 * Cada servidor (este computador, o da empresa, o de um cliente) tem as
 * proprias contas e os proprios dados. O app nao mistura: a janela carrega a
 * tela que o PROPRIO servidor publica, entao API e tela sao da mesma origem,
 * e o login (cookie) fica guardado separado por servidor. Trocar de servidor
 * e trocar de origem — voltar a um deles encontra a sessao de la intacta.
 */
export interface Servidor {
  nome: string;
  url: string;
  local?: boolean;
}

interface Gravado {
  /** Origem do servidor em uso; null = perguntar na abertura. */
  atual: string | null;
  extras: Array<{ nome: string; url: string }>;
}

const arquivo = () => path.join(app.getPath('userData'), 'servidores.json');

export function ler(): Gravado {
  try {
    const d = JSON.parse(fs.readFileSync(arquivo(), 'utf8'));
    return {
      atual: typeof d.atual === 'string' ? d.atual : null,
      extras: Array.isArray(d.extras)
        ? d.extras.filter((s: unknown): s is { nome: string; url: string } =>
            Boolean(s && typeof (s as any).nome === 'string' && typeof (s as any).url === 'string'),
          )
        : [],
    };
  } catch {
    return { atual: null, extras: [] };
  }
}

export function gravar(g: Gravado) {
  fs.mkdirSync(path.dirname(arquivo()), { recursive: true });
  fs.writeFileSync(arquivo(), JSON.stringify(g, null, 2));
}

export { normalizar, conferir } from './enderecos.js';

/**
 * A tela de escolha. Pagina propria (data:), sem nada do servidor: e o que a
 * janela mostra antes de saber com quem falar. Fala com o main so pela ponte
 * `window.chronos.servidor`, e o main so atende essas acoes vindas daqui.
 */
export function paginaDoSeletor(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" />
<title>Chronos Flow — servidor</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #0a0a0a; color: #fafafa; font: 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    -webkit-app-region: drag; }
  main { width: 100%; max-width: 440px; padding: 24px; -webkit-app-region: no-drag; }
  .marca { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 20px; font-size: 18px; font-weight: 600; }
  .v { font: 10px ui-monospace, Menlo, monospace; background: #262626; color: #a3a3a3; padding: 1px 5px; border-radius: 4px; }
  .cartao { border: 1px solid #262626; background: #0f0f0f; border-radius: 10px; padding: 20px; }
  h1 { font-size: 15px; margin: 0; }
  p.sub { margin: 4px 0 16px; color: #a3a3a3; font-size: 12px; line-height: 1.5; }
  ul { list-style: none; margin: 0 0 16px; padding: 0; display: grid; gap: 8px; }
  li { display: flex; align-items: center; gap: 8px; }
  button.servidor { flex: 1; min-width: 0; text-align: left; background: #171717; border: 1px solid #262626; color: inherit;
    border-radius: 8px; padding: 10px 12px; cursor: pointer; }
  button.servidor:hover { border-color: #525252; }
  button.servidor.atual { border-color: #10b981; }
  .nome { font-weight: 600; display: block; }
  .url { color: #a3a3a3; font: 11px ui-monospace, Menlo, monospace; display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button.remover { background: none; border: 0; color: #737373; cursor: pointer; font-size: 18px; padding: 4px 8px; border-radius: 6px; }
  button.remover:hover { color: #f87171; background: #1f1f1f; }
  form { border-top: 1px solid #262626; padding-top: 16px; display: grid; gap: 8px; }
  label { font-size: 11px; color: #a3a3a3; }
  input { width: 100%; background: #0a0a0a; border: 1px solid #262626; color: inherit; border-radius: 6px; padding: 8px 10px; font: inherit; }
  input:focus { outline: none; border-color: #a3a3a3; }
  button.adicionar { background: #fafafa; color: #0a0a0a; border: 0; border-radius: 6px; padding: 9px; font-weight: 600; cursor: pointer; }
  button.adicionar:disabled { opacity: .6; cursor: wait; }
  .erro { color: #fca5a5; font-size: 12px; min-height: 16px; }
</style>
</head>
<body>
<main>
  <div class="marca">Chronos Flow <span class="v">v2</span></div>
  <div class="cartao">
    <h1>Em qual servidor voce quer entrar?</h1>
    <p class="sub">Cada servidor tem as proprias contas e projetos. O login fica guardado em cada um, entao da para trocar depois sem perder nada.</p>
    <ul id="lista"></ul>
    <form id="form">
      <label for="url">Adicionar servidor</label>
      <input id="url" placeholder="flow.suaempresa.com.br" autocomplete="off" spellcheck="false" />
      <input id="nome" placeholder="Nome (opcional), ex.: Empresa" autocomplete="off" />
      <div class="erro" id="erro"></div>
      <button class="adicionar" id="botao" type="submit">Conectar</button>
    </form>
  </div>
</main>
<script>
  const ponte = window.chronos && window.chronos.servidor;
  const lista = document.getElementById('lista');
  const erro = document.getElementById('erro');
  const limpar = (m) => String(m || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  function item(s, atual) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'servidor' + (s.url === atual ? ' atual' : '');
    b.type = 'button';
    const n = document.createElement('span'); n.className = 'nome'; n.textContent = s.nome;
    const u = document.createElement('span'); u.className = 'url'; u.textContent = s.local ? 'Os dados ficam so neste computador' : s.url;
    b.append(n, u);
    b.onclick = () => ponte.escolher(s.url).catch((e) => { erro.textContent = limpar(e.message); });
    li.append(b);
    if (!s.local) {
      const r = document.createElement('button');
      r.className = 'remover'; r.type = 'button'; r.title = 'Tirar da lista'; r.textContent = '\\u00d7';
      r.setAttribute('aria-label', 'Tirar ' + s.nome + ' da lista');
      r.onclick = async () => { await ponte.remover(s.url); desenhar(); };
      li.append(r);
    }
    return li;
  }

  async function desenhar() {
    if (!ponte) { erro.textContent = 'A ponte do app nao carregou.'; return; }
    const { atual, lista: servidores } = await ponte.listar();
    lista.replaceChildren(...servidores.map((s) => item(s, atual)));
  }

  document.getElementById('form').onsubmit = async (ev) => {
    ev.preventDefault();
    const botao = document.getElementById('botao');
    erro.textContent = '';
    botao.disabled = true; botao.textContent = 'Conferindo...';
    try {
      await ponte.adicionar({ url: document.getElementById('url').value, nome: document.getElementById('nome').value });
    } catch (e) {
      erro.textContent = limpar(e.message);
      botao.disabled = false; botao.textContent = 'Conectar';
    }
  };

  desenhar();
</script>
</body>
</html>`;
}
