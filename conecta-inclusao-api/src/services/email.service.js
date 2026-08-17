import dns from "node:dns/promises";
import net from "node:net";
import nodemailer from "nodemailer";
import { env } from "../env.js";

// O nome vem do banco e e interpolado no corpo HTML do e-mail.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS
    }
  });
}

export async function sendPasswordResetEmail({ to, name, token, resetUrl }) {
  const transporter = await createTransporter();
  const from = env.SMTP_FROM || env.SMTP_USER;

  await transporter.sendMail({
    from,
    to,
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
  });
}
