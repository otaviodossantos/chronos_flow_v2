import Foundation
import ActivityKit

/// O contrato entre o app e a Ilha Dinamica.
///
/// Este arquivo precisa estar em **dois alvos** — o app e a extensao de
/// widgets. Nao e duplicacao de codigo: a extensao roda em outro processo e
/// so entende a atividade se compilar a mesma declaracao. Tipos diferentes dos
/// dois lados fazem `Activity.request` falhar em silencio.
struct FocoAttributes: ActivityAttributes {
    /// O que muda enquanto a tarefa corre.
    struct ContentState: Codable, Hashable {
        /// Quando o bloco termina. A ilha conta sozinha a partir daqui — o app
        /// nao envia um tique por segundo, que o sistema recusaria.
        var fim: Date
        /// Preenchido quando esta pausado; nulo enquanto corre.
        var pausadoEm: Date?
        /// Duracao cheia do bloco, para desenhar o quanto ja passou.
        var totalSegundos: Double
        var titulo: String
        var trilha: String

        var pausado: Bool { pausadoEm != nil }

        /// Instante em que a contagem comecou, deduzido do fim e do total.
        /// A barra precisa de um intervalo, e nao de um numero solto.
        var inicio: Date { fim.addingTimeInterval(-totalSegundos) }

        var intervalo: ClosedRange<Date> {
            let a = inicio
            // Um intervalo de largura zero trava o SwiftUI; um segundo basta.
            return a <= fim ? a...fim : fim...fim.addingTimeInterval(1)
        }
    }

    /// Fixo durante toda a atividade.
    /// O id da tarefa vira o link `chronosflow://tarefa/<id>` do toque.
    var nodeId: String
}
