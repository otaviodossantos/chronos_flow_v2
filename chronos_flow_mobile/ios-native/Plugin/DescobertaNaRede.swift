import Foundation
import Network

/// Acha o Chronos do computador na mesma rede.
///
/// **Por que Bonjour e nao UDP.** O desktop responde nas duas pontas, mas o
/// iPhone so pode usar esta. Desde o iOS 14 a Apple exige a permissao
/// `com.apple.developer.networking.multicast` para um app *enviar ou receber*
/// broadcast e multicast — e ela e concedida sob pedido, caso a caso, por
/// formulario. Bonjour com um tipo de servico declarado em `NSBonjourServices`
/// fica fora dessa exigencia: pede so a permissao de rede local, aquela que o
/// sistema pergunta na primeira vez e o usuario responde ali mesmo.
///
/// O `NWBrowser` devolve um *nome de servico*, nao um endereco. Quem precisa
/// do IP e o WebView, que fala HTTP — entao cada achado e resolvido abrindo
/// uma conexao de verdade e lendo o endereco por onde ela saiu.
enum DescobertaNaRede {
    static let tipo = "_chronos._tcp"

    struct Achado {
        var nome: String
        var host: String
        var porta: Int

        var dicionario: [String: Any] { ["nome": nome, "host": host, "porta": porta] }
    }

    /**
     Onde a busca parou, quando ela nao acha nada.

     "Nenhum computador encontrado" cobria quatro falhas diferentes com a mesma
     frase: a permissao de rede local negada, a chave `NSBonjourServices`
     ausente, o Mac que nao esta anunciando, e o anuncio que chega mas nao
     conecta (tipicamente o firewall do macOS barrando o processo do Node).
     Cada uma pede uma acao diferente, entao cada uma precisa aparecer.

     `vistos` conta os servicos que o mDNS entregou; `resolvidos`, quantos
     viraram endereco de verdade. A diferenca entre os dois e justamente o caso
     do firewall.
     */
    struct Diagnostico {
        var estado: String = "iniciando"
        var detalhe: String = ""
        var vistos: Int = 0
        var resolvidos: Int = 0

        var dicionario: [String: Any] {
            ["estado": estado, "detalhe": detalhe, "vistos": vistos, "resolvidos": resolvidos]
        }
    }

    /// Procura por `duracao` segundos e devolve o que achou, com o diagnostico.
    static func procurar(duracao: TimeInterval = 2.5,
                         pronto: @escaping ([Achado], Diagnostico) -> Void) {
        let parametros = NWParameters()
        parametros.includePeerToPeer = true

        let browser = NWBrowser(
            for: .bonjour(type: tipo, domain: nil),
            using: parametros
        )

        // Serializa o acesso a lista: o browser e as resolucoes chegam em
        // filas diferentes, e dois `append` simultaneos corrompem o array.
        let fila = DispatchQueue(label: "chronos.descoberta")
        var achados: [Achado] = []
        var diagnostico = Diagnostico()
        var terminou = false

        let terminar = {
            fila.async {
                guard !terminou else { return }
                terminou = true
                browser.cancel()
                diagnostico.resolvidos = achados.count
                let copia = achados
                let diag = diagnostico
                DispatchQueue.main.async { pronto(copia, diag) }
            }
        }

        browser.browseResultsChangedHandler = { resultados, _ in
            fila.async { diagnostico.vistos = max(diagnostico.vistos, resultados.count) }
            let grupo = DispatchGroup()

            for resultado in resultados {
                guard case let .service(name: nome, type: _, domain: _, interface: _) = resultado.endpoint
                else { continue }

                // O nome bonito vem do TXT; sem ele sobra o nome do servico,
                // que ja carrega o nome da maquina.
                var rotulo = nome
                if case let .bonjour(txt) = resultado.metadata, let n = txt["nome"], !n.isEmpty {
                    rotulo = n
                }

                grupo.enter()
                resolver(endpoint: resultado.endpoint) { host, porta in
                    fila.async {
                        if let host, let porta,
                           !achados.contains(where: { $0.host == host && $0.porta == porta }) {
                            achados.append(Achado(nome: rotulo, host: host, porta: porta))
                        }
                        grupo.leave()
                    }
                }
            }

            grupo.notify(queue: fila) {
                // Nao termina na primeira leva: o mDNS costuma entregar os
                // servicos em ondas, e parar aqui perderia o segundo Mac.
            }
        }

        browser.stateUpdateHandler = { estado in
            fila.async {
                switch estado {
                case .ready:
                    diagnostico.estado = "ready"
                case let .waiting(erro):
                    // `waiting` com erro de DNS e o sintoma classico da
                    // permissao de rede local negada ou da chave
                    // NSBonjourServices faltando no Info.plist.
                    diagnostico.estado = "waiting"
                    diagnostico.detalhe = "\(erro)"
                case let .failed(erro):
                    diagnostico.estado = "failed"
                    diagnostico.detalhe = "\(erro)"
                case .cancelled:
                    diagnostico.estado = "cancelled"
                default:
                    break
                }
            }
            if case .failed = estado { terminar() }
        }

        browser.start(queue: .global(qos: .userInitiated))
        DispatchQueue.global().asyncAfter(deadline: .now() + duracao) { terminar() }
    }

    /// Abre uma conexao so para descobrir por qual endereco ela saiu.
    private static func resolver(endpoint: NWEndpoint,
                                 pronto: @escaping (String?, Int?) -> Void) {
        let conexao = NWConnection(to: endpoint, using: .tcp)
        var respondeu = false

        let responder = { (host: String?, porta: Int?) in
            guard !respondeu else { return }
            respondeu = true
            conexao.cancel()
            pronto(host, porta)
        }

        conexao.stateUpdateHandler = { estado in
            switch estado {
            case .ready:
                guard case let .hostPort(host: host, port: porta) = conexao.currentPath?.remoteEndpoint
                else { return responder(nil, nil) }
                responder(texto(de: host), Int(porta.rawValue))
            case .failed, .cancelled:
                responder(nil, nil)
            default:
                break
            }
        }

        conexao.start(queue: .global(qos: .userInitiated))
        // Um Mac que dormiu continua anunciado no cache do mDNS e nunca fica
        // pronto; sem este corte a busca inteira ficaria pendurada nele.
        DispatchQueue.global().asyncAfter(deadline: .now() + 2) { responder(nil, nil) }
    }

    /// `NWEndpoint.Host` imprime o IPv6 com o escopo colado ("fe80::1%en0"),
    /// e esse sufixo nao vale como host numa URL.
    private static func texto(de host: NWEndpoint.Host) -> String? {
        switch host {
        case let .ipv4(endereco):
            return "\(endereco)".split(separator: "%").first.map(String.init)
        case let .ipv6(endereco):
            guard let limpo = "\(endereco)".split(separator: "%").first else { return nil }
            return "[\(limpo)]"
        case let .name(nome, _):
            return nome
        @unknown default:
            return nil
        }
    }
}
