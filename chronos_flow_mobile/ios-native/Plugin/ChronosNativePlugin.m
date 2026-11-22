/*
 Este arquivo existe vazio de proposito.

 Ate o Capacitor 5, um plugin que morava no proprio app era registrado por uma
 macro `CAP_PLUGIN(...)` aqui dentro. No Capacitor 8 isso nao registra mais
 nada: `CapacitorBridge.registerPlugins()` monta a lista a partir de
 `packageClassList`, no `capacitor.config.json` gerado, e nao varre as classes
 do binario. A macro ainda compila — e foi isso que enganou — mas o plugin
 nunca chegava a ser registrado, e toda chamada respondia
 "plugin is not implemented on ios".

 O registro agora e feito por `scripts/sincronizar-nativo.mjs`, que acrescenta
 `ChronosNativePlugin` aquela lista depois de cada `cap sync`. A classe Swift ja
 declara `identifier`, `jsName` e `pluginMethods` (conformando `CAPBridgedPlugin`),
 entao nao ha nada a declarar deste lado.

 A macro saiu em vez de ficar junto porque ela declarava
 `@interface ChronosNativePlugin : NSObject` e uma categoria com os mesmos
 metodos que a classe Swift ja tem — duas definicoes do mesmo nome, com a do
 Objective-C vencendo no runtime. Funcionava por acidente ou quebrava em
 silencio, conforme a ordem de compilacao.

 O arquivo continua no alvo para nao exigir uma remocao manual no Xcode.
*/
