// Carrega e valida as variaveis de ambiente uma unica vez, no boot.
//
// Antes o JWT_SECRET era lido direto de process.env em varios pontos, e em dois
// deles havia um fallback hardcoded ("your-secret-key" / "seu-segredo-super-seguro").
// Se a variavel faltasse em producao a API continuava de pe emitindo tokens
// assinados com um segredo publico. Agora o processo nao sobe sem segredo.
import dotenv from "dotenv";

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(
      `Variavel de ambiente obrigatoria ausente: ${name}. Configure o .env (veja .env.exemple) antes de iniciar a API.`
    );
  }
  return String(value).trim();
}

function optional(name, fallback = null) {
  const value = process.env[name];
  return value && String(value).trim() ? String(value).trim() : fallback;
}

function optionalNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

const JWT_SECRET = required("JWT_SECRET");

if (JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET deve ter no minimo 32 caracteres.");
}

const DATABASE_URL = optional("DATABASE_URL") || optional("PG_CONNECTION_STRING");

if (!DATABASE_URL) {
  throw new Error(
    "Variavel de ambiente obrigatoria ausente: DATABASE_URL (string de conexao PostgreSQL/Neon)."
  );
}

// Origens autorizadas a chamar a API. `origin: true` refletia qualquer origem
// junto com credentials: true, o que anula a protecao do CORS.
const CORS_ORIGINS = (optional("CORS_ORIGINS") || "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

export const env = {
  NODE_ENV: optional("NODE_ENV", "development"),
  PORT: optionalNumber("PORT", 3000),

  DATABASE_URL,

  JWT_SECRET,
  // 1h era curto demais para uma sessao de uso normal: o token vencia no meio
  // do trabalho e, como o front nao detectava isso, a tela apenas parava de
  // responder - parecia perda de permissao. O front agora avisa e manda para o
  // login; aqui damos um prazo compativel com uma jornada de atendimento.
  JWT_EXPIRES_IN: optional("JWT_EXPIRES_IN", "8h"),
  TEMP_PASSWORD_RESET_EXPIRES_IN: optional("TEMP_PASSWORD_RESET_EXPIRES_IN", "15m"),

  MAX_LOGIN_ATTEMPTS: optionalNumber("MAX_LOGIN_ATTEMPTS", 3),
  LOCK_MINUTES: optionalNumber("LOCK_MINUTES", 5),
  PASSWORD_RESET_MINUTES: optionalNumber("PASSWORD_RESET_MINUTES", 30),

  FRONTEND_BASE_URL: optional("FRONTEND_BASE_URL") || optional("SMTP_FRONTEND_URL"),
  CORS_ORIGINS,

  SMTP_HOST: optional("SMTP_HOST"),
  SMTP_PORT: optionalNumber("SMTP_PORT", 587),
  SMTP_SECURE: String(optional("SMTP_SECURE", "false")).toLowerCase() === "true",
  SMTP_USER: optional("SMTP_USER"),
  SMTP_PASS: optional("SMTP_PASS"),
  SMTP_FROM: optional("SMTP_FROM")
};

export const isProduction = env.NODE_ENV === "production";
