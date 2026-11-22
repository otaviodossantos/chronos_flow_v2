import Foundation
import Capacitor
import ActivityKit
import WidgetKit
import AVFoundation
import UIKit
import Contacts
import ContactsUI
import UserNotifications

/// A ponte entre o JavaScript e o que so o iOS sabe fazer.
///
/// Tudo o que entra aqui vem de `src/native/chronos.ts`. O lado de la engole
/// os erros de proposito: uma Live Activity recusada nao pode derrubar o
/// cronometro dentro do app.
@objc(ChronosNativePlugin)
public class ChronosNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ChronosNativePlugin"
    public let jsName = "ChronosNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "iniciarFoco", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "atualizarFoco", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "encerrarFoco", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "estadoDoFoco", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "publicarResumo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "abrirAjustes", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "estadoDoMicrofone", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "vibrar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "procurarDesktops", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "escolherContatos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listarContatos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "estadoDosAvisos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pedirPermissaoDeAvisos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sincronizarAvisos", returnType: CAPPluginReturnPromise),
    ]

    private let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        // O JavaScript manda milissegundos; sem esta opcao toda data falha.
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private func data(_ texto: String?) -> Date? {
        guard let texto else { return nil }
        return iso.date(from: texto) ?? ISO8601DateFormatter().date(from: texto)
    }

    // MARK: - Live Activity

    @available(iOS 16.1, *)
    private var atividades: [Activity<FocoAttributes>] { Activity<FocoAttributes>.activities }

    @objc func iniciarFoco(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            return call.resolve(["ativo": false])
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            return call.reject("As Atividades ao Vivo estao desligadas para o Chronos Flow.")
        }
        guard let nodeId = call.getString("nodeId"),
              let fim = data(call.getString("fim")) else {
            return call.reject("Faltou nodeId ou fim.")
        }

        // Uma tarefa de cada vez. Sem isto, trocar de foco deixaria a anterior
        // contando na ilha — duas contagens, e nenhuma delas confiavel.
        Task {
            for antiga in atividades {
                await antiga.end(nil, dismissalPolicy: .immediate)
            }

            let estado = FocoAttributes.ContentState(
                fim: fim,
                pausadoEm: data(call.getString("pausadoEm")),
                totalSegundos: call.getDouble("totalSegundos") ?? 1500,
                titulo: call.getString("titulo") ?? "Foco",
                trilha: call.getString("trilha") ?? ""
            )

            do {
                _ = try Activity.request(
                    attributes: FocoAttributes(nodeId: nodeId),
                    content: .init(state: estado, staleDate: fim.addingTimeInterval(3600)),
                    pushType: nil // tudo local: nao ha servidor nenhum neste app
                )
                call.resolve(["ativo": true])
            } catch {
                call.reject("Nao foi possivel abrir a Atividade ao Vivo: \(error.localizedDescription)")
            }
        }
    }

    @objc func atualizarFoco(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { return call.resolve(["ativo": false]) }
        guard let nodeId = call.getString("nodeId") else {
            return call.reject("Faltou nodeId.")
        }
        guard let atividade = atividades.first(where: { $0.attributes.nodeId == nodeId }) else {
            return call.resolve(["ativo": false])
        }

        Task {
            var estado = atividade.content.state
            if let fim = data(call.getString("fim")) { estado.fim = fim }
            if let total = call.getDouble("totalSegundos") { estado.totalSegundos = total }
            if let titulo = call.getString("titulo") { estado.titulo = titulo }
            if let trilha = call.getString("trilha") { estado.trilha = trilha }
            // `pausadoEm` ausente significa "voltou a correr", e nao "nao mexa":
            // e por isso que ele e lido sempre, inclusive quando vem nulo.
            estado.pausadoEm = data(call.getString("pausadoEm"))

            await atividade.update(.init(state: estado,
                                         staleDate: estado.fim.addingTimeInterval(3600)))
            call.resolve(["ativo": true])
        }
    }

    @objc func encerrarFoco(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { return call.resolve(["ativo": false]) }
        let nodeId = call.getString("nodeId")

        Task {
            for atividade in atividades where nodeId == nil || atividade.attributes.nodeId == nodeId {
                await atividade.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve(["ativo": false])
        }
    }

    @objc func estadoDoFoco(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *), let atual = atividades.first else {
            return call.resolve(["ativo": false])
        }
        call.resolve(["ativo": true, "nodeId": atual.attributes.nodeId])
    }

    // MARK: - Widgets

    @objc func publicarResumo(_ call: CAPPluginCall) {
        let resumo = ResumoDoDia(
            proxima: call.getString("proxima"),
            proximaInicio: data(call.getString("proximaInicio")),
            pendentes: call.getInt("pendentes") ?? 0,
            concluidasHoje: call.getInt("concluidasHoje") ?? 0,
            minutosFocados: call.getInt("minutosFocados") ?? 0,
            metaDeMinutos: call.getInt("metaDeMinutos") ?? 0,
            impactoDoDia: call.getDouble("impactoDoDia") ?? 0,
            gravadoEm: Date()
        )

        do {
            try resumo.gravar()
            // Gravar o arquivo nao redesenha nada: o widget so relê quando o
            // sistema recarrega a linha do tempo dele.
            WidgetCenter.shared.reloadAllTimelines()
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    // MARK: - Sistema

    @objc func abrirAjustes(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else {
                return call.reject("Nao foi possivel montar o link dos Ajustes.")
            }
            UIApplication.shared.open(url)
            call.resolve()
        }
    }

    @objc func estadoDoMicrofone(_ call: CAPPluginCall) {
        let status: String
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted: status = "granted"
        case .denied: status = "denied"
        case .undetermined: status = "prompt"
        @unknown default: status = "prompt"
        }
        call.resolve(["status": status])
    }

    // MARK: - Rede local

    @objc func procurarDesktops(_ call: CAPPluginCall) {
        let duracao = call.getDouble("segundos") ?? 2.5
        DescobertaNaRede.procurar(duracao: duracao) { achados, diagnostico in
            call.resolve([
                "desktops": achados.map(\.dicionario),
                // Vai sempre, mesmo quando achou: e com ele que a tela
                // consegue dizer *por que* nao achou, em vez de so dizer que
                // nao achou.
                "diagnostico": diagnostico.dicionario,
            ])
        }
    }

    @objc func vibrar(_ call: CAPPluginCall) {
        let tipo = call.getString("tipo") ?? "leve"
        DispatchQueue.main.async {
            switch tipo {
            case "sucesso":
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "medio":
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            default:
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
            call.resolve()
        }
    }

    // MARK: - Avisos de tarefa

    /// Prefixo de todo aviso que a sincronizacao arma.
    ///
    /// Ela apaga e regrava, e precisa apagar **so o que e dela**. Um
    /// `removeAllPendingNotificationRequests` levaria junto qualquer outro
    /// aviso que o app venha a agendar — o fim de um bloco de foco, por
    /// exemplo — sem que o codigo daqui soubesse que fez isso.
    private static let prefixoDoAviso = "chronos.aviso."

    private func textoDoEstado(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized, .provisional, .ephemeral: return "ok"
        case .denied: return "negada"
        case .notDetermined: return "nao-perguntado"
        @unknown default: return "nao-perguntado"
        }
    }

    @objc func estadoDosAvisos(_ call: CAPPluginCall) {
        let centro = UNUserNotificationCenter.current()
        centro.getNotificationSettings { ajustes in
            centro.getPendingNotificationRequests { pendentes in
                let meus = pendentes.filter {
                    $0.identifier.hasPrefix(ChronosNativePlugin.prefixoDoAviso)
                }
                call.resolve([
                    "permissao": self.textoDoEstado(ajustes.authorizationStatus),
                    // O que esta realmente armado no sistema, e nao o que o app
                    // acha que armou: e a unica resposta honesta para a tela de
                    // ajustes, que promete "12 avisos armados".
                    "armados": meus.count,
                    // O iOS guarda 64 e descarta o excedente em silencio.
                    "totalNoSistema": pendentes.count,
                ])
            }
        }
    }

    @objc func pedirPermissaoDeAvisos(_ call: CAPPluginCall) {
        // `.sound` junto com `.alert` e o que faz o aparelho vibrar e tocar.
        // So `.alert` daria um aviso mudo, que para "faltam 5 minutos" e quase
        // o mesmo que nao avisar.
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .sound, .badge]
        ) { liberado, erro in
            if let erro {
                return call.reject("Nao foi possivel pedir permissao: \(erro.localizedDescription)")
            }
            call.resolve(["permissao": liberado ? "ok" : "negada"])
        }
    }

    /// Substitui todos os avisos de tarefa pelo plano que o app mandou.
    ///
    /// Substituir inteiro, e nao calcular a diferenca: o plano chega pronto e
    /// ordenado do lado JavaScript, e comparar o que ja existe com o que
    /// deveria existir seria reimplementar, em Swift, uma decisao que ja foi
    /// tomada. Apagar e regravar e idempotente — rearmar duas vezes seguidas
    /// deixa o sistema no mesmo estado.
    @objc func sincronizarAvisos(_ call: CAPPluginCall) {
        let centro = UNUserNotificationCenter.current()
        let avisos = call.getArray("avisos", JSObject.self) ?? []

        centro.getPendingNotificationRequests { pendentes in
            let meus = pendentes
                .map(\.identifier)
                .filter { $0.hasPrefix(ChronosNativePlugin.prefixoDoAviso) }
            centro.removePendingNotificationRequests(withIdentifiers: meus)

            // O contador atravessa varias respostas do sistema, que chegam
            // em filas quaisquer. Sem a trava, somar seria corrida de dados.
            var armados = 0
            let trava = NSLock()
            let grupo = DispatchGroup()

            for aviso in avisos {
                guard let id = aviso["id"] as? String,
                      let titulo = aviso["titulo"] as? String,
                      let quandoTexto = aviso["quando"] as? String,
                      let quando = self.data(quandoTexto) else { continue }

                // Agendar no passado e aceito em silencio pelo iOS e nunca
                // dispara. O plano ja filtra, mas o tempo passa entre montar o
                // plano e chegar aqui.
                let faltam = quando.timeIntervalSinceNow
                guard faltam > 0 else { continue }

                let conteudo = UNMutableNotificationContent()
                conteudo.title = titulo
                conteudo.body = (aviso["corpo"] as? String) ?? ""
                conteudo.sound = .default
                conteudo.userInfo = ["nodeId": (aviso["nodeId"] as? String) ?? ""]
                if #available(iOS 15.0, *) {
                    // Atravessa os modos de Foco. Sem isto, o aviso de uma
                    // tarefa que comeca em cinco minutos chegaria calado
                    // justamente durante o Foco de trabalho — a hora em que
                    // ele e mais util.
                    conteudo.interruptionLevel = .timeSensitive
                    conteudo.relevanceScore = 1.0
                }

                // Intervalo e nao calendario: o plano ja resolveu o fuso ao
                // mandar um instante ISO, e um `UNCalendarNotificationTrigger`
                // reinterpretaria esse instante no fuso do aparelho.
                let gatilho = UNTimeIntervalNotificationTrigger(timeInterval: faltam, repeats: false)
                let pedido = UNNotificationRequest(
                    identifier: ChronosNativePlugin.prefixoDoAviso + id,
                    content: conteudo,
                    trigger: gatilho
                )

                grupo.enter()
                centro.add(pedido) { erro in
                    if erro == nil {
                        trava.lock()
                        armados += 1
                        trava.unlock()
                    }
                    grupo.leave()
                }
            }

            grupo.notify(queue: .main) {
                call.resolve(["armados": armados, "pedidos": avisos.count])
            }
        }
    }

    // MARK: - Contatos

    /// A chamada aberta enquanto o seletor esta na tela.
    ///
    /// O seletor devolve o resultado por delegate, muito depois de o metodo
    /// ter retornado, entao a promessa do JavaScript fica guardada aqui ate
    /// alguem escolher ou cancelar.
    private var chamadaDosContatos: CAPPluginCall?

    /// Abre a agenda do iPhone para escolher uma ou varias pessoas.
    ///
    /// **Nao pede permissao de contatos, e isso e de proposito.** O
    /// `CNContactPickerViewController` roda num processo separado do app: quem
    /// ve a agenda inteira e o sistema, e o app recebe so o que a pessoa
    /// escolheu. Por isso ele dispensa a autorizacao de Contatos e dispensa o
    /// `NSContactsUsageDescription` no Info.plist. Ler a agenda pelo
    /// `CNContactStore` daria mais poder e exigiria as duas coisas — e, para
    /// cadastrar time, nao da nada em troca.
    @objc func escolherContatos(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let dono = self.bridge?.viewController else {
                return call.reject("Sem tela para abrir a agenda.")
            }
            // Uma chamada pendente por vez: duas promessas esperando o mesmo
            // delegate deixaria a primeira sem resposta para sempre.
            self.chamadaDosContatos?.resolve(["contatos": [] as [Any], "cancelado": true])
            self.chamadaDosContatos = call

            let seletor = CNContactPickerViewController()
            seletor.delegate = self
            // `displayedPropertyKeys` fica de fora de proposito: restringir o
            // que o seletor MOSTRA pode restringir o que ele DEVOLVE, e o
            // email e o telefone sao justamente o que poupa digitacao aqui.
            dono.present(seletor, animated: true)
        }
    }


    /// Devolve a agenda inteira, para o app montar a propria lista com busca.
    ///
    /// O seletor do sistema (`escolherContatos`) nao tem campo de pesquisa
    /// quando esta em selecao multipla — numa agenda de centenas de nomes,
    /// achar quatro pessoas vira rolagem pela letra. Ler a agenda aqui custa a
    /// permissao de Contatos, que o seletor dispensava; e a troca que compra a
    /// busca, e por isso o seletor continua existindo como caminho B para quem
    /// negar.
    ///
    /// Responde `permissao: "negada"` em vez de rejeitar: negar nao e falha,
    /// e a tela precisa diferenciar "disse nao" de "deu erro" para oferecer os
    /// Ajustes em vez de um toast vermelho.
    @objc func listarContatos(_ call: CAPPluginCall) {
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .notDetermined:
            CNContactStore().requestAccess(for: .contacts) { liberado, _ in
                if liberado { self.entregarAgenda(call) }
                else { call.resolve(["permissao": "negada", "contatos": [] as [Any]]) }
            }
        case .denied, .restricted:
            call.resolve(["permissao": "negada", "contatos": [] as [Any]])
        default:
            // Inclui o acesso limitado do iOS 18: ali a enumeracao devolve so
            // o subconjunto que a pessoa liberou, que e exatamente o certo.
            entregarAgenda(call)
        }
    }

    private func entregarAgenda(_ call: CAPPluginCall) {
        // Fora da main thread: uma agenda grande leva um tempo visivel, e
        // travar a interface durante a leitura pareceria o app ter morrido.
        DispatchQueue.global(qos: .userInitiated).async {
            let chaves: [CNKeyDescriptor] = [
                // Sem este descritor, `CNContactFormatter.string` lanca excecao
                // em vez de formatar.
                CNContactFormatter.descriptorForRequiredKeys(for: .fullName),
                CNContactGivenNameKey as CNKeyDescriptor,
                CNContactFamilyNameKey as CNKeyDescriptor,
                CNContactOrganizationNameKey as CNKeyDescriptor,
                CNContactEmailAddressesKey as CNKeyDescriptor,
                CNContactPhoneNumbersKey as CNKeyDescriptor,
            ]

            let pedido = CNContactFetchRequest(keysToFetch: chaves)
            // A ordem que a pessoa escolheu nos Ajustes do iPhone.
            pedido.sortOrder = .userDefault

            var saida: [[String: Any]] = []
            do {
                try CNContactStore().enumerateContacts(with: pedido) { contato, _ in
                    let linha = self.dicionario(contato)
                    // Contato sem nome nenhum (so telefone solto) nao vira
                    // membro: o cadastro exige nome, e uma linha vazia na lista
                    // so atrapalha a busca.
                    if !((linha["nome"] as? String) ?? "").isEmpty { saida.append(linha) }
                }
            } catch {
                return call.reject("Nao foi possivel ler a agenda: \(error.localizedDescription)")
            }
            call.resolve(["permissao": "ok", "contatos": saida])
        }
    }

    /// Nome, email e telefone de um contato, no formato que o JavaScript espera.
    ///
    /// Cada campo e lido so depois de `isKeyAvailable`: o seletor entrega os
    /// contatos com um conjunto parcial de chaves, e tocar numa que nao veio
    /// derruba o app com uma excecao em vez de devolver nil.
    fileprivate func dicionario(_ contato: CNContact) -> [String: Any] {
        let nome: String = {
            if let formatado = CNContactFormatter.string(from: contato, style: .fullName),
               !formatado.trimmingCharacters(in: .whitespaces).isEmpty {
                return formatado
            }
            let partes = [contato.givenName, contato.familyName]
                .filter { !$0.isEmpty }
                .joined(separator: " ")
            return partes.isEmpty ? contato.organizationName : partes
        }()

        var email = ""
        if contato.isKeyAvailable(CNContactEmailAddressesKey) {
            email = (contato.emailAddresses.first?.value as String?) ?? ""
        }

        var telefone = ""
        if contato.isKeyAvailable(CNContactPhoneNumbersKey) {
            telefone = contato.phoneNumbers.first?.value.stringValue ?? ""
        }

        return [
            "id": contato.identifier,
            "nome": nome,
            "email": email,
            "telefone": telefone,
        ]
    }
}

extension ChronosNativePlugin: CNContactPickerDelegate {
    /// Implementar a versao no PLURAL e o que liga a selecao multipla no
    /// seletor do iOS — nao ha propriedade para isso. Com so a versao
    /// singular, cada toque fecharia a tela depois de uma pessoa.
    public func contactPicker(_ picker: CNContactPickerViewController, didSelect contacts: [CNContact]) {
        let chamada = chamadaDosContatos
        chamadaDosContatos = nil
        chamada?.resolve([
            "contatos": contacts.map { dicionario($0) },
            "cancelado": false,
        ])
    }

    public func contactPickerDidCancel(_ picker: CNContactPickerViewController) {
        let chamada = chamadaDosContatos
        chamadaDosContatos = nil
        // Cancelar nao e erro: a tela do app so precisa saber que nao veio
        // ninguem, e rejeitar aqui viraria um toast de falha a cada desistencia.
        chamada?.resolve(["contatos": [] as [Any], "cancelado": true])
    }
}
