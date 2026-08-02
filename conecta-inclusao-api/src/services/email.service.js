import nodemailer from "nodemailer";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variavel de ambiente ${name} nao configurada.`);
  }
  return value;
}

return nodemailer.createTransport({
  host: requiredEnv("SMTP_HOST"),
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
  family: 4,
  auth: {
    user: requiredEnv("SMTP_USER"),
    pass: requiredEnv("SMTP_PASS")
  }
});

export async function sendPasswordResetEmail({ to, name, token, resetUrl }) {
  const transporter = createTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

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
        <p>Ola, ${name || "usuario"}.</p>
        <p>Recebemos uma solicitacao para redefinir sua senha.</p>
        <p><strong>Token de recuperacao:</strong></p>
        <p style="font-size: 20px; letter-spacing: 1px; font-weight: 700;">${token}</p>
        ${resetUrl ? `<p><a href="${resetUrl}" style="color: #0073e6;">Clique aqui para redefinir sua senha</a></p>` : ""}
        <p>Esse token expira em 30 minutos. Se voce nao solicitou, ignore este e-mail.</p>
      </div>
    `
  });
}
