import SwiftUI
import WidgetKit

/// O ponto de entrada da extensao. Um `@main` so, listando tudo o que ela
/// publica: os widgets da tela inicial e a Live Activity da Ilha Dinamica.
///
/// A Live Activity entra aqui e nao num alvo proprio — e o widget que o
/// sistema instancia quando o app chama `Activity.request`.
@main
struct ChronosWidgetBundle: WidgetBundle {
    var body: some Widget {
        ResumoWidget()
        FocoLiveActivity()
    }
}
