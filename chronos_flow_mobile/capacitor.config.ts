import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Tudo mora no aparelho. Nao ha `server.url`, nao ha origem remota: o bundle e
 * servido de dentro do app e o banco e um arquivo SQLite local.
 */
const config: CapacitorConfig = {
  appId: 'br.com.labds.chronosflow',
  appName: 'Chronos Flow',
  webDir: 'dist',
  ios: {
    contentInset: 'always',
    // O app e escuro; sem isto a barra de rolagem e o overscroll saem claros.
    backgroundColor: '#0a0a0a',
    /**
     * Precisa ser falso.
     *
     * Com App-Bound Domains ligado, o WKWebView so fala com os dominios
     * declarados no Info.plist — e o computador na rede de casa aparece como
     * um IP qualquer, que muda de uma rede para outra e nao da para declarar.
     * Ligado, a busca pelo Wi-Fi acha o Mac e o `fetch` seguinte morre sem
     * explicacao nenhuma no console.
     *
     * O app continua sem origem remota: o bundle e servido de dentro dele, e a
     * unica coisa que ele busca fora e a transferencia que voce pediu.
     */
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      // O mesmo App Group que a extensao da Ilha e os widgets enxergam.
      iosIsEncryption: false,
    },
  },
};

export default config;
