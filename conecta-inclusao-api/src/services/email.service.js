import dns from "node:dns/promises";
import net from "node:net";
import nodemailer from "nodemailer";
import { env } from "../env.js";

const MAILJET_ENDPOINT = "https://api.mailjet.com/v3.1/send";
const MAILJET_TIMEOUT_MS = 15000;
const DEFAULT_SENDER_NAME = "Conecta Inclusao";

// O nome vem do banco e e interpolado no corpo HTML do e-mail.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Aceita tanto "contato@dominio.com" quanto "Conecta Inclusao <contato@dominio.com>".
function parseSender(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(.*?)<([^>]+)>$/);

  if (match) {
    return {
      name: match[1].trim().replace(/^"|"$/g, "") || DEFAULT_SENDER_NAME,
      email: match[2].trim()
    };
  }

  return { name: DEFAULT_SENDER_NAME, email: raw };
}

// Em rede sem rota IPv6 o envio falhava com "connect ENETUNREACH <ipv6>:587":
// o nodemailer resolve o host sozinho (A + AAAA) e sorteia um dos enderecos,
// entao caia no AAAA do Gmail. A opcao `family: 4` do transporte nao adianta,
// porque quando o net.connect e chamado o host ja e um IP literal. Resolvemos
// o A record aqui e conectamos direto nele; `servername` mantem o hostname
// original para o certificado continuar validando no STARTTLS.
async function resolveIpv4Host(host) {
  if (net.isIP(host)) {
    return host;
  }

  try {
    const [address] = await dns.resolve4(host);
    return address || host;
  } catch {
    // Sem A record (ou DNS indisponivel): deixa o nodemailer resolver.
    return host;
  }
}

async function createTransporter() {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    throw new Error("SMTP nao configurado (SMTP_HOST, SMTP_USER e SMTP_PASS sao obrigatorios para envio de e-mail).");
  }

  return nodemailer.createTransport({
    host: await resolveIpv4Host(env.SMTP_HOST),
    servername: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    // O padrao do nodemailer e 2 minutos de espera pela conexao. Quando a porta
    // SMTP esta bloqueada na rede (caso do plano free do Render), a requisicao
    // do usuario ficava travada esse tempo todo antes de responder qualquer coisa.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS
    }
  });
}

// O plano free do Render bloqueia trafego de saida nas portas SMTP (25, 465 e
// 587) desde 26/09/2025, entao o envio via nodemailer estourava em ETIMEDOUT em
// producao. A API HTTP do Mailjet trafega na 443 e passa normalmente.
async function sendViaMailjet({ to, name, subject, text, html }) {
  const sender = parseSender(env.MAILJET_SENDER || env.SMTP_FROM || env.SMTP_USER);

  if (!sender.email) {
    throw new Error("Remetente nao configurado: defina MAILJET_SENDER (ou SMTP_FROM) com um remetente verificado no Mailjet.");
  }

  if (!env.MAILJET_API_SECRET) {
    throw new Error("MAILJET_API_SECRET ausente: a API do Mailjet exige a chave e o segredo.");
  }

  const credentials = Buffer.from(`${env.MAILJET_API_KEY}:${env.MAILJET_API_SECRET}`).toString("base64");

  const response = await fetch(MAILJET_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      Messages: [
        {
          From: { Email: sender.email, Name: sender.name },
          To: [name ? { Email: to, Name: name } : { Email: to }],
          Subject: subject,
          TextPart: text,
          HTMLPart: html
        }
      ]
    }),
    signal: AbortSignal.timeout(MAILJET_TIMEOUT_MS)
  });

  // O corpo de erro traz o motivo real (remetente nao verificado, chave
  // invalida, cota estourada). Sem isso o log so mostraria o status.
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Mailjet respondeu ${response.status}: ${detail.slice(0, 500)}`);
  }

  // A v3.1 responde 200 mesmo quando a mensagem individual falha: o resultado
  // real de cada destinatario vem em Messages[].Status.
  const body = await response.json().catch(() => null);
  const failed = (body?.Messages || []).filter((item) => item.Status !== "success");

  if (failed.length) {
    throw new Error(`Mailjet recusou o envio: ${JSON.stringify(failed).slice(0, 500)}`);
  }
}

async function sendViaSmtp({ to, subject, text, html }) {
  const transporter = await createTransporter();

  await transporter.sendMail({
    from: env.SMTP_FROM || env.SMTP_USER,
    to,
    subject,
    text,
    html
  });
}

export async function sendPasswordResetEmail({ to, name, token, resetUrl }) {
  const message = {
    to,
    name,
    subject: "Recuperacao de senha - Conecta Inclusao",
    text: [
      `Ola, ${name || "usuario"}.`,
      "",
      "Recebemos uma solicitacao para redefinir sua senha.",
      `Token de recuperacao: ${token}`,
      resetUrl ? `Link para redefinir: ${resetUrl}` : "",
      "",
      "Esse token expira em 30 minutos. Se voce nao solicitou, ignore este e-mail."
    ].filter(Boolean).join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
        <h2>Recuperacao de senha</h2>
        <p>Ola, ${escapeHtml(name || "usuario")}.</p>
        <p>Recebemos uma solicitacao para redefinir sua senha.</p>
        <p><strong>Token de recuperacao:</strong></p>
        <p style="font-size: 20px; letter-spacing: 1px; font-weight: 700;">${token}</p>
        ${resetUrl ? `<p><a href="${resetUrl}" style="color: #0073e6;">Clique aqui para redefinir sua senha</a></p>` : ""}
        <p>Esse token expira em 30 minutos. Se voce nao solicitou, ignore este e-mail.</p>
      </div>
    `
  };

  // Com MAILJET_API_KEY configurada usamos a API HTTP (unica que funciona no
  // Render free); sem ela caimos no SMTP, que continua servindo para rodar a
  // API localmente com o Gmail.
  if (env.MAILJET_API_KEY) {
    return sendViaMailjet(message);
  }

  return sendViaSmtp(message);
}
