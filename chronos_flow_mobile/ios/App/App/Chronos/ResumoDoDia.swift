import Foundation

/// O App Group que o app e os widgets dividem.
///
/// Precisa estar ativado nos dois alvos em Signing & Capabilities, com
/// exatamente este identificador. Sem ele `containerURL` devolve nil e o
/// widget fica para sempre no estado de exemplo.
enum Compartilhado {
    static let grupo = "group.br.com.labds.chronosflow"
    static let arquivo = "resumo-do-dia.json"

    static var url: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: grupo)?
            .appendingPathComponent(arquivo)
    }
}

/// O que os widgets da tela inicial mostram.
///
/// Um arquivo JSON, e nao o banco: o widget roda em outro processo, com poucos
/// milissegundos e pouca memoria, e abrir um SQLite de centenas de tarefas ali
/// e pedir para o sistema matar a extensao antes de ela desenhar.
struct ResumoDoDia: Codable, Hashable {
    var proxima: String?
    var proximaInicio: Date?
    var pendentes: Int
    var concluidasHoje: Int
    var minutosFocados: Int
    var metaDeMinutos: Int
    var impactoDoDia: Double
    /// Quando o app gravou isto. O widget mostra "ha X min" num dia parado.
    var gravadoEm: Date

    static let exemplo = ResumoDoDia(
        proxima: "Revisar a proposta",
        proximaInicio: Date().addingTimeInterval(3600),
        pendentes: 5,
        concluidasHoje: 2,
        minutosFocados: 95,
        metaDeMinutos: 240,
        impactoDoDia: 3.4,
        gravadoEm: Date()
    )

    /// Fracao da meta diaria ja cumprida, limitada a 1.
    var fracaoDaMeta: Double {
        guard metaDeMinutos > 0 else { return 0 }
        return min(1, Double(minutosFocados) / Double(metaDeMinutos))
    }

    static func ler() -> ResumoDoDia {
        guard let url = Compartilhado.url,
              let dados = try? Data(contentsOf: url),
              let resumo = try? JSONDecoder.chronos.decode(ResumoDoDia.self, from: dados)
        else { return .exemplo }
        return resumo
    }

    func gravar() throws {
        guard let url = Compartilhado.url else {
            throw NSError(domain: "ChronosNative", code: 1, userInfo: [
                NSLocalizedDescriptionKey:
                    "App Group \(Compartilhado.grupo) nao esta ativado neste alvo."
            ])
        }
        try JSONEncoder.chronos.encode(self).write(to: url, options: .atomic)
    }
}

/// Datas em ISO-8601, que e como o JavaScript as envia e como o Swift as le.
/// Sem isto o decodificador espera um numero e falha em toda leitura.
extension JSONDecoder {
    static let chronos: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()
}

extension JSONEncoder {
    static let chronos: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()
}
