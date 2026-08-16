import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";

import { env, isProduction } from "./env.js";
import { initRealtime } from "./realtime.js";
import authAdvancedRoutes from "./routes/auth.advanced.routes.js";
import messageRoutes from "./routes/messages.routes.js";
import agendamentosRoutes from "./routes/agendamentos.routes.js";

export const app = express();
export const server = http.createServer(app);

// ============================================
// CORS
// ============================================
// Antes era `origin: true` + `credentials: true`, o que reflete qualquer origem
// e anula a protecao. Agora e uma allowlist vinda de CORS_ORIGINS.
const defaultOrigins = [
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5500"
];

const allowedOrigins = env.CORS_ORIGINS.length
  ? env.CORS_ORIGINS
  : isProduction
    ? [env.FRONTEND_BASE_URL].filter(Boolean)
    : defaultOrigins;

function corsOrigin(origin, callback) {
  // Requisicoes same-origin e ferramentas locais (curl, Postman) nao mandam Origin.
  if (!origin) return callback(null, true);

  const normalized = origin.replace(/\/$/, "");
  if (allowedOrigins.includes(normalized)) return callback(null, true);

  return callback(new Error(`Origem nao autorizada pelo CORS: ${origin}`));
}

// ============================================
// TEMPO REAL (Socket.io com handshake autenticado)
// ============================================
export const io = initRealtime(server, allowedOrigins);

// ============================================
// MIDDLEWARES DE SEGURANCA
// ============================================
// A politica padrao do helmet e `default-src 'self'`, o que quebra o front
// quando ele e servido pela propria API: os icones (unpkg), os avatares
// (ui-avatars) e todo script inline eram bloqueados, deixando a pagina sem
// icones e sem o carregador do socket.io.
//
// 'unsafe-inline' em scriptSrc e necessario porque o front usa atributos
// onclick inline em varias telas. Nao e o ideal, mas remover isso exigiria
// reescrever os handlers de todas as paginas.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // O script do @phosphor-icons vem do unpkg, mas ele injeta folhas de
      // estilo e fontes hospedadas no jsdelivr - por isso os dois dominios.
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.jsdelivr.net"],
      // script-src-attr e uma diretiva separada e o helmet a define como 'none'
      // por padrao. Sem esta linha, TODO atributo onclick do front e ignorado
      // silenciosamente - os botoes ficam sem acao nenhuma.
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https://ui-avatars.com"],
      fontSrc: ["'self'", "data:", "https://unpkg.com", "https://cdn.jsdelivr.net"],
      // ws:/wss: liberam o transporte WebSocket do socket.io.
      connectSrc: ["'self'", "ws:", "wss:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  // O front carrega imagens de ui-avatars.com; a politica padrao
  // (same-origin) bloqueia recursos cross-origin.
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Necessario no Render/Vercel para o rate limit enxergar o IP real do cliente
// em vez do IP do proxy (senao um unico IP compartilha o balde de todos).
app.set("trust proxy", 1);

app.use(express.json({ limit: "50kb" }));

app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

// ============================================
// ARQUIVOS ESTATICOS
// ============================================
// O caminho anterior ("../conecta-inclusao-front/src") resolvia para
// conecta-inclusao-api/conecta-inclusao-front/src, que nao existe. Faltava um nivel.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendSrcPath = path.join(__dirname, "..", "..", "conecta-inclusao-front", "src");

app.use(express.static(frontendSrcPath));
app.use("/pages", express.static(path.join(frontendSrcPath, "pages")));
app.use("/assets", express.static(path.join(frontendSrcPath, "assets")));

app.get("/reset-password.html", (req, res) => {
  res.sendFile(path.join(frontendSrcPath, "pages", "reset-password.html"));
});

// ============================================
// ROTAS DA API
// ============================================
app.use("/auth", authAdvancedRoutes);
app.use("/messages", messageRoutes);
app.use("/api/agendamentos", agendamentosRoutes);

app.get("/health", (req, res) => res.json({ ok: true }));

// ============================================
// TRATAMENTO DE ERROS
// ============================================
app.use((err, req, res, next) => {
  if (err?.message?.startsWith("Origem nao autorizada pelo CORS")) {
    return res.status(403).json({ message: "Origem nao autorizada." });
  }

  console.error(err);
  return res.status(500).json({ message: "Erro interno." });
});
