# Publicar o Chronos Flow na App Store

Tudo o que o App Store Connect vai pedir, tela por tela, com os textos prontos
para copiar. As capturas estão em `loja/capturas/`.

Escrito supondo **conta paga do Apple Developer Program** e envio para a **App
Store pública**. Na conta gratuita nada disso se aplica: ela só instala no seu
aparelho e o app expira em sete dias.

---

## Parte 0 — Antes de abrir o App Store Connect

Seis coisas no projeto. As duas primeiras **impedem o envio**; as outras levam
à rejeição na revisão.

### 1. Os dois alvos estão em times diferentes

No `project.pbxproj`, o app está no time `PG97VS3AXV` e a extensão de widgets
no `NY9LHQ4GQX`. Um app e sua extensão têm que estar no mesmo time, ou o
archive falha.

No Xcode: selecione o alvo **ChronosWidgetsExtension** → *Signing &
Capabilities* → escolha o mesmo time do alvo **App**.

### 2. Falta a chave de conformidade de exportação

Sem ela, cada envio fica parado esperando você responder ao questionário de
criptografia. O app só usa HTTPS padrão, então é isento.

No `ios/App/App/Info.plist`:

```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

### 3. O app declara suporte a iPad, e não tem

`TARGETED_DEVICE_FAMILY = "1,2"` nos quatro blocos de configuração. Isso obriga
capturas de iPad **e** faz o revisor testar num iPad, onde a interface — toda
desenhada para 390px — vai parecer um telefone esticado.

Troque para `"1"` (só iPhone) nos quatro lugares.

### 4. O widget vai mostrar dados de exemplo para sempre

O App Group nunca foi criado: não existe arquivo de entitlements no projeto. O
`ResumoDoDia.ler()` cai no `.exemplo` quando não consegue ler o grupo, então o
widget publicado exibiria números inventados. Isso é conteúdo de espaço
reservado num app na loja — diretriz 2.1, rejeição quase certa.

Duas saídas: criar o App Group `group.br.com.labds.chronosflow` nos dois alvos
(*Signing & Capabilities* → *App Groups*), ou **remover a extensão de widgets
desta primeira versão** e publicá-la depois. A segunda é mais rápida e tira
junto o problema 1.

### 5. O app aceita paisagem

`UISupportedInterfaceOrientations` lista as três orientações. A interface foi
feita para retrato. Gire o aparelho e veja — o revisor vai girar. Se não
estiver bom, deixe só:

```xml
<key>UISupportedInterfaceOrientations</key>
<array>
    <string>UIInterfaceOrientationPortrait</string>
</array>
```

### 6. Restos do template do Capacitor

- `UIRequiredDeviceCapabilities` ainda é `armv7`, de uma era de 32 bits. Troque
  por `arm64`.
- `CFBundleDevelopmentRegion` é `en` num app inteiramente em português. Troque
  por `pt-BR`: é ele que define o idioma padrão da ficha na loja.

---

## Parte 1 — Criar o app

**My Apps → + → New App**

| Campo | Valor |
| --- | --- |
| Platforms | iOS |
| Name | `Chronos Flow` |
| Primary Language | Português (Brasil) |
| Bundle ID | `br.com.labds.chronosflow` |
| SKU | `chronosflow-ios-001` |
| User Access | Full Access |

O **Bundle ID** precisa existir antes, no portal de desenvolvedor
(*Certificates, Identifiers & Profiles → Identifiers*). Se você já compilou
para o aparelho com assinatura automática, ele provavelmente já está lá.

O **nome tem que ser único na loja inteira**. "Chronos" quase certamente está
ocupado; "Chronos Flow" pode estar. Alternativas, em ordem de preferência:

1. `Chronos Flow`
2. `Chronos Flow: metas e foco` (26 caracteres)
3. `Chronos — foco e metas` (22)

O SKU é interno, nunca aparece para ninguém, e não pode ser mudado depois.

---

## Parte 2 — App Information

| Campo | Valor |
| --- | --- |
| Subtitle | `Da meta macro à tarefa do dia` |
| Category (Primary) | Productivity |
| Category (Secondary) | Business |
| Content Rights | *Does not contain, show, or access third-party content* |
| Age Rating | responda **None/Nenhum** em tudo → resulta em **4+** |

O subtítulo tem 29 dos 30 caracteres permitidos. Ele aparece embaixo do nome
na busca e vale quase tanto quanto o nome na indexação.

---

## Parte 3 — Pricing and Availability

| Campo | Valor |
| --- | --- |
| Price | Free (ou o que você decidir) |
| Availability | Todos os países, ou só Brasil |

Se ficar só no Brasil, a ficha em português basta. Abrindo para o mundo, a
loja mostra o português como padrão em todo lugar — funciona, mas converte
mal fora do Brasil.

---

## Parte 4 — App Privacy

Esta parte é respondida com base no que o código **realmente** faz. Vale a
pena acertar: declarar de menos é motivo de remoção depois de publicado.

**Does this app collect data from this app?** → **Yes**

Parece contraintuitivo num app que guarda tudo no aparelho, e são dois
caminhos, os dois só quando você pede. O planejamento por IA envia o título,
as notas e o contexto do item do backlog para o Google (Gemini) — e o ditado
por microfone, nos campos de texto, envia o áudio gravado
para o mesmo lugar. O WKWebView do iOS não tem o reconhecimento de fala do
Safari, então o áudio vai inteiro para o Gemini e volta como texto; não é o
ditado do teclado do iPhone, que nunca sairia do aparelho.

Transmitir para terceiro é coleta na definição da Apple, mesmo que ninguém
guarde nada. Declare **dois** tipos de dado, os dois com as mesmas respostas:

| Campo | Resposta |
| --- | --- |
| Data Types | **User Content → Audio Data** e **User Content → Other User Content** |
| Used for | **App Functionality** |
| Linked to the user? | **No** |
| Used for tracking? | **No** |

**Todo o resto é "Data Not Collected"**, e aqui está o porquê de cada um, caso
a revisão pergunte:

- **Contacts** — lidos do aparelho para cadastrar membros da equipe. Ficam no
  SQLite local e nunca saem dele.
- **Identifiers / Usage Data / Diagnostics** — o app não tem analytics, nem
  SDK de terceiro, nem crash reporting.
- **Location, Health, Financial, Browsing** — não são tocados.

**App Tracking Transparency**: não se aplica. O app não rastreia e não tem
nenhum identificador de publicidade.

### Privacy Policy URL — campo obrigatório

A página está pronta e no ar:

```
https://claude.ai/artifact/Y41k6aWyDzf1przpf2F18j
```

**Ela nasce privada.** Antes de colar esse endereço no App Store Connect,
abra a página, use o menu *Share* e libere o acesso por link — senão o revisor
da Apple abre e não vê nada, e a submissão volta.

Melhor ainda é hospedar no seu próprio domínio, que é o que um revisor espera
de um app comercial. O arquivo pronto para isso é
`loja/politica-de-privacidade.html`: é uma página completa e autossuficiente,
sem dependência de nada além das fontes do Google. Suba em
`labds.com.br/chronos/privacidade`, no GitHub Pages ou onde preferir, e troque
o endereço acima pelo seu.

O texto também está em `loja/politica-de-privacidade.md`, caso você queira
colar num Notion ou numa página que já exista.

Dois detalhes antes de publicar em qualquer lugar: o email de contato no fim
da página está como o placeholder `contato@seudominio.com.br` e o rodapé assina **LabDS**. Se
o contato do app for outro, troque nos dois arquivos.

---

## Parte 5 — Prepare for Submission (a página da versão 1.0)

### Capturas de tela

Estão em `loja/capturas/com-texto/`. Suba as cinco, na ordem do nome do
arquivo — a primeira é a que aparece na busca e carrega quase todo o peso.

| Tamanho no App Store Connect | Arquivos | Pixels |
| --- | --- | --- |
| iPhone 6.9" | `iphone-6.9-*.png` | 1320 × 2868 |
| iPhone com Dynamic Island (médio) | `iphone-medio-*.png` | 1179 × 2556 |

O tamanho médio é o que a Apple marca como obrigatório; o 6.9" é o que a
maioria das pessoas vê. Com os dois, você não precisa do 6.5" nem do 5.5".

Em `loja/capturas/simples/` estão as mesmas telas sem a legenda, caso prefira.
Nenhuma tem canal alfa — a App Store recusa captura com transparência.

Vídeo de pré-visualização não é obrigatório. Pule nesta primeira versão.

### Promotional Text (170 caracteres)

Este campo pode ser trocado sem nova revisão. Use para novidades.

```
Avisos antes de cada tarefa comecar, busca na agenda do iPhone para montar a equipe e limite de tarefas no planejamento assistido por IA.
```

### Description

```
O Chronos Flow organiza trabalho em arvore: uma meta macro se quebra em
frentes, frentes viram etapas, etapas viram tarefas que uma pessoa termina num
dia. Concluir qualquer folha recalcula o progresso de tudo acima dela, na
hora.

E dai vem a pergunta que esse app responde e uma lista de tarefas nao
responde: entre as doze coisas de hoje, qual delas move mais a meta que
importa?

TIMELINE
Arvore a esquerda, barras a direita, rolando juntas. Toque numa barra para
marca-la e arraste para mudar a data, ou use as setas quando quiser precisao
de quinze minutos. Mover uma tarefa-mae leva as filhas junto; segurar so a mae
e uma opcao a um toque de distancia.

FOCO DO DIA
A fila do que fazer agora, ordenada pelo impacto que cada tarefa tem na meta
macro — nao pela data de criacao, nem pela ordem em que voce digitou. Cada
item mostra quanto a conclusao dele vai mover a meta.

BACKLOG COM IA
Jogue a ideia solta na caixa. Quando quiser, peca um plano: a IA devolve
frentes, etapas, tarefas, papeis necessarios e riscos, com um teto de tarefas
que voce define. Voce revisa, corta o que nao serve e aplica — so entao vira
arvore de verdade.

RELATORIOS
Progresso consolidado por cascata, gargalos travados por dependencia, desvio
entre o esforco previsto e o real, e um mapa de risco por meta macro.

EQUIPE
Pessoas, espacos e carga semanal. Monte o time puxando da agenda do iPhone,
com busca por nome, email ou telefone.

AVISOS
Um aviso antes de cada tarefa comecar, com a antecedencia que voce escolher.
Dispara com o app fechado — quem guarda o compromisso e o proprio iPhone.

TUDO NO APARELHO
Sem conta, sem cadastro, sem servidor. O banco de dados e um arquivo no seu
iPhone e funciona em modo aviao. A unica chamada que sai para a internet e o
planejamento por IA, e so quando voce pede.

TAMBEM NO COMPUTADOR
Ha uma versao para desktop, e as duas conversam pelo Wi-Fi da sua casa ou do
seu escritorio, sem passar por nuvem nenhuma. Tambem da para exportar e
importar por arquivo.

O planejamento assistido usa a API do Google Gemini e pede a sua propria
chave, configurada nos Ajustes. Todo o resto do app funciona sem ela.
```

### Keywords (100 caracteres)

```
projetos,tarefas,metas,produtividade,foco,cronograma,gantt,planejamento,equipe,prazo,timeline
```

93 caracteres. Não repita palavras que já estão no nome ou no subtítulo — a
Apple já indexa aquelas, e repetir desperdiça o espaço.

### Support URL — obrigatório

Precisa ser uma página real e acessível, com um jeito de falar com você. Uma
página simples com o nome do app, uma descrição de duas linhas e um email
resolve. Pode ser a mesma do site da LabDS.

### Marketing URL — opcional

Pode deixar em branco.

### Copyright

```
2026 LabDS
```

### Version e Build

`1.0` e `1`. Estão certos no projeto. A cada envio novo o **build** tem que
subir (2, 3, 4...), mesmo que a versão continue 1.0.

### App Review Information

**Sign-in required**: **No**. O app não tem conta.

**Contact**: seu nome, telefone e email.

**Notes** — este campo importa muito aqui, porque o app tem duas coisas que o
revisor não consegue testar sozinho:

```
O app e totalmente local: nao ha conta, cadastro nem servidor. Basta abrir e
usar.

FUNCOES QUE USAM O GOOGLE GEMINI (opcionais)
Duas funcoes usam a API do Google Gemini com a chave do proprio usuario,
configurada em Mais > Ajustes: "Planejar com IA", no Backlog, e o ditado por
microfone nos campos de texto, que envia o audio para transcricao. Sem chave,
o app avisa e todo o restante continua funcionando normalmente.
Para testar esta funcao: [COLE AQUI UMA CHAVE DO GEMINI, ou remova este
paragrafo se preferir que a funcao nao seja testada]

TRANSFERENCIA PELO WI-FI (opcional)
Em Mais > Ajustes > Levar para outro aparelho existe uma busca por um
computador na mesma rede, rodando a versao desktop do Chronos. Nao ha como
testar isso no ambiente de revisao, e a funcao nao e necessaria para usar o
app. A mesma tela oferece exportar e importar por arquivo, que funciona
sozinha.

ONDE VER CADA PERMISSAO
- Contatos: Mais > Equipe > botao "Da agenda". Serve para cadastrar membros
  sem digitar nome, email e telefone.
- Microfone: o icone de microfone nos campos de descricao, para ditar texto.
  Requer a chave do Gemini, porque a transcricao e feita por ela.
- Rede local: so na busca por computador descrita acima.
- Notificacoes: Mais > Ajustes > Avisos de tarefa.
```

Se você colar uma chave do Gemini aí, crie uma só para isso e revogue depois
da aprovação.

### Version Release

**Manually release this version** — assim o app não vai ao ar sozinho no
minuto em que for aprovado, e você escolhe a hora.

---

## Parte 6 — Enviar o build

No Xcode, com o esquema em **Any iOS Device (arm64)**:

1. *Product → Archive*
2. No Organizer: *Distribute App → App Store Connect → Upload*
3. Espere o processamento (de dez minutos a uma hora). Chega um email quando
   o build aparece na versão.
4. Selecione o build na página da versão e aperte *Add for Review*.

A primeira revisão costuma levar de um a três dias.

---

## O que eu ainda recomendo antes de enviar

**Passe pelo TestFlight primeiro.** O mesmo build sobe, você instala pelo
TestFlight no seu aparelho e usa por uma semana. Testes internos (até cem
pessoas da sua equipe) não passam por revisão da Apple, então é de graça em
tempo. Achar um bug ali custa um envio novo; achar depois de publicado custa
uma atualização e a nota na loja.

**A tela de abertura ainda é a arte do template.** Ela aparece em todo
lançamento do app e não está no checklist da Apple, mas está na primeira
impressão de quem instala.
