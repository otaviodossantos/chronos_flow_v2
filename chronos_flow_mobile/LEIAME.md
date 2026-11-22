# Chronos Flow — iPhone

O mesmo sistema do desktop, rodando inteiro dentro do aparelho. Sem servidor,
sem conta, sem sincronizacao: o banco e um arquivo SQLite no iPhone e a unica
chamada que sai para a internet e o planejamento do backlog pelo Gemini, quando
voce pede.

## Como ele e feito

| Camada | Desktop | iPhone |
| --- | --- | --- |
| Banco | Postgres + Prisma | SQLite do iOS + Drizzle |
| Acesso | HTTP para o Express | chamada de funcao (`src/lib/api.ts`) |
| Dominio | `server/domain/` | **o mesmo**, por alias `@core` |
| Tipos e schemas | `shared/` | **os mesmos**, por alias `@shared` |
| Interface | React + shadcn | React + shadcn, adaptada ao dedo |

O dominio e os tipos entram por alias, nunca por copia: a cascata de pesos
bottom-up e a regra mais delicada do sistema, e duas copias dela seriam dois
apps discordando do mesmo numero. A interface, ao contrario, foi copiada e
diverge de proposito — ela precisa caber num dedo.

`src/lib/api.ts` e a peca que torna isso barato: ele expoe exatamente a mesma
superficie do `src/lib/api.ts` do desktop (`api.tree`, `api.createNode`...), com
os mesmos argumentos, os mesmos formatos de retorno e a mesma validacao pelos
mesmos schemas Zod. As telas atravessaram sem saber que o servidor sumiu.

## O que mudou para o toque

**O arraste do React nao sobreviveu; o arraste com ouvintes nativos sim.**

O WKWebView nao implementa HTML5 drag-and-drop — num toque, `dragstart` nunca
dispara —, o que ja era sabido. O que custou tres rodadas foi descobrir que
reimplementar o arraste com os eventos de ponteiro *do React* tambem nao
funciona: o WebKit decide que um toque que se desloca e rolagem e manda
`pointercancel` antes do segundo `pointermove`. `touch-action: none` na barra,
depois tambem nos filhos dela, `setPointerCapture`, pressao longa antes de
mover — nada disso mudou nada no iPhone, embora tudo funcionasse no emulador, o
que tornou cada tentativa convincente e errada.

A causa provavel: **o React registra `touchstart` e `touchmove` como ouvintes
passivos** na raiz da aplicacao, e num ouvinte passivo o `preventDefault()` e
ignorado pelo navegador. E `preventDefault` no primeiro `touchmove` e o unico
jeito garantido de dizer ao WebKit que aquele gesto nao e rolagem;
`touch-action: none` deveria bastar e, nesse aparelho, nao bastou.

A saida foram ouvintes proprios, com `{ passive: false }`, presos uma unica vez
ao container que rola (`TimeCanvas`). Um conjunto so para a timeline inteira:
quem foi tocado se descobre no `touchstart`, pelo `data-pega` mais proximo —
`move` na barra, `resize-start` e `resize-end` nas alcas. Sem isso os ouvintes
seriam refeitos a cada redesenho, e durante um arraste ha um redesenho por
movimento.

So a barra **marcada** arrasta, e o gesto so e barrado em cima dela: medido em
teste, cinco movimentos sobre a barra marcada saem com `defaultPrevented`, e
cinco sobre qualquer outro ponto saem livres, com a rolagem intacta. Sem essa
regra, encostar numa barra qualquer prenderia a timeline.

Fora da timeline, as outras duas operacoes de arraste do desktop continuam
sendo toques — ali o alvo e outra linha, nao uma distancia:

- **Mover uma tarefa de pai**: segure a linha na arvore (0,45 s, com vibracao),
  depois toque no novo pai. O rodape oferece "Virar meta macro".
- **Soltar um modelo na timeline**: toque no modelo na paleta e depois na linha
  e na hora em que ele entra.
### Marcar primeiro, depois arrastar

Um toque na barra (ou na linha da arvore) marca a tarefa e **nao** abre o
painel de detalhe. Abrir o detalhe a cada toque cobria a tela inteira —
justamente a timeline que se precisa enxergar enquanto se ajusta uma data. O
detalhe completo fica a um toque, no botao "Abrir".

Marcada, a barra arrasta com o dedo: pelo meio ela se move inteira, pelas alcas
das pontas (24px na barra marcada, contra 16 nas outras) ela estica ou encolhe.
Pegar a borda direita muda o modo da faixa para "Fim", de modo que as setas
continuam de onde o dedo parou.

A faixa no rodape traz o titulo, a janela, o botao das filhas, tres modos
(**Mover**, **Inicio**, **Fim**), um par de setas e um passo escolhido a mao:
15 min, 1 hora, 1 dia ou 1 semana. O passo vale para os dois caminhos — e o
encaixe do arraste tambem — e e o ganho que o arraste sozinho nunca deu: antes
o deslocamento minimo era refem do zoom, e na visao de meses nao havia como
pedir menos que um dia inteiro. Agora da para estar em trimestres e ainda
empurrar a tarefa quinze minutos.

Cada toque redesenha a barra na hora; o envio ao banco espera meio segundo de
silencio. Sem essa espera, cinco toques seriam cinco reagendamentos
concorrentes sobre a mesma tarefa, cada um com sua cascata de pesos, e o ultimo
a responder decidiria o resultado. No arraste nao ha espera nenhuma enquanto o
dedo anda — gravar no meio do gesto moveria o chao debaixo dele —, e ao soltar
a gravacao sai quase de imediato.

O botao "com as filhas / so esta" e o equivalente ao Shift do desktop. Fica
visivel em vez de escondido num gesto porque num aparelho nao ha tecla para
segurar — e porque a diferenca entre esticar o pai levando as filhas ou nao e
grande demais para ficar implicita.

Marcar pela arvore rola a timeline ate a barra. Os titulos so sao legiveis na
arvore, e a barra correspondente pode estar a meses de distancia na horizontal;
sem isso as setas trabalhariam contra uma tela onde nada se mexe.

O seletor de data abre com `<select>` de mes e ano (1940 ate dez anos a
frente), e nao com as setinhas do desktop: no iPhone um `<select>` abre a roda
nativa, e chegar em 2030 vira um toque em vez de quarenta e oito.

Tambem mudou o enquadramento: a barra lateral virou barra de abas no rodape, o
painel de detalhe virou folha por cima (nao ha terceira coluna em 390px), os
filtros do cabecalho moraram numa folha, e a arvore encolheu para 164px — o
rotulo de nivel (`N0`, `N1`) saiu da linha porque custava 36px para repetir o
que o recuo ja diz.

## Ilha Dinamica e widgets

`src/features/focus/sessaoDeFoco.ts` guarda o instante em que o relogio voltou
a andar, e nunca um contador decrementado — o iOS congela o JavaScript assim
que o app sai da tela, e um contador por tique perderia exatamente o tempo em
que voce esteve fora.

A ilha conta sozinha: o app envia um `fim` e o `Text(timerInterval:)` do
SwiftUI faz o resto, dentro do processo do sistema. Por isso o app so manda
atualizacao quando o fim muda — pausa, retomada, prazo alterado —, nunca a
cada segundo. Tocar na ilha abre `chronosflow://tarefa/<id>`, que cai no
`appUrlOpen` do `App.tsx` e leva direto aquela tarefa.

Os widgets da tela inicial leem um JSON no App Group, gravado pelo app quando
os dados mudam e, principalmente, quando o app sai da tela. O widget nao abre o
banco: ele roda em outro processo, com poucos milissegundos de orcamento, e um
SQLite de centenas de tarefas ali faria o sistema mata-lo antes de desenhar.

## Avisos de tarefa

Em *Mais > Ajustes > Avisos de tarefa*: um interruptor e a antecedencia (na
hora, 5, 10, 15, 30 ou 60 minutos). Ligado, o iPhone avisa antes de cada tarefa
comecar — **com o app fechado, encerrado a forca ou em modo aviao**.

Nao ha servidor nenhum. Isto e notificacao *local*: o app diz ao iOS "as 13h55,
mostre isto", e quem guarda o compromisso e um processo do sistema. Push
remoto exigiria APNs, certificados e uma maquina de pe; nada disso existe aqui,
e para um app cujo banco e um arquivo no aparelho seria a primeira coisa a
quebrar a promessa de funcionar offline.

### O que decide quem recebe aviso

`src/features/avisos/planoDeAvisos.ts`, uma funcao pura de (tarefas, ajustes,
agora) para lista de avisos. Pura de proposito: a parte que erra nao e o
`schedule` do iOS, e sim *quais* tarefas merecem aviso e *quando* — e isso da
para testar sem iPhone nenhum.

As regras, com o motivo de cada uma:

- **So folhas.** A janela de uma meta macro comeca junto com a primeira filha
  dela; avisar as duas tocaria duas vezes, no mesmo segundo, pela mesma coisa.
- **Nem concluidas, nem sem data, nem de dia inteiro.** "Faltam 5 minutos" numa
  tarefa de dia inteiro cairia a meia-noite menos cinco, que nao e o que
  ninguem quis dizer.
- **Nada no passado.** O iOS aceita um agendamento vencido em silencio e nunca
  dispara — pior que nao agendar, porque parece que foi agendado.
- **Horizonte de 7 dias, teto de 56.** O iOS guarda no maximo **64**
  notificacoes pendentes por app e descarta as mais distantes sem avisar
  ninguem. Parando em 56, quem fica de fora e escolhido aqui — os mais
  distantes, que sao tambem os que mais chance tem de mudar de data antes de
  acontecer — e sobra folga para o que o app agenda fora deste plano.

### Quando a fila e refeita

No `useAvisos`, montado no `App.tsx`: sempre que a arvore muda e sempre que o
app volta do segundo plano. O plano anterior e comparado antes de reenviar,
senao cada toque numa tarefa refaria a fila inteira do iOS.

A arvore vem de uma consulta **propria, sem filtro**, e nao da que a timeline
usa. Se dependesse dela, esconder as concluidas ou filtrar por um espaco
desarmaria os avisos de tudo o que saiu da tela — um filtro de visualizacao
apagando lembretes.

Dai a unica limitacao real, e ela nao e de rede: **quem arma e o app rodando**.
Os avisos ja armados disparam de qualquer jeito, mas uma tarefa criada no
desktop e trazida pelo Wi-Fi so vira aviso quando voce abrir o iPhone.

### No lado nativo

`sincronizarAvisos` apaga e regrava tudo, o que o torna idempotente. Apaga so
o que tem o prefixo `chronos.aviso.`: um `removeAllPendingNotificationRequests`
levaria junto qualquer outro aviso que o app venha a agendar.

O gatilho e `UNTimeIntervalNotificationTrigger`, e nao o de calendario: o plano
ja resolveu o fuso ao mandar um instante ISO, e o gatilho de calendario
reinterpretaria esse instante no fuso do aparelho.

A permissao e pedida no momento em que a chave e ligada, nao na primeira
abertura. Pedir antes de o recurso existir gasta a unica chance que o iOS da —
negado uma vez, o dialogo nunca mais aparece.

**Passo opcional no Xcode:** a capability *Time Sensitive Notifications*. O
conteudo ja pede `interruptionLevel = .timeSensitive`, que atravessa os modos
de Foco; sem a capability o iOS rebaixa isso em silencio e o aviso chega, mas
espera o Foco terminar — justamente a hora em que ele seria mais util. Nao e
posta automaticamente porque entitlement precisa casar com o App ID no portal
da Apple, e injetar um que o perfil nao tem quebra a assinatura.

## Cadastrar o time pela agenda do iPhone

Em *Mais > Equipe*, ao lado de "Adicionar", o botao **Da agenda** abre a lista
de contatos do aparelho **dentro do app**, com um campo de busca que procura em
nome, email e telefone ao mesmo tempo. Marque quem entra, toque em "Adicionar N
pessoas", e pronto.

A busca e o motivo de a lista ser nossa e nao do sistema. O
`CNContactPickerViewController` **nao tem campo de pesquisa quando esta em
selecao multipla**: numa agenda de centenas de nomes — a de quem usa o celular
para trabalhar — achar quatro pessoas vira rolagem pela letra inicial. A troca
tem um preco: ler a agenda pelo `CNContactStore` exige a permissao de Contatos,
que o seletor dispensava. Por isso o seletor continua no codigo como caminho B:
quem negar a permissao cai nele e cadastra assim mesmo, sem busca.

**`NSContactsUsageDescription` nao e opcional.** Sem essa chave no Info.plist,
pedir acesso aos contatos **derruba o app** em vez de perguntar — sem mensagem,
sem log util. O `npm run sync` poe a chave sozinho com o `plutil`, e so quando
ela falta; se ele avisar que nao conseguiu, adicione a mao no Xcode (a chave
esta na tabela dos seis passos, mais abaixo).

Nome e o unico campo garantido. Email e telefone faltam com frequencia, e nao e
erro: muita gente na agenda so tem nome e numero. Cada campo e lido depois de
`isKeyAvailable` — tocar numa chave que nao veio derruba o app com excecao em
vez de devolver nulo.

A lista desenha 60 linhas por vez. Mil linhas de React numa folha custam
segundos de rolagem travada, e o resto aparece conforme a busca fecha o cerco —
que e como a tela se usa de qualquer jeito. Marcar alguem e depois buscar outro
nome esconde o primeiro da vista, entao um atalho ("Ver as N marcadas") traz a
selecao de volta sem desfazer a busca.

Quem ja esta no time aparece com "ja existe": o email manda quando existe dos
dois lados, e sem ele sobra o nome, comparado sem acento e sem caixa. Errar
para o lado de avisar e melhor que criar o segundo "Joao Pedro" em silencio —
desmarcar custa um toque, e separar duas fichas depois custa reatribuir todas
as tarefas de uma delas.

## Limite de tarefas no backlog

Cada item do backlog aceita um teto — "ate 10 tarefas" — que a IA respeita ao
montar o plano. O teto conta a **arvore inteira**: frentes, etapas e folhas
somadas, e nao so o primeiro nivel. Era exatamente esse numero que escapava:
pedir "3 frentes" podia voltar com trinta tarefas embaixo delas.

O teto entra no pedido ao modelo, com a forma sugerida junto — abaixo de 6,
uma lista simples sem subtarefas; ate 15, de duas a quatro frentes com um nivel
de quebra. Sem isso, a regra geral do sistema ("de 3 a 6 frentes") brigava com
um orcamento pequeno e o modelo devolvia cinco frentes vazias.

E o teto e **cumprido**, nao so pedido: `limitarPlano`, no planner
compartilhado, corta o excedente em largura — guarda as frentes e sacrifica o
detalhamento, porque e melhor perder as subtarefas de uma frente do que perder
a frente inteira. As dependencias sao religadas depois do corte, senao uma
tarefa ficaria esperando por outra que nao existe mais. Um limite que o modelo
pode ignorar nao e um limite.

A coluna e `max_tasks`, nula por padrao (sem teto). No iPhone ela chega pela
migration `0001_limite_de_tarefas`; no desktop, pela migration do Prisma de
mesmo nome — nenhum dos dois precisa de reinstalacao.

## O icone do app

O mestre e `resources/icon.png`, um PNG de 1024x1024 sem canal alfa — a App
Store recusa icone com transparencia. O Xcode moderno gera todos os outros
tamanhos a partir dele, entao ha um arquivo so no catalogo.

Ele e copiado para `ios/App/App/Assets.xcassets/` a cada `npm run sync`, pelo
mesmo motivo dos fontes nativos: `ios/` e pasta gerada, e um `npx cap add ios`
do zero devolveria o icone em branco do template — falha que so apareceria
quando alguem olhasse a tela inicial.

O logotipo original esta em `resources/logo-chronos.png`. No icone ele ocupa
84% da largura, contra os 71% do arquivo de origem: num quadrado de 60pt, o
que decide a legibilidade e quantos pixels sobram por letra, e "Chronos" tem
sete delas para dividir a largura.

## Rodar

```bash
npm install
npm run dev        # no navegador, para mexer no layout
npm test           # 67 testes do dominio, dos servicos e do shim
npm run ios        # build + cap sync + abre o Xcode
```

No navegador o banco cai no `jeep-sqlite` (SQLite em WebAssembly), que busca
`/assets/sql-wasm.wasm` — o arquivo esta em `public/assets/` e precisa casar com
a versao do `sql.js` que o `jeep-sqlite` embute. No iPhone nada disso e usado.

## Os seis passos no Xcode

O `npx cap add ios` gera o projeto, mas quatro coisas o Capacitor nao sabe
fazer sozinho. Tudo isto e feito uma vez.

1. **Gerar o projeto**

   ```bash
   npx cap add ios
   npm run sync
   ```

2. **App Group nos dois alvos.** Em *Signing & Capabilities*, adicione
   *App Groups* ao alvo do app e crie `group.br.com.labds.chronosflow`.
   Repita no alvo da extensao, com o mesmo identificador. Sem isso o widget
   fica para sempre no estado de exemplo.

3. **O plugin nativo.** Arraste `ios-native/Plugin/ChronosNativePlugin.swift` e
   `ChronosNativePlugin.m` para o alvo **App**. O `.m` nao e opcional: o
   Capacitor acha os plugins pelo runtime do Objective-C, e sem ele toda
   chamada responde "ChronosNative does not have a method".

4. **A extensao de widgets.** Sem ela a Ilha Dinamica *abre* — o app pede a
   Live Activity e o sistema aceita — mas nao ha o que desenhar: a ilha fica
   preta e vazia, e nenhum erro aparece em lugar nenhum.

   *File > New > Target > Widget Extension*, nome exatamente `ChronosWidgets`,
   com *Include Live Activity* marcado. Apague os arquivos de exemplo que ele
   gerar (inclusive o `@main` deles — dois `@main` no mesmo alvo nao compilam).

   Depois, `npm run sync`: o script leva os cinco fontes para
   `ios/App/ChronosWidgets/` sozinho. **Nao e preciso adiciona-los no Xcode**:
   o alvo de widgets do Xcode 16 usa pasta sincronizada
   (`fileSystemSynchronizedGroups`), entao tudo o que esta dentro dela entra no
   alvo automaticamente.

   O outro lado dessa moeda: qualquer arquivo que *nao* seja codigo, posto ali
   dentro, vira recurso copiado para o `.appex`. E por isso que o Info.plist da
   extensao mora **fora** da pasta, como `ios/App/ChronosWidgets-Info.plist` —
   dentro dela, ele e produzido duas vezes (pelo `INFOPLIST_FILE` e pela copia
   automatica) e o build para com "Multiple commands produce
   ChronosWidgetsExtension.appex/Info.plist". O script repoe esse arquivo
   quando falta e avisa se um aparecer no lugar errado.

   `FocoAttributes.swift` e `ResumoDoDia.swift` aparecem nas duas pastas de
   proposito: a extensao roda em outro processo e so entende a atividade se
   compilar a mesma declaracao. Cada alvo fica com a sua copia, mantida pelo
   mesmo script.

5. **Info.plist do app.** Adicione:

   | Chave | Valor |
   | --- | --- |
   | `NSSupportsLiveActivities` | `YES` |
   | `NSMicrophoneUsageDescription` | `O Chronos usa o microfone para ditar notas e tarefas.` |
   | `NSContactsUsageDescription` | `O Chronos le os seus contatos para voce montar a equipe sem digitar tudo de novo.` |
   | `NSLocalNetworkUsageDescription` | `O Chronos procura o seu computador na rede para transferir suas tarefas.` |
   | `NSBonjourServices` | array com um item: `_chronos._tcp` |
   | `NSAppTransportSecurity` | dicionario com `NSAllowsLocalNetworking = YES` |

   As tres ultimas sao a transferencia pelo Wi-Fi. Sem `NSBonjourServices` o
   `NWBrowser` nao acha nada e nao diz por que; sem `NSAllowsLocalNetworking` o
   `fetch` para o `http://` do computador e barrado pelo ATS.

   Tambem arraste `ios-native/Plugin/DescobertaNaRede.swift` para o alvo App,
   junto dos outros dois arquivos do plugin.

6. **Esquema de URL.** No alvo do app, *Info > URL Types*, identificador
   `br.com.labds.chronosflow` e esquema `chronosflow`. E o que faz o toque na
   ilha abrir a tarefa.

Depois disso, `npm run sync` a cada mudanca no app web; o Xcode so volta a ser
necessario quando algo nativo mudar.

## Levar para outro aparelho

Em *Mais > Ajustes > Levar para outro aparelho*, por dois caminhos.

**Pelo Wi-Fi.** No computador, *Ajustes > Transferir > Liberar por 5 minutos*:
ele mostra seis digitos. No iPhone, "Buscar no Wi-Fi", escolha o computador,
digite o codigo e escolha o sentido. O codigo vale uma vez, morre em cinco
tentativas erradas e expira sozinho.

**Por arquivo.** A exportacao gera um JSON que sai pela folha de
compartilhamento; a importacao substitui tudo.

Nos dois casos nao ha mescla, de proposito: sem relogio comum entre dois
aparelhos, mesclar seria adivinhar qual versao de uma tarefa e a boa — e
adivinhar errado ali apaga trabalho.

### Como o iPhone acha o computador

O desktop se anuncia de dois jeitos: um respondedor **UDP** na porta 45678
(pergunta `CHRONOS_QUEM_E`, resposta com nome, porta e enderecos) e
**Bonjour/mDNS** como `_chronos._tcp`.

O iPhone usa so o segundo, e nao por gosto: desde o iOS 14 a Apple exige a
permissao `com.apple.developer.networking.multicast` para um app *enviar ou
receber* broadcast ou multicast, e ela e concedida sob pedido, caso a caso.
Bonjour com um tipo de servico declarado fica fora disso e pede apenas a
permissao de rede local, que o sistema pergunta na primeira busca. O UDP
continua valendo entre computadores e para qualquer script.

Nenhum dos dois anuncios carrega dado do banco: eles dizem "existe um Chronos
aqui, neste endereco". O que vale alguma coisa so sai depois do codigo.
