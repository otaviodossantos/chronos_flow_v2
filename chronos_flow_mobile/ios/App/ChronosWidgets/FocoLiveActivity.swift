import SwiftUI
import WidgetKit
import ActivityKit

/// A Ilha Dinamica.
///
/// Nenhum texto aqui e redesenhado pelo app: `Text(timerInterval:)` conta
/// sozinho, dentro do processo do sistema. E o unico jeito de a ilha seguir
/// certa com o app fechado — e a razao de o app so enviar uma atualizacao
/// quando o *fim* muda (pausa, retomada, prazo alterado), nunca a cada segundo.
struct FocoLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FocoAttributes.self) { contexto in
            // Tela bloqueada e Central de Notificacoes.
            HStack(spacing: 12) {
                Indicador(estado: contexto.state)
                    .frame(width: 34, height: 34)

                VStack(alignment: .leading, spacing: 2) {
                    Text(contexto.state.titulo)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    if !contexto.state.trilha.isEmpty {
                        Text(contexto.state.trilha)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 4)
                Contador(estado: contexto.state)
                    .font(.system(.title3, design: .monospaced).weight(.semibold))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .activityBackgroundTint(Color.black.opacity(0.55))
            .activitySystemActionForegroundColor(.white)

        } dynamicIsland: { contexto in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Indicador(estado: contexto.state)
                        .frame(width: 42, height: 42)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Contador(estado: contexto.state)
                        .font(.system(.title2, design: .monospaced).weight(.semibold))
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(contexto.state.titulo)
                            .font(.headline)
                            .lineLimit(1)
                        if !contexto.state.trilha.isEmpty {
                            Text(contexto.state.trilha)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        if contexto.state.pausado {
                            Label("Pausado", systemImage: "pause.fill")
                                .font(.caption2)
                                .foregroundStyle(.orange)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                Image(systemName: contexto.state.pausado ? "pause.fill" : "target")
                    .foregroundStyle(contexto.state.pausado ? .orange : .green)
            } compactTrailing: {
                Contador(estado: contexto.state)
                    .font(.system(.caption, design: .monospaced).weight(.semibold))
                    // Sem largura fixa a ilha "respira" a cada minuto que muda
                    // de largura, e o movimento chama mais atencao que o numero.
                    .frame(width: 44)
            } minimal: {
                Image(systemName: contexto.state.pausado ? "pause.fill" : "target")
                    .foregroundStyle(contexto.state.pausado ? .orange : .green)
            }
            // Tocar leva direto a tarefa, e nao a ultima tela aberta.
            .widgetURL(URL(string: "chronosflow://tarefa/\(contexto.attributes.nodeId)"))
            .keylineTint(.green)
        }
    }
}

/// O numero que anda. Pausado, vira um tempo fixo: `timerInterval` nao tem
/// como parar, e deixa-lo correndo mostraria um tempo que nao esta passando.
private struct Contador: View {
    let estado: FocoAttributes.ContentState

    var body: some View {
        if let pausa = estado.pausadoEm {
            Text(formatado(estado.fim.timeIntervalSince(pausa)))
                .foregroundStyle(.orange)
        } else {
            Text(timerInterval: Date()...estado.fim, countsDown: true)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
        }
    }

    private func formatado(_ segundos: TimeInterval) -> String {
        let s = max(0, Int(segundos))
        return String(format: "%02d:%02d", s / 60, s % 60)
    }
}

/// Anel de progresso. Preenche sozinho, pelo mesmo intervalo do contador.
private struct Indicador: View {
    let estado: FocoAttributes.ContentState

    var body: some View {
        ZStack {
            Circle().stroke(.white.opacity(0.18), lineWidth: 4)
            if estado.pausado {
                Image(systemName: "pause.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.orange)
            } else {
                ProgressView(timerInterval: estado.intervalo, countsDown: false) {
                    EmptyView()
                } currentValueLabel: {
                    EmptyView()
                }
                .progressViewStyle(.circular)
                .tint(.green)
            }
        }
    }
}
