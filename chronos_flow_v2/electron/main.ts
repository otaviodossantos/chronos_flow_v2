import {
  app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, shell, ipcMain, screen, Notification,
  session, systemPreferences,
} from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as servidores from './servidores.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const API_PORT = Number(process.env.PORT ?? 3101);

let mainWindow: BrowserWindow | null = null;
let floatingWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverProcess: ChildProcess | null = null;
let quitting = false;

/**
 * O servidor sobe como processo filho gerenciado pelo main: na v1 ele dependia
 * do `concurrently` em dev e de o usuario nao fecha-lo.
 */
function startServer() {
  if (isDev) return; // em dev, `npm run dev` ja cuida disso
  if (serverProcess) return; // ja de pe
  const entry = path.join(__dirname, '..', 'dist-server', 'server', 'index.js');
  serverProcess = spawn(process.execPath, [entry], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(API_PORT) },
    stdio: 'inherit',
  });
  serverProcess.on('exit', (code) => {
    serverProcess = null;
    if (!quitting) {
      console.error(`Servidor caiu (codigo ${code}). Reiniciando em 2s...`);
      setTimeout(startServer, 2000);
    }
  });
}

async function waitForApi(retries = 40): Promise<boolean> {
  for (let i = 0; i < retries; i += 1) {
    try {
      const res = await fetch(`http://localhost:${API_PORT}/api/health`);
      if (res.ok) return true;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Servidores. "Este computador" e o servidor embutido (no desenvolvimento, o
 * Vite do `npm run dev`). Os outros sao os que a pessoa adicionou.
 */
const LOCAL: servidores.Servidor = {
  nome: 'Este computador',
  url: isDev ? 'http://localhost:5173' : `http://localhost:${API_PORT}`,
  local: true,
};

function listaDeServidores(): servidores.Servidor[] {
  return [LOCAL, ...servidores.ler().extras];
}

function servidorAtual(): servidores.Servidor | null {
  const { atual } = servidores.ler();
  return listaDeServidores().find((s) => s.url === atual) ?? null;
}

const mesmaOrigem = (a: string, b: string) => {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
};

/** So http(s) e e-mail saem para o sistema: a pagina e de um servidor remoto. */
function abrirFora(url: string) {
  if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url);
}

function mostrarSeletor() {
  if (!mainWindow) return;
  if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.close();
  void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(servidores.paginaDoSeletor())}`);
}

async function abrirServidor(s: servidores.Servidor) {
  if (!mainWindow) return;
  // O servidor embutido so sobe quando e ele o escolhido: quem trabalha so
  // num servidor remoto nao precisa de Postgres nesta maquina.
  if (s.local && !isDev) {
    startServer();
    await waitForApi();
  }
  // A widget e da sessao do servidor anterior.
  if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.close();
  await mainWindow.loadURL(s.url);
}

function iniciarNoServidor() {
  const atual = servidorAtual();
  if (atual) void abrirServidor(atual);
  else mostrarSeletor();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // Os semaforos dividem a linha de 48px da marca na sidebar: 18px de topo
    // centra os tres nela, e 19px de recuo e o respiro padrao do macOS.
    trafficLightPosition: process.platform === 'darwin' ? { x: 19, y: 18 } : undefined,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      // CommonJS (.cjs): o projeto e ESM, e preload ESM so carrega como .mjs.
      // Como .js, a ponte simplesmente nao subia — window.chronos ficava vazio.
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  iniciarNoServidor();

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Fechar oculta em vez de encerrar: reabrir custa 0 segundos.
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
      if (process.platform === 'darwin') app.dock?.hide();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    abrirFora(url);
    return { action: 'deny' };
  });

  // A janela fica no servidor escolhido: link para fora abre no navegador,
  // nunca troca a tela do app por outro site.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const atual = servidorAtual();
    if (url.startsWith('data:') || (atual && mesmaOrigem(url, atual.url))) return;
    event.preventDefault();
    abrirFora(url);
  });
}

function toggleWindow() {
  if (!mainWindow) return createWindow();
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
    if (process.platform === 'darwin') app.dock?.hide();
  } else {
    if (process.platform === 'darwin') app.dock?.show();
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(
    path.join(__dirname, '..', 'resources', 'trayTemplate.png'),
  );
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Chronos Flow');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir Chronos Flow', click: toggleWindow },
      { label: 'Widget de foco', accelerator: 'Alt+Command+F', click: () => createFloatingWindow() },
      {
        label: 'Trocar servidor...',
        click: () => {
          if (!mainWindow) createWindow();
          mostrarSeletor();
          if (process.platform === 'darwin') app.dock?.show();
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'Iniciar com o sistema',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }),
      },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', toggleWindow);
}


const FLOATING_DEFAULT = { width: 320, height: 152 };

/**
 * Janela do widget de foco: sem moldura, fundo transparente, sempre no topo
 * e presente em todos os espacos — inclusive sobre apps em tela cheia.
 */
function applyFloatingAttributes(win: BrowserWindow) {
  try {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (process.platform === 'darwin') win.setWindowButtonVisibility?.(false);
  } catch (err) {
    console.warn('[widget] nao foi possivel fixar a janela no topo:', err);
  }
}

function createFloatingWindow(initialNode?: unknown): BrowserWindow | null {
  try {
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      applyFloatingAttributes(floatingWindow);
      if (floatingWindow.isMinimized()) floatingWindow.restore();
      floatingWindow.show();
      if (initialNode) {
        floatingWindow.webContents.send('chronos:sync-active-node', initialNode);
      }
      return floatingWindow;
    }

    const { width: screenWidth, x: screenX, y: screenY } = screen.getPrimaryDisplay().workArea;

    floatingWindow = new BrowserWindow({
      width: FLOATING_DEFAULT.width,
      height: FLOATING_DEFAULT.height,
      x: Math.round(screenX + screenWidth - FLOATING_DEFAULT.width - 20),
      y: Math.round(screenY + 40),
      minWidth: 200,
      minHeight: 40,
      maxWidth: 480,
      maxHeight: 220,
      frame: false,
      transparent: true,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: true,
      show: false,
      backgroundColor: '#00000000',
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      type: process.platform === 'darwin' ? 'panel' : undefined,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });

    applyFloatingAttributes(floatingWindow);

    // Mesmo servidor da janela principal: e de la que vem a sessao.
    const base = servidorAtual()?.url ?? LOCAL.url;
    void floatingWindow.loadURL(`${base}/?window=floating#floating`);

    floatingWindow.webContents.on('did-finish-load', () => {
      if (!floatingWindow || floatingWindow.isDestroyed()) return;
      floatingWindow.show();
      applyFloatingAttributes(floatingWindow);
      if (initialNode) floatingWindow.webContents.send('chronos:sync-active-node', initialNode);
    });

    floatingWindow.on('closed', () => {
      floatingWindow = null;
    });

    return floatingWindow;
  } catch (err) {
    console.error('[widget] falha ao criar a janela flutuante:', err);
    return null;
  }
}

ipcMain.handle('chronos:open-floating-widget', (_e, node) => !!createFloatingWindow(node));

ipcMain.handle('chronos:close-floating-widget', () => {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.close();
    floatingWindow = null;
    return true;
  }
  return false;
});

ipcMain.handle('chronos:resize-floating-widget', (_e, { width, height }) => {
  if (!floatingWindow || floatingWindow.isDestroyed()) return false;
  floatingWindow.setSize(Math.round(width), Math.round(height), true);
  return true;
});

ipcMain.handle('chronos:open-main-window', () => {
  if (!mainWindow) createWindow();
  else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (process.platform === 'darwin') app.dock?.show();
    mainWindow.show();
    mainWindow.focus();
  }
  return true;
});

// Espelha a tarefa ativa entre a janela principal e o widget, sem eco no remetente.
ipcMain.on('chronos:sync-active-node', (event, node) => {
  for (const win of [mainWindow, floatingWindow]) {
    if (win && !win.isDestroyed() && event.sender !== win.webContents) {
      win.webContents.send('chronos:sync-active-node', node);
    }
  }
});

ipcMain.on('chronos:tree-changed', (event, from) => {
  for (const win of [mainWindow, floatingWindow]) {
    if (win && !win.isDestroyed() && event.sender !== win.webContents) {
      win.webContents.send('chronos:tree-changed', from);
    }
  }
});

/**
 * O estado do microfone no sistema, para a tela poder dizer o que fazer em vez
 * de repetir "permissao negada" sem saida. `appName` e o nome que aparece na
 * lista das Configuracoes — em desenvolvimento e "Electron", nao o do app.
 */
ipcMain.handle('chronos:microphone-status', () => ({
  status:
    process.platform === 'darwin'
      ? systemPreferences.getMediaAccessStatus('microphone')
      : 'granted',
  appName: app.getName(),
}));

/** Abre direto o painel de Microfone das Configuracoes do Sistema. */
ipcMain.handle('chronos:open-microphone-settings', async () => {
  if (process.platform !== 'darwin') return false;
  await shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  );
  return true;
});

ipcMain.on('chronos:notify', (_e, { title, subtitle, body }) => {
  if (!Notification.isSupported()) return;
  new Notification({ title, subtitle, body, silent: false }).show();
});

ipcMain.on('chronos:bounce-dock', (_e, { type }) => {
  if (process.platform === 'darwin') app.dock?.bounce(type ?? 'informational');
});

ipcMain.handle('chronos:open-external', (_e, url: string) => abrirFora(String(url)));

/**
 * Servidores. Consultar e pedir a troca vale de qualquer pagina (a tela de
 * entrada mostra "Servidor: X · Trocar"). Escolher, adicionar e remover so
 * vindo da tela de escolha: a pagina de um servidor remoto nao pode mandar o
 * app para outro servidor por conta propria.
 */
const daTelaDeEscolha = (e: Electron.IpcMainInvokeEvent) =>
  Boolean(e.senderFrame?.url.startsWith('data:text/html'));

const SO_DA_ESCOLHA = 'Acao so da tela de escolha de servidor.';

ipcMain.handle('chronos:servidor-atual', () => servidorAtual());
ipcMain.handle('chronos:trocar-servidor', () => mostrarSeletor());
ipcMain.handle('chronos:servidores', (e) => {
  if (!daTelaDeEscolha(e)) throw new Error(SO_DA_ESCOLHA);
  return { atual: servidores.ler().atual, lista: listaDeServidores() };
});
ipcMain.handle('chronos:escolher-servidor', async (e, url: string) => {
  if (!daTelaDeEscolha(e)) throw new Error(SO_DA_ESCOLHA);
  const alvo = listaDeServidores().find((s) => s.url === url);
  if (!alvo) throw new Error('Servidor fora da lista.');
  servidores.gravar({ ...servidores.ler(), atual: alvo.url });
  await abrirServidor(alvo);
});
ipcMain.handle('chronos:adicionar-servidor', async (e, dados: { url: string; nome?: string }) => {
  if (!daTelaDeEscolha(e)) throw new Error(SO_DA_ESCOLHA);
  const url = servidores.normalizar(String(dados?.url ?? ''));
  await servidores.conferir(url);
  const nome = String(dados?.nome ?? '').trim().slice(0, 60) || new URL(url).hostname;
  const g = servidores.ler();
  const extras = g.extras.filter((s) => s.url !== url);
  if (url !== LOCAL.url) extras.push({ nome, url });
  servidores.gravar({ atual: url, extras });
  await abrirServidor(listaDeServidores().find((s) => s.url === url) ?? LOCAL);
});
ipcMain.handle('chronos:remover-servidor', (e, url: string) => {
  if (!daTelaDeEscolha(e)) throw new Error(SO_DA_ESCOLHA);
  const g = servidores.ler();
  servidores.gravar({
    atual: g.atual === url ? null : g.atual,
    extras: g.extras.filter((s) => s.url !== url),
  });
});

/**
 * No macOS o microfone tem dois portoes, e so o primeiro estava sendo aberto.
 *
 * O do Chromium e este handler de permissao. O do sistema e o TCC, e so a
 * propria aplicacao pode bate-lo — dizer "sim" ao Chromium sem passar por ele
 * faz o getUserMedia falhar como "permissao negada" sem que nada chegue a ser
 * perguntado. Pior: uma vez negado no sistema, negado fica; nenhum pedido novo
 * reabre o dialogo, e dai o ditado recusar sempre, para sempre.
 */
async function liberarMicrofone(): Promise<boolean> {
  if (process.platform !== 'darwin') return true;

  const status = systemPreferences.getMediaAccessStatus('microphone');
  // Registrado sempre: "o microfone nao funciona" e indistinguivel de fora, e
  // esta linha separa os quatro casos possiveis em uma olhada.
  console.log(`[chronos] microfone: o sistema responde "${status}"`);

  if (status === 'granted') return true;

  // 'not-determined' e a unica situacao em que o sistema ainda pergunta.
  if (status === 'not-determined') {
    const liberado = await systemPreferences.askForMediaAccess('microphone');
    console.log(`[chronos] microfone: o dialogo do sistema respondeu ${liberado ? 'sim' : 'nao'}`);
    return liberado;
  }

  console.log('[chronos] microfone: bloqueado no sistema, so as Configuracoes resolvem');
  return false;
}

app.whenReady().then(async () => {
  // Na sessao padrao, e nao na janela: a flutuante nasce depois e usa a mesma.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    console.log(`[chronos] permissao pedida pela tela: ${permission}`);
    if (permission !== 'media') return callback(false);
    void liberarMicrofone().then(
      (ok) => {
        console.log(`[chronos] microfone: respondendo ${ok ? 'sim' : 'nao'} ao Chromium`);
        callback(ok);
      },
      (err) => {
        console.log('[chronos] microfone: falha ao consultar o sistema —', err);
        callback(false);
      },
    );
  });

  // No arranque, para a ausencia de qualquer linha "[chronos] permissao pedida"
  // depois de clicar no microfone significar que o pedido nem chegou aqui.
  console.log(
    `[chronos] microfone no arranque: ${
      process.platform === 'darwin'
        ? systemPreferences.getMediaAccessStatus('microphone')
        : 'fora do macOS'
    }`,
  );

  // O servidor embutido sobe sob demanda: so quando "Este computador" e o
  // escolhido (ver abrirServidor).
  createWindow();
  createTray();

  globalShortcut.register('Alt+Command+C', toggleWindow);
  globalShortcut.register('Alt+Control+C', toggleWindow);
  globalShortcut.register('Alt+Command+F', () => createFloatingWindow());
  globalShortcut.register('Alt+Control+F', () => createFloatingWindow());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else toggleWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.destroy();
  serverProcess?.kill();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
