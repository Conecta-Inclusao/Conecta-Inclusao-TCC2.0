// Importa o framework Express para criar a aplicação web 
import path from "path";
import { fileURLToPath } from "url";
import express from "express"; 
// Importa o Helmet, que adiciona headers de segurança HTTP à aplicação 
import helmet from "helmet"; 
// Importa o CORS (Cross-Origin Resource Sharing) para permitir requisições de outros domínios 
import cors from "cors"; 
// Importa o express-rate-limit para limitar o número de requisições por IP 
import rateLimit from "express-rate-limit"; 
// Importa as rotas de autenticação definidas no arquivo auth.routes.js 
import authAdvancedRoutes from "./routes/auth.advanced.routes.js";
import messageRoutes from "./routes/messages.routes.js";
import clinicaRoutes from "./routes/clinica.routes.js";
import agendamentosRoutes from "./routes/agendamentos.routes.js";

// Exporta como named export para ser usada em outros arquivos (como server.js) 
export const app = express(); 

// ============================================ 
// MIDDLEWARES DE SEGURANÇA 
// ============================================ 
// Aplicar Helmet para adicionar headers de segurança HTTP padrão 
// Protege contra ataques comuns como XSS, Clickjacking, etc 
app.use(helmet()); 

// ============================================ 
// MIDDLEWARES DE CROSS-ORIGIN (CORS) - DEVE VIR ANTES DAS ROTAS
// ============================================ 
// Configura CORS para aceitar requisições de qualquer origem 
app.use(cors({ 
// origin: true permite que qualquer domínio faça requisições para a API 
origin: true, 
// credentials: true permite que credenciais (cookies, autenticação) sejam enviadas
credentials: true,
// methods: especifica os métodos HTTP permitidos
methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
// headers: especifica headers permitidos
allowedHeaders: ['Content-Type', 'Authorization']
})); 

// ============================================ 
// MIDDLEWARES DE PARSING DE DADOS 
// ============================================ 
// Middleware para parsear corpo de requisições JSON 
// Limita o tamanho máximo de arquivo enviado a 50KB para evitar requisições maliciosas muito grandes 
app.use(express.json({ limit: "50kb" })); 
// ============================================ 
// MIDDLEWARES DE RATE LIMITING GERAL 
// ============================================ 
// Rate limiter global para proteção geral da API (não específico como o de login) 
app.use(rateLimit({ 
// Janela de tempo de 60 segundos para contar requisições 
windowMs: 60 * 1000, 
// Permite até 300 requisições por IP a cada 60 segundos 
limit: 300 
})); 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendSrcPath = path.join(__dirname, "../conecta-inclusao-front/src");
app.use(express.static(frontendSrcPath));
app.get('/reset-password.html', (req, res) => {
  res.sendFile(path.join(frontendSrcPath, 'pages', 'reset-password.html'));
});
// ============================================ 
// ROTAS DA API 
// ============================================ 
// Registra as rotas de autenticação sob o prefixo "/api/auth" 
// Exemplo: POST /api/auth/login executará a rota definida em authRoutes 

// Registra as rotas de autenticação avançada sob o prefixo "/auth"
// Endpoints: /auth/login/universal, /auth/register/patient, /auth/register/doctor, /auth/register/clinic
app.use("/auth", authAdvancedRoutes); 
app.use("/messages", messageRoutes);
// Registra as rotas de clínicas sob o prefixo "/api/clinicas"
// Endpoints: POST /api/clinicas/register, GET /api/clinicas, GET /api/clinicas/:id, PUT /api/clinicas/:id
app.use("/api/clinicas", clinicaRoutes);
// Registra as rotas de agendamentos sob o prefixo "/api/agendamentos"
// Endpoints: POST /api/agendamentos, GET /api/agendamentos/clinica/:id, GET /api/agendamentos/profissional/:id, PUT /api/agendamentos/:id/status
app.use("/api/agendamentos", agendamentosRoutes);
// ============================================ 
// ENDPOINT DE HEALTH CHECK 
// ============================================ 
// Rota simples para verificar se a API está funcionando 
// Endpoint: GET /health 
// Responde com { ok: true } em caso de sucesso 
app.get("/health", (req, res) => res.json({ ok: true })); 
// ============================================ 
// MIDDLEWARE DE TRATAMENTO DE ERROS GLOBAL 
// ============================================ 
// Middleware de erro global que captura qualquer erro não tratado na aplicação 
// Deve ser definido por último para capturar erros de todas as rotas 
// Nota: Requer exatamente 4 parâmetros (err, req, res, next) para ser reconhecido como middleware de erro 
app.use((err, req, res, next) => { 
// Registra o erro no console para debugging e monitoramento 
console.error(err); 
// Retorna resposta HTTP 500 (Erro Interno do Servidor) com mensagem genérica 
// Não expõe detalhes técnicos do erro para não revelar informações sensíveis 
res.status(500).json({ message: "Erro interno." }); 
}); 
