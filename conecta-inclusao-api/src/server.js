// Importa dotenv para carregar variáveis de ambiente do arquivo .env 
import dotenv from "dotenv"; 
// Carrega as variáveis de ambiente antes de qualquer outra configuração 
// Isso garante que process.env.PORT e outras variáveis estejam disponíveis 
dotenv.config(); 
// Importa a aplicação Express já configurada com middlewares e rotas 
import { server } from "./app.js"; 
// Define a porta em que a aplicação vai rodar 
// Usa a variável de ambiente PORT se estiver definida, caso contrário usa 3000 como padrão 
const port = Number(process.env.PORT || 3000); 
// Inicia o servidor Express na porta especificada 
// O callback é executado quando o servidor está escutando com sucesso 
server.listen(port, () => { 
// Exibe mensagem de sucesso no console informando a URL da API 
console.log(`API rodando em http://localhost:${port}`); 
});