import SwiftUI
import WidgetKit

struct ResumoEntry: TimelineEntry {
    let date: Date
    let resumo: ResumoDoDia
}

/// O widget nao consulta o app: le o JSON que o app deixou no App Group.
///
/// A linha do tempo tem uma entrada so e `.after(15 min)`. Pedir atualizacoes
/// mais frequentes nao adianta — o sistema tem um orcamento diario de recargas
/// e o que mantem o widget em dia de verdade e o `reloadAllTimelines` que o
/// app dispara ao sair da tela.
struct ResumoProvider: TimelineProvider {
    func placeholder(in context: Context) -> ResumoEntry {
        ResumoEntry(date: Date(), resumo: .exemplo)
    }

    func getSnapshot(in context: Context, completion: @escaping (ResumoEntry) -> Void) {
        completion(ResumoEntry(date: Date(), resumo: context.isPreview ? .exemplo : .ler()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ResumoEntry>) -> Void) {
        let entrada = ResumoEntry(date: Date(), resumo: .ler())
        completion(Timeline(entries: [entrada],
                            policy: .after(Date().addingTimeInterval(15 * 60))))
    }
}

struct ResumoWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ResumoDoDia", provider: ResumoProvider()) { entrada in
            ResumoView(resumo: entrada.resumo)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Meu dia")
        .description("O proximo passo, o que ja fechou e quanto falta da meta.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

struct ResumoView: View {
    @Environment(\.widgetFamily) private var familia
    let resumo: ResumoDoDia

    var body: some View {
        switch familia {
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text(resumo.proxima ?? "Nada agendado")
                    .font(.headline)
                    .lineLimit(1)
                Text("\(resumo.pendentes) pendentes · \(resumo.concluidasHoje) hoje")
                    .font(.caption2)
            }
            .widgetURL(URL(string: "chronosflow://foco"))

        case .systemMedium:
            HStack(alignment: .top, spacing: 14) {
                coluna
                Divider()
                VStack(alignment: .leading, spacing: 8) {
                    Numero(valor: "\(resumo.pendentes)", rotulo: "na fila")
                    Numero(valor: "\(resumo.concluidasHoje)", rotulo: "fechadas hoje")
                    Numero(
                        valor: String(format: "%.1f%%", resumo.impactoDoDia),
                        rotulo: "de impacto"
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(URL(string: "chronosflow://foco"))

        default:
            coluna.widgetURL(URL(string: "chronosflow://foco"))
        }
    }

    private var coluna: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("AGORA")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.secondary)

            Text(resumo.proxima ?? "Nada agendado")
                .font(.system(size: 15, weight: .semibold))
                .lineLimit(2)
                .minimumScaleFactor(0.8)

            if let inicio = resumo.proximaInicio {
                Text(inicio, style: .time)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 2)

            // A meta diaria como barra: o numero sozinho nao diz se o dia
            // esta indo bem, e a barra responde isso de relance.
            ProgressView(value: resumo.fracaoDaMeta)
                .tint(.green)
            Text("\(resumo.minutosFocados)/\(resumo.metaDeMinutos) min de foco")
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct Numero: View {
    let valor: String
    let rotulo: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(valor).font(.system(size: 17, weight: .semibold))
            Text(rotulo).font(.system(size: 9)).foregroundStyle(.secondary)
        }
    }
}
