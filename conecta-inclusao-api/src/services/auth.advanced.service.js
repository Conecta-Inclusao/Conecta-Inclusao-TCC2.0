import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import { sendPasswordResetEmail } from "./email.service.js";

const MAX = Number(process.env.MAX_LOGIN_ATTEMPTS || 3);
const LOCK_MINUTES = Number(process.env.LOCK_MINUTES || 5);
const TEMP_PASSWORD_RESET_EXPIRES_IN = process.env.TEMP_PASSWORD_RESET_EXPIRES_IN || "15m";
const SALT_ROUNDS = 10;
const PASSWORD_RESET_MINUTES = Number(process.env.PASSWORD_RESET_MINUTES || 30);

function nowPlusMinutes(min) {
  return new Date(Date.now() + min * 60 * 1000);
}

function isStrongPassword(password) {
  return typeof password === "string" &&
    password.length >= 8 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password);
}

function signAccessToken(record) {
  return jwt.sign(
    { sub: String(record.id), profile: record.profile },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "1h" }
  );
}

function publicUser(record) {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    profile: record.profile,
    cpf: record.cpf || null,
    cnpj: record.cnpj || null,
    crm: record.crm || null,
    registry: record.crm || null,
    unit: record.unidade || null,
    unidade: record.unidade || null,
    specialty: record.especialidade || null,
    clinicaId: record.clinica_id || null
  };
}

function detectIdentifierType(identifier) {
  const trimmed = String(identifier || "").trim();
  let normalized = trimmed.replace(/[\s-]/g, "");

  const prefixMatch = normalized.match(/^(CRM|COREN|CREFITO)([A-Z0-9]+)$/i);
  if (prefixMatch) normalized = prefixMatch[2].toUpperCase();

  if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{11}$/.test(trimmed)) {
    return { type: "cpf", value: trimmed.replace(/\D/g, "") };
  }

  if (/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$|^\d{14}$/.test(trimmed)) {
    return { type: "cnpj", value: trimmed.replace(/\D/g, "") };
  }

  if (/^[A-Z0-9]{4,7}$/.test(normalized)) {
    return { type: "crm", value: normalized.toUpperCase() };
  }

  if (trimmed.includes("@")) {
    return { type: "email", value: trimmed.toLowerCase() };
  }

  return null;
}

function tableForProfile(profile) {
  return {
    paciente: "pacientes",
    medico: "medicos",
    clinica: "clinicas"
  }[profile];
}

function maskEmail(email) {
  const [name, domain] = String(email || "").split("@");
  if (!name || !domain) return email;
  const visible = name.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(name.length - 2, 3))}@${domain}`;
}

function normalizeIdentifierByType(type, identifier) {
  const value = String(identifier || "").trim();
  if (type === "cpf" || type === "cnpj") return value.replace(/\D/g, "");
  if (type === "crm") return value.replace(/[\s-]/g, "").replace(/^CRM/i, "").toUpperCase();
  return value;
}

function buildResetUrl(token) {
  const baseUrl = process.env.FRONTEND_BASE_URL || process.env.SMTP_FRONTEND_URL || "http://localhost:3000";
  return `${baseUrl.replace(/\/$/, "")}/reset-password.html?token=${encodeURIComponent(token)}`;
}

export function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Token de acesso nao fornecido." });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Token invalido ou expirado." });
    }

    req.user = decoded;
    next();
  });
}

export async function getClinicDetails(clinicaId) {
  try {
    const [rows] = await pool.execute(
      `SELECT id AS clinicaId, cnpj, nome, razao_social, endereco, cidade, estado, cep, telefone, responsavel
       FROM clinicas
       WHERE id = ? LIMIT 1`,
      [clinicaId]
    );

    if (rows.length === 0) {
      return { ok: false, statusCode: 404, message: "Clinica nao encontrada." };
    }

    return { ok: true, data: rows[0] };
  } catch (err) {
    console.error("Erro em getClinicDetails:", err);
    return { ok: false, statusCode: 500, message: "Erro interno do servidor." };
  }
}

async function findAuthRecord(identifierInfo) {
  if (identifierInfo.type === "cpf") {
    const [rows] = await pool.execute(
      `SELECT id, nome_paciente AS name, email, cpf, senha AS password_hash, status, failed_attempts, locked_until,
              'paciente' AS profile
       FROM pacientes
       WHERE cpf = ? LIMIT 1`,
      [identifierInfo.value]
    );
    return rows[0] || null;
  }

  if (identifierInfo.type === "cnpj") {
    const [rows] = await pool.execute(
      `SELECT id, nome AS name, email, cnpj, senha AS password_hash, status, failed_attempts, locked_until,
              'clinica' AS profile
       FROM clinicas
       WHERE cnpj = ? LIMIT 1`,
      [identifierInfo.value]
    );
    return rows[0] || null;
  }

  if (identifierInfo.type === "crm") {
    const [rows] = await pool.execute(
      `SELECT id, name, email, crm, senha AS password_hash, status, failed_attempts, locked_until,
              must_change_password, temporary_password_token, temporary_password_expires_at,
              unidade, especialidade, clinica_id, 'medico' AS profile
       FROM medicos
       WHERE crm = ? LIMIT 1`,
      [identifierInfo.value]
    );
    return rows[0] || null;
  }

  const [patients] = await pool.execute(
    `SELECT id, nome_paciente AS name, email, cpf, senha AS password_hash, status, failed_attempts, locked_until,
            'paciente' AS profile
     FROM pacientes
     WHERE email = ? LIMIT 1`,
    [identifierInfo.value]
  );
  if (patients[0]) return patients[0];

  const [doctors] = await pool.execute(
    `SELECT id, name, email, crm, senha AS password_hash, status, failed_attempts, locked_until,
            must_change_password, temporary_password_token, temporary_password_expires_at,
            unidade, especialidade, clinica_id, 'medico' AS profile
     FROM medicos
     WHERE email = ? LIMIT 1`,
    [identifierInfo.value]
  );
  if (doctors[0]) return doctors[0];

  const [clinics] = await pool.execute(
    `SELECT id, nome AS name, email, cnpj, senha AS password_hash, status, failed_attempts, locked_until,
            'clinica' AS profile
     FROM clinicas
     WHERE email = ? LIMIT 1`,
    [identifierInfo.value]
  );
  return clinics[0] || null;
}

async function updateAuthState(profile, id, fields) {
  const table = tableForProfile(profile);
  if (!table) return;

  const entries = Object.entries(fields);
  if (!entries.length) return;

  const setSql = entries.map(([key]) => `${key} = ?`).join(", ");
  await pool.execute(
    `UPDATE ${table} SET ${setSql} WHERE id = ?`,
    [...entries.map(([, value]) => value), id]
  );
}

async function validatePassword(record, password, expectedProfile = null) {
  if (expectedProfile && record.profile !== expectedProfile) {
    return { ok: false, statusCode: 401, message: "Credenciais invalidas." };
  }

  if (record.status !== "ACTIVE" && record.status !== "ativo") {
    return { ok: false, statusCode: 403, message: "Conta inativa." };
  }

  if (record.locked_until && new Date(record.locked_until) > new Date()) {
    return { ok: false, statusCode: 423, message: "Conta bloqueada temporariamente." };
  }

  const passOk = await bcrypt.compare(password, record.password_hash);

  if (!passOk) {
    const newFails = Math.min((record.failed_attempts || 0) + 1, 255);

    if (newFails >= MAX) {
      await updateAuthState(record.profile, record.id, {
        failed_attempts: newFails,
        locked_until: nowPlusMinutes(LOCK_MINUTES)
      });
      return { ok: false, statusCode: 423, message: "Multiplas tentativas incorretas. Conta bloqueada por 5 minutos." };
    }

    await updateAuthState(record.profile, record.id, { failed_attempts: newFails });
    return { ok: false, statusCode: 401, message: "Credenciais invalidas." };
  }

  if ((record.failed_attempts || 0) > 0 || record.locked_until) {
    await updateAuthState(record.profile, record.id, {
      failed_attempts: 0,
      locked_until: null
    });
  }

  if (record.profile === "medico" && record.must_change_password && record.temporary_password_token) {
    if (record.temporary_password_expires_at && new Date(record.temporary_password_expires_at) < new Date()) {
      return { ok: false, statusCode: 403, message: "Senha temporaria expirada. Solicite uma nova senha a empresa." };
    }

    const resetToken = jwt.sign(
      { sub: String(record.id), profile: "medico", type: "temporary_password_reset" },
      process.env.JWT_SECRET,
      { expiresIn: TEMP_PASSWORD_RESET_EXPIRES_IN }
    );

    return {
      ok: true,
      statusCode: 200,
      data: {
        requiresPasswordReset: true,
        resetToken,
        user: publicUser(record)
      }
    };
  }

  return {
    ok: true,
    statusCode: 200,
    data: {
      token: signAccessToken(record),
      user: publicUser(record)
    }
  };
}

export async function loginUniversal({ identifier, password }) {
  if (!identifier || !password) {
    return { ok: false, statusCode: 400, message: "Identificador e senha sao obrigatorios." };
  }

  const identifierInfo = detectIdentifierType(identifier);
  if (!identifierInfo) {
    return { ok: false, statusCode: 400, message: "Formato de identificador invalido." };
  }

  const record = await findAuthRecord(identifierInfo);
  if (!record) {
    return { ok: false, statusCode: 401, message: "Credenciais invalidas." };
  }

  const expectedProfile = {
    cpf: "paciente",
    cnpj: "clinica",
    crm: "medico"
  }[identifierInfo.type] || null;

  return validatePassword(record, password, expectedProfile);
}

export async function resetTemporaryProfessionalPassword({ resetToken, newPassword }) {
  try {
    if (!isStrongPassword(newPassword)) {
      return {
        ok: false,
        statusCode: 400,
        message: "A nova senha deve ter no minimo 8 caracteres, com maiuscula, minuscula, numero e caractere especial."
      };
    }

    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch {
      return { ok: false, statusCode: 401, message: "Token temporario invalido ou expirado." };
    }

    if (decoded.type !== "temporary_password_reset" || decoded.profile !== "medico") {
      return { ok: false, statusCode: 403, message: "Token temporario invalido." };
    }

    const [rows] = await pool.execute(
      `SELECT id, name, email, crm, senha AS password_hash, status, must_change_password,
              temporary_password_token, unidade, especialidade, clinica_id, 'medico' AS profile
       FROM medicos
       WHERE id = ? LIMIT 1`,
      [decoded.sub]
    );

    if (rows.length === 0) {
      return { ok: false, statusCode: 404, message: "Profissional nao encontrado." };
    }

    const doctor = rows[0];
    if (!doctor.must_change_password || !doctor.temporary_password_token) {
      return { ok: false, statusCode: 400, message: "Essa senha temporaria ja foi redefinida." };
    }

    const isSameAsTemporary = await bcrypt.compare(newPassword, doctor.temporary_password_token);
    if (isSameAsTemporary) {
      return { ok: false, statusCode: 400, message: "A nova senha nao pode ser igual a senha temporaria." };
    }

    const newPasswordHash = await bcrypt.hash(newPassword.trim(), SALT_ROUNDS);
    await pool.execute(
      `UPDATE medicos
       SET senha = ?, must_change_password = FALSE, temporary_password_token = NULL,
           temporary_password_expires_at = NULL, failed_attempts = 0, locked_until = NULL
       WHERE id = ?`,
      [newPasswordHash, doctor.id]
    );

    return {
      ok: true,
      statusCode: 200,
      data: {
        token: signAccessToken(doctor),
        user: publicUser(doctor)
      }
    };
  } catch (err) {
    console.error("Erro em resetTemporaryProfessionalPassword:", err);
    return { ok: false, statusCode: 500, message: "Erro ao redefinir senha temporaria." };
  }
}

async function findPasswordResetAccount(type, identifier) {
  const value = normalizeIdentifierByType(type, identifier);

  if (type === "cpf") {
    const [rows] = await pool.execute(
      `SELECT id, nome_paciente AS name, email, 'paciente' AS profile
       FROM pacientes
       WHERE cpf = ? LIMIT 1`,
      [value]
    );
    return rows[0] || null;
  }

  if (type === "crm") {
    const [rows] = await pool.execute(
      `SELECT id, name, email, 'medico' AS profile
       FROM medicos
       WHERE crm = ? LIMIT 1`,
      [value]
    );
    return rows[0] || null;
  }

  if (type === "cnpj") {
    const [rows] = await pool.execute(
      `SELECT id, nome AS name, email, 'clinica' AS profile
       FROM clinicas
       WHERE cnpj = ? LIMIT 1`,
      [value]
    );
    return rows[0] || null;
  }

  return null;
}

export async function requestPasswordReset({ type, identifier }) {
  try {
    const account = await findPasswordResetAccount(type, identifier);

    if (!account) {
      return { ok: false, statusCode: 404, message: "Cadastro nao encontrado para o identificador informado." };
    }

    if (!account.email) {
      return { ok: false, statusCode: 400, message: "Este cadastro nao possui e-mail para recuperacao de senha." };
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = await bcrypt.hash(token, SALT_ROUNDS);
    const expiresAt = nowPlusMinutes(PASSWORD_RESET_MINUTES);
    const table = tableForProfile(account.profile);

    await pool.execute(
      `UPDATE ${table}
       SET password_reset_token = ?, password_reset_expires_at = ?
       WHERE id = ?`,
      [tokenHash, expiresAt, account.id]
    );

    const resetUrl = buildResetUrl(token);
    await sendPasswordResetEmail({
      to: account.email,
      name: account.name,
      token,
      resetUrl
    });

    return {
      ok: true,
      statusCode: 200,
      message: "Token de recuperacao enviado para o e-mail cadastrado.",
      data: { email: maskEmail(account.email) }
    };
  } catch (err) {
    console.error("Erro em requestPasswordReset:", err);
    return { ok: false, statusCode: 500, message: "Erro ao enviar e-mail de recuperacao." };
  }
}

async function findAccountByResetToken(token) {
  const queries = [
    {
      profile: "paciente",
      table: "pacientes",
      sql: `SELECT id, nome_paciente AS name, email, password_reset_token, password_reset_expires_at
            FROM pacientes
            WHERE password_reset_token IS NOT NULL`
    },
    {
      profile: "medico",
      table: "medicos",
      sql: `SELECT id, name, email, password_reset_token, password_reset_expires_at
            FROM medicos
            WHERE password_reset_token IS NOT NULL`
    },
    {
      profile: "clinica",
      table: "clinicas",
      sql: `SELECT id, nome AS name, email, password_reset_token, password_reset_expires_at
            FROM clinicas
            WHERE password_reset_token IS NOT NULL`
    }
  ];

  for (const query of queries) {
    const [rows] = await pool.execute(query.sql);
    for (const row of rows) {
      const matches = await bcrypt.compare(token, row.password_reset_token);
      if (matches) return { ...row, profile: query.profile, table: query.table };
    }
  }

  return null;
}

export async function resetPasswordWithToken({ token, newPassword }) {
  try {
    if (!isStrongPassword(newPassword)) {
      return {
        ok: false,
        statusCode: 400,
        message: "A nova senha deve ter no minimo 8 caracteres, com maiuscula, minuscula, numero e caractere especial."
      };
    }

    const account = await findAccountByResetToken(token);
    if (!account) {
      return { ok: false, statusCode: 401, message: "Token invalido." };
    }

    if (account.password_reset_expires_at && new Date(account.password_reset_expires_at) < new Date()) {
      return { ok: false, statusCode: 401, message: "Token expirado. Solicite uma nova recuperacao." };
    }

    const passwordHash = await bcrypt.hash(newPassword.trim(), SALT_ROUNDS);
    const resetExtra = account.profile === "medico"
      ? ", must_change_password = FALSE, temporary_password_token = NULL, temporary_password_expires_at = NULL"
      : "";

    await pool.execute(
      `UPDATE ${account.table}
       SET senha = ?, password_reset_token = NULL, password_reset_expires_at = NULL,
           failed_attempts = 0, locked_until = NULL${resetExtra}
       WHERE id = ?`,
      [passwordHash, account.id]
    );

    return {
      ok: true,
      statusCode: 200,
      message: "Senha redefinida com sucesso."
    };
  } catch (err) {
    console.error("Erro em resetPasswordWithToken:", err);
    return { ok: false, statusCode: 500, message: "Erro ao redefinir senha." };
  }
}

export async function registerUser({ identifier, password, name, profile, userData = null }) {
  try {
    if (!identifier || !password || !name || !profile) {
      return { ok: false, statusCode: 400, message: "Todos os campos sao obrigatorios." };
    }

    if (!["paciente", "medico", "clinica"].includes(profile)) {
      return { ok: false, statusCode: 400, message: "Perfil invalido." };
    }

    const identifierInfo = detectIdentifierType(identifier);
    if (!identifierInfo) {
      return { ok: false, statusCode: 400, message: "Identificador invalido para o perfil." };
    }

    const validCombinations = {
      paciente: "cpf",
      medico: "crm",
      clinica: "cnpj"
    };

    if (validCombinations[profile] !== identifierInfo.type) {
      return { ok: false, statusCode: 400, message: `Perfil ${profile} requer ${validCombinations[profile].toUpperCase()}.` };
    }

    if (profile === "medico" && !userData?.unidade) {
      return { ok: false, statusCode: 400, message: "Unidade e obrigatoria para cadastro de medico." };
    }

    const passwordHash = await bcrypt.hash(password.trim(), SALT_ROUNDS);
    let result;

    if (profile === "paciente") {
      [result] = await pool.execute(
        `INSERT INTO pacientes (nome_paciente, cpf, email, tipo_deficiencia, data_nascimento, senha, status)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
        [name, identifierInfo.value, userData?.email || null, userData?.tipoDeficiencia || null, userData?.dataNascimento || null, passwordHash]
      );
    } else if (profile === "medico") {
      [result] = await pool.execute(
        `INSERT INTO medicos (name, crm, email, especialidade, clinica_id, bio, unidade, senha, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
        [name, identifierInfo.value, userData?.email || null, userData?.especialidade || null, userData?.clinicaId || null, userData?.bio || null, userData?.unidade, passwordHash]
      );
    } else {
      [result] = await pool.execute(
        `INSERT INTO clinicas (nome, cnpj, email, razao_social, endereco, cidade, estado, cep, telefone, responsavel, senha, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
        [
          name,
          identifierInfo.value,
          userData?.email || null,
          userData?.razaoSocial || name,
          userData?.endereco || "",
          userData?.cidade || "",
          userData?.estado || "",
          userData?.cep || "",
          userData?.telefone || "",
          userData?.responsavel || "",
          passwordHash
        ]
      );
    }

    return {
      ok: true,
      statusCode: 201,
      message: "Cadastro realizado com sucesso.",
      data: { id: result.insertId, profile, identifier: identifierInfo.value }
    };
  } catch (err) {
    console.error("Erro em registerUser:", err);

    if (err.code === "ER_DUP_ENTRY") {
      return { ok: false, statusCode: 409, message: "Identificador ou email ja cadastrado." };
    }

    return { ok: false, statusCode: 500, message: "Erro ao registrar usuario." };
  }
}

export async function registerProfessional({ crm, name, especialidade, clinicaId, bio = null, unidade, password, email = null }) {
  try {
    if (!crm || !name || !clinicaId || !unidade || !password) {
      return { ok: false, statusCode: 400, message: "Todos os campos obrigatorios nao foram preenchidos." };
    }

    const crmInfo = detectIdentifierType(crm);
    if (!crmInfo || crmInfo.type !== "crm") {
      return { ok: false, statusCode: 400, message: "CRM invalido." };
    }

    if (password.trim().length < 6) {
      return { ok: false, statusCode: 400, message: "Senha deve ter no minimo 6 caracteres." };
    }

    const defaultPassword = password.trim();
    const passwordHash = await bcrypt.hash(defaultPassword, SALT_ROUNDS);

    const [result] = await pool.execute(
      `INSERT INTO medicos
       (name, clinica_id, crm, especialidade, bio, unidade, email, senha, status, must_change_password, temporary_password_token, temporary_password_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', TRUE, ?, ?)`,
      [name, clinicaId, crmInfo.value, especialidade || null, bio || null, unidade, email, passwordHash, passwordHash, nowPlusMinutes(60 * 24 * 7)]
    );

    return {
      ok: true,
      statusCode: 201,
      message: "Profissional registrado com sucesso.",
      data: {
        id: result.insertId,
        crm: crmInfo.value,
        defaultPassword,
        name,
        unidade
      }
    };
  } catch (err) {
    console.error("Erro em registerProfessional:", err);

    if (err.code === "ER_DUP_ENTRY") {
      return { ok: false, statusCode: 409, message: "CRM ou email ja cadastrado." };
    }

    if (err.message?.includes("FK_medicos_clinica")) {
      return { ok: false, statusCode: 404, message: "Clinica nao encontrada." };
    }

    return { ok: false, statusCode: 500, message: "Erro ao registrar profissional." };
  }
}
