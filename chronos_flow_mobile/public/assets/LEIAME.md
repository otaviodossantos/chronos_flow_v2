`sql-wasm.wasm` so serve ao navegador.

No iPhone o banco e o SQLite do proprio sistema, via @capacitor-community/sqlite.
No navegador — `npm run dev`, para mexer no layout sem compilar o app — esse
plugin cai no `jeep-sqlite`, que roda o SQLite em WebAssembly e busca este
arquivo em `/assets/sql-wasm.wasm`. Sem ele a primeira pintura fica em branco.

Vem de `node_modules/sql.js/dist/sql-wasm.wasm`; se o sql.js subir de versao,
copie de novo.
