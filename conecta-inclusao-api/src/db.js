// Importa o driver MySQL2 com suporte a Promises (async/await) 
// mysql2/promise permite usar async/await em lugar de callbacks 
import mysql from "mysql2/promise"; 
// Importa dotenv para carregar variáveis de ambiente do arquivo .env 
import dotenv from "dotenv"; 
// Carrega as variáveis de ambiente do arquivo .env para process.env 
// Deve ser chamado no início da aplicação antes de acessar process.env.* 
dotenv.config(); 
// Cria e exporta um pool de conexões MySQL 
// Um pool mantém múltiplas conexões abertas e as reutiliza, melhorando 
performance 
export const pool = mysql.createPool({ 
// Host do servidor MySQL (obtido de variável de ambiente) 
host: process.env.DB_HOST, 
// Porta do servidor MySQL (padrão: 3306 se não especificado) 
port: Number(process.env.DB_PORT || 3306), 
// Usuário para autenticação no MySQL (obtido de variável de ambiente) 
user: process.env.DB_USER, 
// Senha para autenticação no MySQL (obtido de variável de ambiente) 
password: process.env.DB_PASS, 
// Nome do banco de dados a ser usado (obtido de variável de ambiente) 
database: process.env.DB_NAME, 
// Se verdadeiro, aguarda uma conexão disponível se o pool estiver cheio 
// Evita erros quando muitas requisições tentam usar o pool simultaneamente 
waitForConnections: true, 
// Número máximo de conexões simultâneas que o pool pode manter 
// Valor 10 significa até 10 conexões abertas simultaneamente 
connectionLimit: 10,
// Mantem DATETIME como texto para evitar conversao de fuso horario no JSON.
dateStrings: true
});
