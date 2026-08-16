// env.js carrega o dotenv e valida as variaveis obrigatorias. Precisa vir antes
// de qualquer import que leia configuracao.
import { env } from "./env.js";
import { server } from "./app.js";

server.listen(env.PORT, () => {
  console.log(`API rodando em http://localhost:${env.PORT}`);
});

// Encerra o pool de conexoes de forma limpa quando o Render reinicia o servico.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`Recebido ${signal}, encerrando servidor...`);
    server.close(() => process.exit(0));
  });
}
