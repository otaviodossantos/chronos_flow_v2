#!/usr/bin/env node
/**
 * Leva os fontes nativos de `ios-native/` para dentro do projeto do Xcode.
 *
 * O `cap sync` copia o bundle web e mais nada: os arquivos Swift ficam de fora
 * dele. Quem os arrasta para o Xcode com "Copy items if needed" marcado ganha
 * uma *copia* dentro de `ios/`, e a partir dali toda correcao feita em
 * `ios-native/` para de chegar no app — foi exatamente o que aconteceu com a
 * busca na rede: o metodo existia no repositorio e nao existia no build.
 *
 * Entao a copia passa a ser feita aqui, a cada `npm run sync`, sempre no mesmo
 * lugar (`ios/App/App/Chronos`). No Xcode os arquivos sao adicionados uma vez
 * so, a partir dessa pasta, e daí em diante eles se atualizam sozinhos.
 *
 * Os widgets ficam de fora de proposito: eles pertencem a outro alvo, que so
 * existe depois de criado no Xcode. O script avisa quando encontra esse alvo.
 */
import { mkdir, readdir, writeFile, readFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const rodar = promisify(execFile);

const raiz = process.cwd();
const origem = path.join(raiz, 'ios-native');
const destino = path.join(raiz, 'ios', 'App', 'App', 'Chronos');

/** O que o alvo do App compila: a ponte e os tipos que ela compartilha. */
const PARA_O_APP = [
  ['Plugin', 'ChronosNativePlugin.swift'],
  ['Plugin', 'ChronosNativePlugin.m'],
  ['Plugin', 'DescobertaNaRede.swift'],
  ['Compartilhado', 'FocoAttributes.swift'],
  ['Compartilhado', 'ResumoDoDia.swift'],
];

/**
 * O que o alvo da extensao compila.
 *
 * Os dois arquivos de `Compartilhado` aparecem aqui *e* na lista de cima, de
 * proposito: a extensao roda em outro processo e precisa compilar a mesma
 * declaracao de `FocoAttributes`. Cada alvo fica com a sua copia, e nao com o
 * mesmo arquivo em dois alvos — assim nao ha como um deles ficar para tras.
 */
const PARA_OS_WIDGETS = [
  ['Widgets', 'ChronosWidgetBundle.swift'],
  ['Widgets', 'FocoLiveActivity.swift'],
  ['Widgets', 'ResumoWidget.swift'],
  ['Compartilhado', 'FocoAttributes.swift'],
  ['Compartilhado', 'ResumoDoDia.swift'],
];

/**
 * O Info.plist da extensao, e o cuidado de onde ele fica.
 *
 * O alvo de widgets do Xcode 16 usa `fileSystemSynchronizedGroups`: tudo o que
 * estiver dentro da pasta `ChronosWidgets/` entra no alvo sozinho — os `.swift`
 * viram codigo compilado (otimo, ninguem precisa adiciona-los) e **qualquer
 * outro arquivo vira recurso copiado para dentro do .appex**. Um `Info.plist`
 * ali dentro e produzido duas vezes: uma pelo `INFOPLIST_FILE` e outra pela
 * copia automatica. O build para com "Multiple commands produce
 * ChronosWidgetsExtension.appex/Info.plist".
 *
 * Por isso ele mora *fora* da pasta sincronizada, como
 * `ios/App/ChronosWidgets-Info.plist`, e o `INFOPLIST_FILE` do alvo aponta
 * para la.
 *
 * Reposto so quando falta: e um arquivo que voce edita no Xcode conforme
 * adiciona capabilities, e sobrescrever a cada sync apagaria isso.
 */
const PLIST_DA_EXTENSAO = 'ChronosWidgets-Info.plist';

const NOME_DA_EXTENSAO = 'ChronosWidgets';

const existe = async (p) => access(p).then(() => true, () => false);

if (!(await existe(path.join(raiz, 'ios')))) {
  console.log('[nativo] pasta ios/ nao existe ainda. Rode antes: npx cap add ios');
  process.exit(0);
}

await mkdir(destino, { recursive: true });

/**
 * `writeFile` e nao `cp`: o `cp` do Node apaga o destino antes de escrever, e
 * sobrescrever no lugar preserva o arquivo que o Xcode ja tem referenciado —
 * alem de funcionar em pastas onde apagar nao e permitido.
 */
async function levar(lista, paraOnde) {
  let n = 0;
  for (const [pasta, arquivo] of lista) {
    const de = path.join(origem, pasta, arquivo);
    if (!(await existe(de))) {
      console.warn(`[nativo] faltando em ios-native/${pasta}: ${arquivo}`);
      continue;
    }
    await writeFile(path.join(paraOnde, arquivo), await readFile(de), { flag: 'w' });
    n += 1;
  }
  return n;
}

const copiados = await levar(PARA_O_APP, destino);

/**
 * Um lembrete dentro da propria pasta. Quem abrir `ios/` daqui a seis meses
 * procurando por que um arquivo "voltou sozinho" merece achar a resposta ali.
 */
await writeFile(
  path.join(destino, 'LEIAME.txt'),
  [
    'Esta pasta e gerada por scripts/sincronizar-nativo.mjs a cada "npm run sync".',
    'Nao edite nada aqui: a fonte e ios-native/, e o proximo sync sobrescreve.',
    '',
    'No Xcode, adicione esta pasta ao alvo App uma unica vez',
    '(Add Files to "App"... > Create groups > alvo App marcado).',
    'Depois disso as atualizacoes chegam sozinhas, sem abrir o Xcode.',
    '',
  ].join('\n'),
  'utf8',
);

console.log(`[nativo] ${copiados} arquivo(s) em ios/App/App/Chronos`);

/**
 * Registrar o plugin.
 *
 * O Capacitor 8 nao procura plugins varrendo as classes do binario: o
 * `registerPlugins()` monta a lista a partir de `packageClassList`, no
 * `capacitor.config.json` que o `cap sync` gera — e esse arquivo so conhece
 * pacotes npm. Um plugin que mora no proprio app compila, aparece em Compile
 * Sources, e mesmo assim responde "plugin is not implemented on ios", porque
 * ninguem nunca o registrou.
 *
 * Como o `cap sync` reescreve esse arquivo a cada build, a linha e
 * reacrescentada aqui, depois dele. E por isso que este script roda *depois*
 * do `cap sync` no `npm run sync`, e nao antes.
 */
const CLASSE = 'ChronosNativePlugin';
const configIOS = path.join(raiz, 'ios', 'App', 'App', 'capacitor.config.json');

if (await existe(configIOS)) {
  const texto = await readFile(configIOS, 'utf8');
  const config = JSON.parse(texto);
  const lista = Array.isArray(config.packageClassList) ? config.packageClassList : [];

  if (lista.includes(CLASSE)) {
    console.log(`[nativo] ${CLASSE} ja estava registrado`);
  } else {
    config.packageClassList = [...lista, CLASSE];
    // Duas casas de indentacao e tab, como o proprio Capacitor grava — assim o
    // arquivo nao aparece inteiro no diff a cada sync.
    await writeFile(configIOS, `${JSON.stringify(config, null, '\t')}\n`, 'utf8');
    console.log(`[nativo] ${CLASSE} registrado em capacitor.config.json`);
  }
} else {
  console.warn('[nativo] ios/App/App/capacitor.config.json nao existe: rode cap sync antes.');
}

/**
 * O icone do app.
 *
 * O catalogo de assets vive dentro de `ios/`, que e pasta gerada: um
 * `npx cap add ios` do zero devolveria o icone em branco do template, e o
 * logo so seria notado de novo quando alguem olhasse a tela inicial. Por isso
 * o mestre mora em `resources/icon.png`, no repositorio, e vem para ca a cada
 * sync — como os fontes nativos.
 *
 * O Xcode moderno gera todos os tamanhos a partir deste unico 1024x1024, e e
 * por isso que ha um arquivo so. Sem canal alfa: a App Store recusa icone com
 * transparencia.
 */
const ICONE = ['resources/icon.png', 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'];

async function levarOIcone() {
  const [de, para] = ICONE.map((r) => path.join(raiz, r));
  if (!(await existe(de))) {
    console.warn('[nativo] resources/icon.png nao existe: o icone ficou como estava.');
    return;
  }
  if (!(await existe(path.dirname(para)))) {
    console.warn('[nativo] o catalogo de assets nao existe: rode cap add ios antes.');
    return;
  }
  await writeFile(para, await readFile(de), { flag: 'w' });
  console.log('[nativo] icone do app atualizado a partir de resources/icon.png');
}

await levarOIcone();

/**
 * As chaves do Info.plist que o app precisa e o Capacitor nao poe.
 *
 * `NSContactsUsageDescription` nao e opcional: sem ela, o `requestAccess` dos
 * Contatos **derruba o app** em vez de perguntar. Antes a lista de chaves
 * morava so no LEIAME, para ser copiada a mao no Xcode uma vez — o que
 * funciona ate alguem clonar o repositorio de novo e passar meia hora atras
 * de um crash sem mensagem.
 *
 * Escrito com `plutil`, que ja vem no macOS: ele entende o formato binario e
 * o XML, e escreve de forma atomica. Nunca sobrescreve: so acrescenta a chave
 * que falta, para nao desfazer nada que tenha sido ajustado no Xcode.
 */
const CHAVES_DO_PLIST = [
  [
    'NSContactsUsageDescription',
    'O Chronos le os seus contatos para voce montar a equipe sem digitar nome, email e telefone de novo.',
  ],
];

async function garantirChavesDoPlist() {
  const plist = path.join(raiz, 'ios', 'App', 'App', 'Info.plist');
  if (!(await existe(plist))) {
    console.warn('[nativo] ios/App/App/Info.plist nao existe: rode cap sync antes.');
    return;
  }

  for (const [chave, valor] of CHAVES_DO_PLIST) {
    try {
      await rodar('plutil', ['-extract', chave, 'raw', '-o', '-', plist]);
      // Ja existe: quem editou no Xcode manda.
    } catch {
      try {
        await rodar('plutil', ['-insert', chave, '-string', valor, plist]);
        console.log(`[nativo] ${chave} acrescentado ao Info.plist`);
      } catch (erro) {
        console.warn(
          `[nativo] ATENCAO: nao consegui por ${chave} no Info.plist (${erro.message}).\n` +
            '         Adicione a mao no Xcode: sem ela, pedir acesso aos\n' +
            '         contatos derruba o app em vez de perguntar.',
        );
      }
    }
  }
}

await garantirChavesDoPlist();

/**
 * Os widgets so tem para onde ir depois que o alvo existir.
 *
 * Enquanto ele nao existe, a Live Activity e pedida pelo app e o sistema nao
 * tem o que desenhar: a Ilha Dinamica abre preta e vazia, sem erro nenhum em
 * lugar nenhum. E por isso que este aviso e insistente.
 */
const pastaDosWidgets = path.join(raiz, 'ios', 'App', NOME_DA_EXTENSAO);

if (await existe(pastaDosWidgets)) {
  const n = await levar(PARA_OS_WIDGETS, pastaDosWidgets);

  console.log(`[nativo] ${n} arquivo(s) em ios/App/${NOME_DA_EXTENSAO}`);

  const plist = path.join(raiz, 'ios', 'App', PLIST_DA_EXTENSAO);
  if (!(await existe(plist))) {
    await writeFile(plist, await readFile(path.join(origem, 'Widgets', 'Info.plist')), { flag: 'w' });
    console.log(`[nativo] ${PLIST_DA_EXTENSAO} estava faltando e foi reposto`);
  }

  // Dentro da pasta sincronizada ele vira recurso e colide com o proprio
  // Info.plist do alvo. Vale avisar antes de o build parar.
  if (await existe(path.join(pastaDosWidgets, 'Info.plist'))) {
    console.warn(
      `[nativo] ATENCAO: ha um Info.plist dentro de ${NOME_DA_EXTENSAO}/.\n` +
        '         Mova-o para ios/App/' + PLIST_DA_EXTENSAO + ' — dentro da pasta\n' +
        '         sincronizada ele e copiado como recurso e o build para com\n' +
        '         "Multiple commands produce ... .appex/Info.plist".',
    );
  }
} else {
  console.log(
    `[nativo] o alvo ${NOME_DA_EXTENSAO} ainda nao existe.\n` +
      '         Sem ele a Ilha Dinamica abre vazia e os widgets da tela inicial\n' +
      '         nao existem. No Xcode: File > New > Target > Widget Extension,\n' +
      `         nome ${NOME_DA_EXTENSAO}, com "Include Live Activity" marcado.\n` +
      '         Feito isso, rode npm run sync de novo e os fontes vao sozinhos.',
  );
}
