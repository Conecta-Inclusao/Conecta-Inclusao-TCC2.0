import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import { env } from "../env.js";
import { sendPasswordResetEmail } from "./email.service.js";

const MAX = env.MAX_LOGIN_ATTEMPTS;
const LOCK_MINUTES = env.LOCK_MINUTES;
const TEMP_PASSWORD_RESET_EXPIRES_IN = env.TEMP_PASSWORD_RESET_EXPIRES_IN;
const SALT_ROUNDS = 10;
const PASSWORD_RESET_MINUTES = env.PASSWORD_RESET_MINUTES;

// Perfis que possuem colunas de bloqueio por tentativa. `responsavel` nao tem
// failed_attempts/locked_until no schema, entao qualquer UPDATE nessas colunas
// para esse perfil quebraria a query.
const PROFILES_WITH_LOCKOUT = new Set(["paciente", "medico", "clinica"]);

// Perfis cujo status e textual. `responsavel.status` e SMALLINT (1 = ativo).
const ACTIVE_TEXT_STATUSES = ["active", "ativo", "trabalhando"];

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

function isActiveRecord(record) {
  if (record.profile === "responsavel") {
    return Number(record.status) === 1;
  }
  return ACTIVE_TEXT_STATUSES.includes(String(record.status || "").toLowerCase());
}

function signAccessToken(record) {
  return jwt.sign(
    { sub: String(record.id), profile: record.profile },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
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
    clinica: "clinicas",
    responsavel: "responsavel"
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
  const baseUrl = env.FRONTEND_BASE_URL || "https://conecta-inclusao.onrender.com";
  return `${baseUrl.replace(/\/$/, "")}/reset-password.html?token=${encodeURIComponent(token)}`;
}

// Tokens de recuperacao sao 32 bytes aleatorios. Com essa entropia, guardar o
// SHA-256 e suficiente e permite busca indexada por igualdade. O bcrypt anterior
// obrigava a varrer todas as linhas com token pendente comparando uma a uma.
function hashResetToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Token de acesso nao fornecido." });
  }

  jwt.verify(token, env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Token invalido ou expirado." });
    }

    // Tokens especiais (reset de senha temporaria, acesso a prontuario) nao
    // valem como token de sessao.
    if (decoded.type) {
      return res.status(403).json({ message: "Token nao autorizado para esta operacao." });
    }

    req.user = decoded;
    next();
  });
}

/**
 * Middleware de autorizacao por perfil. Evita repetir o mesmo `if (req.user.profile
 * !== 'x') return 403` em cada rota.
 */
export function requireProfile(...profiles) {
  return (req, res, next) => {
    if (!profiles.includes(req.user?.profile)) {
      return res.status(403).json({ message: "Acesso negado para este perfil." });
    }
    next();
  };
}

export async function getClinicDetails(clinicaId) {
  try {
    const [rows] = await pool.execute(
      `SELECT id AS "clinicaId", cnpj, nome, razao_social, endereco, cidade, estado, cep, telefone, responsavel
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

export async function getUserProfile(user) {
  try {
    let query, params;

    if (user.profile === 'paciente') {
      // O front exibia "--" no campo Responsavel porque lia user.responsible, um
      // campo que esta consulta nunca devolveu. Agora ele vem do vinculo real em
      // paciente_responsavel (o primeiro, quando ha mais de um).
      query = `
        SELECT p.id,
               p.nome_paciente AS name,
               p.email,
               p.cpf,
               TO_CHAR(p.data_nascimento, 'YYYY-MM-DD') AS data_nascimento,
               p.tipo_deficiencia,
               p.telefone,
               p.unidade_preferencia,
               p.status,
               r.nome AS responsible,
               r.id AS "responsibleId"
        FROM pacientes p
        LEFT JOIN paciente_responsavel pr ON pr.id_paciente = p.id
        LEFT JOIN responsavel r ON r.id = pr.id_responsavel
        WHERE p.id = ?
        ORDER BY r.nome ASC
        LIMIT 1
      `;
      params = [user.sub];
    } else if (user.profile === 'medico') {
      query = `
        SELECT m.id, m.name, m.email, m.crm, m.especialidade, m.unidade, m.bio, m.clinica_id, c.nome AS clinica_nome
        FROM medicos m
        LEFT JOIN clinicas c ON m.clinica_id = c.id
        WHERE m.id = ?
      `;
      params = [user.sub];
    } else if (user.profile === 'clinica') {
      query = `
        SELECT id, nome, email, cnpj, razao_social, endereco, cidade, estado, cep, telefone, responsavel
        FROM clinicas
        WHERE id = ?
      `;
      params = [user.sub];
    } else if (user.profile === 'responsavel') {
      query = `
        SELECT id, nome AS name, email, cpf, status
        FROM responsavel
        WHERE id = ?
      `;
      params = [user.sub];
    } else {
      return { ok: false, statusCode: 400, message: "Perfil invalido." };
    }

    const [rows] = await pool.execute(query, params);

    if (rows.length === 0) {
      return { ok: false, statusCode: 404, message: "Usuario nao encontrado." };
    }

    return { ok: true, data: { ...rows[0], profile: user.profile } };
  } catch (err) {
    console.error("Erro em getUserProfile:", err);
    return { ok: false, statusCode: 500, message: "Erro interno do servidor." };
  }
}

async function findAuthRecord(identifierInfo, expectedProfile = null) {
  if (expectedProfile === 'responsavel') {
    // O responsavel agora tem CPF proprio e entra por ele ou pelo e-mail.
    if (identifierInfo.type === 'cpf') {
      const [rows] = await pool.execute(
        `SELECT id, nome AS name, email, cpf, senha AS password_hash, status, 'responsavel' AS profile
         FROM responsavel
         WHERE cpf = ? LIMIT 1`,
        [identifierInfo.value]
      );
      return rows[0] || null;
    }

    if (identifierInfo.type !== 'email') {
      return null;
    }
    const [rows] = await pool.execute(
      `SELECT id, nome AS name, email, cpf, senha AS password_hash, status, 'responsavel' AS profile
       FROM responsavel
       WHERE email = ? LIMIT 1`,
      [identifierInfo.value]
    );
    return rows[0] || null;
  }

  if (identifierInfo.type === "cpf") {
    const [rows] = await pool.execute(
      `SELECT id, nome_paciente AS name, email, cpf, senha AS password_hash, status, failed_attempts, locked_until,
              'paciente' AS profile
       FROM pacientes
       WHERE cpf = ? LIMIT 1`,
      [identifierInfo.value]
    );
    if (rows[0]) return rows[0];

    // Sem perfil esperado (login universal), um CPF que nao e de paciente ainda
    // pode ser de responsavel. O paciente tem prioridade para nao mudar o
    // comportamento de quem ja logava por aqui.
    const [guardians] = await pool.execute(
      `SELECT id, nome AS name, email, cpf, senha AS password_hash, status, 'responsavel' AS profile
       FROM responsavel
       WHERE cpf = ? LIMIT 1`,
      [identifierInfo.value]
    );
    return guardians[0] || null;
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

  if (identifierInfo.type === 'email') {
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
    if (clinics[0]) return clinics[0];

    const [responsavels] = await pool.execute(
      `SELECT id, nome AS name, email, cpf, senha AS password_hash, status, 'responsavel' AS profile
       FROM responsavel
       WHERE email = ? LIMIT 1`,
      [identifierInfo.value]
    );
    return responsavels[0] || null;
  }

  return null;
}

async function updateAuthState(profile, id, fields) {
  const table = tableForProfile(profile);
  if (!table) return;

  // `responsavel` nao tem colunas de bloqueio; ignorar em vez de quebrar a query.
  if (!PROFILES_WITH_LOCKOUT.has(profile)) return;

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

  if (!isActiveRecord(record)) {
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
      return {
        ok: false,
        statusCode: 423,
        message: `Multiplas tentativas incorretas. Conta bloqueada por ${LOCK_MINUTES} minutos.`
      };
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
      env.JWT_SECRET,
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

export async function loginUniversal({ identifier, password, expectedProfile = null }) {
  if (!identifier || !password) {
    return { ok: false, statusCode: 400, message: "Identificador e senha sao obrigatorios." };
  }

  const identifierInfo = detectIdentifierType(identifier);
  if (!identifierInfo) {
    return { ok: false, statusCode: 400, message: "Formato de identificador invalido." };
  }

  const identifierTypeByProfile = {
    paciente: "cpf",
    clinica: "cnpj",
    medico: "crm",
    responsavel: "email"
  };
  const expectedIdentifierType = identifierTypeByProfile[expectedProfile];

  if (expectedIdentifierType && identifierInfo.type !== expectedIdentifierType) {
    return { ok: false, statusCode: 401, message: "Credenciais invalidas." };
  }

  const record = await findAuthRecord(identifierInfo, expectedProfile);
  if (!record) {
    return { ok: false, statusCode: 401, message: "Credenciais invalidas." };
  }

  const profileByIdentifierType = {
    cpf: "paciente",
    cnpj: "clinica",
    crm: "medico"
  }[identifierInfo.type] || null;

  return validatePassword(record, password, expectedProfile || profileByIdentifierType);
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
      decoded = jwt.verify(resetToken, env.JWT_SECRET);
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
    if (!isActiveRecord(doctor)) {
      return { ok: false, statusCode: 403, message: "Conta inativa." };
    }

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

// ---------------------------------------------------------------------------
// Permissoes de responsaveis
//
// O schema modela permissao por responsavel (tabela responsavel_permissoes),
// nao por par paciente/responsavel. O codigo antigo lia uma coluna
// `paciente_responsavel.permissions` que nunca existiu.
//
// Alem disso, quem concede permissao e o paciente - nao o proprio responsavel.
// A rota antiga deixava o responsavel editar as proprias permissoes, o que e
// escalonamento de privilegio.
// ---------------------------------------------------------------------------

export async function getAvailablePermissions() {
  try {
    const [rows] = await pool.execute(
      `SELECT id, nome FROM permissoes ORDER BY id ASC`
    );

    return {
      ok: true,
      statusCode: 200,
      data: {
        permissions: rows.map((row) => ({ id: row.id, key: String(row.id), label: row.nome }))
      }
    };
  } catch (err) {
    console.error("Erro em getAvailablePermissions:", err);
    return { ok: false, statusCode: 500, message: "Erro interno do servidor." };
  }
}

export async function getResponsavelPermissions(responsavelId) {
  try {
    const [permissionRows] = await pool.execute(
      `SELECT p.id, p.nome
       FROM responsavel_permissoes rp
       INNER JOIN permissoes p ON p.id = rp.id_permissao
       WHERE rp.id_responsavel = ?
       ORDER BY p.id ASC`,
      [responsavelId]
    );

    const [patientRows] = await pool.execute(
      `SELECT pr.id_paciente AS "pacienteId",
              pr.parentesco AS relationship,
              pac.nome_paciente AS "pacienteName"
       FROM paciente_responsavel pr
       INNER JOIN pacientes pac ON pac.id = pr.id_paciente
       WHERE pr.id_responsavel = ?`,
      [responsavelId]
    );

    return {
      ok: true,
      statusCode: 200,
      data: {
        permissions: permissionRows.map((row) => ({ id: row.id, key: String(row.id), label: row.nome })),
        patients: patientRows
      }
    };
  } catch (err) {
    console.error("Erro em getResponsavelPermissions:", err);
    return { ok: false, statusCode: 500, message: "Erro interno do servidor." };
  }
}

/**
 * Substitui o conjunto de permissoes de um responsavel. So pode ser chamada
 * apos confirmar que o responsavel esta vinculado ao paciente autenticado.
 */
export async function setGuardianPermissions(pacienteId, responsavelId, permissionIds) {
  const connection = await pool.getConnection();

  try {
    if (!Array.isArray(permissionIds)) {
      return { ok: false, statusCode: 400, message: "permissions deve ser um array de ids." };
    }

    const normalizedIds = [...new Set(
      permissionIds
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )];

    await connection.beginTransaction();

    const [linkRows] = await connection.execute(
      `SELECT 1 FROM paciente_responsavel
       WHERE id_paciente = ? AND id_responsavel = ? LIMIT 1`,
      [pacienteId, responsavelId]
    );

    if (!linkRows.length) {
      await connection.rollback();
      return { ok: false, statusCode: 404, message: "Responsavel nao vinculado a este paciente." };
    }

    if (normalizedIds.length) {
      const [validRows] = await connection.execute(
        `SELECT id FROM permissoes WHERE id = ANY(?)`,
        [normalizedIds]
      );

      if (validRows.length !== normalizedIds.length) {
        await connection.rollback();
        return { ok: false, statusCode: 400, message: "Uma ou mais permissoes nao existem." };
      }
    }

    await connection.execute(
      `DELETE FROM responsavel_permissoes WHERE id_responsavel = ?`,
      [responsavelId]
    );

    for (const permissionId of normalizedIds) {
      await connection.execute(
        `INSERT INTO responsavel_permissoes (id_permissao, id_responsavel)
         VALUES (?, ?) ON CONFLICT DO NOTHING`,
        [permissionId, responsavelId]
      );
    }

    await connection.commit();

    return {
      ok: true,
      statusCode: 200,
      data: { responsavelId, permissions: normalizedIds }
    };
  } catch (err) {
    await connection.rollback();
    console.error("Erro em setGuardianPermissions:", err);
    return { ok: false, statusCode: 500, message: "Erro interno do servidor." };
  } finally {
    connection.release();
  }
}

export async function requestPasswordReset({ type, identifier }) {
  // Resposta sempre generica: retornar 404 quando o cadastro nao existe permite
  // enumerar CPF/CNPJ/CRM validos do sistema.
  const genericResponse = {
    ok: true,
    statusCode: 200,
    message: "Se houver um cadastro com esse identificador, enviaremos um e-mail com as instrucoes.",
    data: { email: null }
  };

  try {
    const account = await findPasswordResetAccount(type, identifier);

    if (!account || !account.email) {
      return genericResponse;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashResetToken(token);
    const expiresAt = nowPlusMinutes(PASSWORD_RESET_MINUTES);
    const table = tableForProfile(account.profile);

    await pool.execute(
      `UPDATE ${table}
       SET password_reset_token = ?, password_reset_expires_at = ?
       WHERE id = ?`,
      [tokenHash, expiresAt, account.id]
    );

    await sendPasswordResetEmail({
      to: account.email,
      name: account.name,
      token,
      resetUrl: buildResetUrl(token)
    });

    return { ...genericResponse, data: { email: maskEmail(account.email) } };
  } catch (err) {
    console.error("Erro em requestPasswordReset:", err);
    // Mesmo em falha de envio, nao revela se o cadastro existe.
    return genericResponse;
  }
}

async function findAccountByResetToken(token) {
  const tokenHash = hashResetToken(token);

  const sources = [
    { profile: "paciente", table: "pacientes", nameColumn: "nome_paciente" },
    { profile: "medico", table: "medicos", nameColumn: "name" },
    { profile: "clinica", table: "clinicas", nameColumn: "nome" }
  ];

  for (const source of sources) {
    const [rows] = await pool.execute(
      `SELECT id, ${source.nameColumn} AS name, email, password_reset_expires_at
       FROM ${source.table}
       WHERE password_reset_token = ? LIMIT 1`,
      [tokenHash]
    );

    if (rows[0]) {
      return { ...rows[0], profile: source.profile, table: source.table };
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

/**
 * Cria (ou reaproveita) o responsavel e o vincula ao paciente. Usado tanto pelo
 * cadastro do paciente quanto pelo POST /auth/patient/guardians, para que os
 * dois caminhos gravem exatamente a mesma coisa.
 *
 * Quando o CPF ja existe, a linha do responsavel e reaproveitada e **nada nela e
 * sobrescrito**: nome, e-mail e senha continuam sendo os que a propria pessoa
 * cadastrou. Isso e deliberado - se aceitassemos os dados enviados aqui,
 * qualquer paciente que soubesse o CPF de um responsavel existente conseguiria
 * trocar a senha dele so por "adiciona-lo".
 *
 * Recebe uma conexao ja em transacao; quem chama controla commit/rollback.
 */
export async function linkGuardianToPatient(connection, pacienteId, guardian) {
  const cpfDigits = String(guardian.cpf || "").replace(/\D/g, "");

  if (!cpfDigits) {
    return { ok: false, statusCode: 400, message: "CPF do responsavel e obrigatorio." };
  }

  const [existing] = await connection.execute(
    `SELECT id FROM responsavel WHERE cpf = ? LIMIT 1`,
    [cpfDigits]
  );

  let responsavelId = existing[0]?.id ?? null;
  const reused = Boolean(responsavelId);

  if (!responsavelId) {
    const guardianPasswordHash = await bcrypt.hash(String(guardian.password).trim(), SALT_ROUNDS);
    // responsavel.status e SMALLINT (1 = ativo). Antes era gravado 'ACTIVE'.
    const [inserted] = await connection.execute(
      `INSERT INTO responsavel (nome, email, cpf, senha, status)
       VALUES (?, ?, ?, ?, 1) RETURNING id`,
      [guardian.name, String(guardian.email).trim().toLowerCase(), cpfDigits, guardianPasswordHash]
    );
    responsavelId = inserted.rows?.[0]?.id ?? inserted.insertId ?? null;
  }

  if (!responsavelId) {
    return { ok: false, statusCode: 500, message: "Nao foi possivel criar o responsavel no banco de dados." };
  }

  // O mesmo responsavel pode acompanhar varios pacientes; refazer o vinculo so
  // atualiza o parentesco em vez de estourar a chave primaria composta.
  await connection.execute(
    `INSERT INTO paciente_responsavel (id_paciente, id_responsavel, parentesco)
     VALUES (?, ?, ?)
     ON CONFLICT (id_paciente, id_responsavel)
     DO UPDATE SET parentesco = EXCLUDED.parentesco`,
    [pacienteId, responsavelId, guardian.relationship]
  );

  await connection.execute(
    `UPDATE pacientes SET id_responsavel = ? WHERE id = ?`,
    [responsavelId, pacienteId]
  );

  const permissionIds = (Array.isArray(guardian.permissions) ? guardian.permissions : [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);

  for (const permissionId of permissionIds) {
    await connection.execute(
      `INSERT INTO responsavel_permissoes (id_permissao, id_responsavel)
       VALUES (?, ?) ON CONFLICT DO NOTHING`,
      [permissionId, responsavelId]
    );
  }

  return { ok: true, responsavelId, reused, permissions: permissionIds };
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
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // O paciente entra primeiro com id_responsavel nulo: linkGuardianToPatient
        // precisa do id dele para gravar o vinculo e depois preenche essa coluna.
        const [insertedPatient] = await connection.execute(
          `INSERT INTO pacientes (nome_paciente, cpf, email, tipo_deficiencia, data_nascimento, senha, id_responsavel, status)
           VALUES (?, ?, ?, ?, ?, ?, NULL, 'ACTIVE') RETURNING id`,
          [
            name,
            identifierInfo.value,
            userData?.email || null,
            userData?.tipoDeficiencia || null,
            userData?.dataNascimento || null,
            passwordHash
          ]
        );
        const patientId = insertedPatient.rows?.[0]?.id ?? insertedPatient.insertId ?? null;

        if (userData?.responsavel) {
          const linkResult = await linkGuardianToPatient(connection, patientId, userData.responsavel);
          if (!linkResult.ok) {
            await connection.rollback();
            return { ok: false, statusCode: linkResult.statusCode, message: linkResult.message };
          }
        }

        await connection.commit();
        result = { insertId: patientId };
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    } else if (profile === "medico") {
      [result] = await pool.execute(
        `INSERT INTO medicos (name, crm, email, especialidade, clinica_id, bio, unidade, senha, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE') RETURNING id`,
        [name, identifierInfo.value, userData?.email || null, userData?.especialidade || null, userData?.clinicaId || null, userData?.bio || null, userData?.unidade, passwordHash]
      );
    } else {
      [result] = await pool.execute(
        `INSERT INTO clinicas (nome, cnpj, email, razao_social, endereco, cidade, estado, cep, telefone, responsavel, senha, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE') RETURNING id`,
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

    // 23505 = unique_violation no Postgres (o codigo antigo checava ER_DUP_ENTRY,
    // que e do MySQL e nunca casava).
    if (err.code === "23505") {
      return { ok: false, statusCode: 409, message: "Identificador ou email ja cadastrado." };
    }

    return { ok: false, statusCode: 500, message: "Erro ao registrar usuario." };
  }
}

export async function registerProfessional({
  crm,
  crmUf = null,
  name,
  especialidade,
  clinicaId,
  bio = null,
  unidade,
  unidadeId = null,
  password,
  email = null,
  endereco = null
}) {
  try {
    if (!crm || !name || !clinicaId || !unidade || !password) {
      return { ok: false, statusCode: 400, message: "Todos os campos obrigatorios nao foram preenchidos." };
    }

    const crmInfo = detectIdentifierType(crm);
    if (!crmInfo || crmInfo.type !== "crm") {
      return { ok: false, statusCode: 400, message: "CRM invalido." };
    }

    const passwordTrimmed = password.trim();
    if (!isStrongPassword(passwordTrimmed)) {
      return { ok: false, statusCode: 400, message: "Senha deve ter 8 caracteres, maiuscula, minuscula, numero e caractere especial." };
    }

    const passwordHash = await bcrypt.hash(passwordTrimmed, SALT_ROUNDS);

    const [result] = await pool.execute(
      `INSERT INTO medicos
       (name, clinica_id, crm, crm_uf, especialidade, bio, unidade, unidade_id, email, senha,
        cep, logradouro, numero, bairro, cidade, estado, latitude, longitude,
        status, must_change_password, temporary_password_token, temporary_password_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', TRUE, ?, ?) RETURNING id`,
      [
        name,
        clinicaId,
        crmInfo.value,
        crmUf ? String(crmUf).toUpperCase() : null,
        especialidade || null,
        bio || null,
        unidade,
        unidadeId,
        email,
        passwordHash,
        endereco?.cep || null,
        endereco?.logradouro || null,
        endereco?.numero || null,
        endereco?.bairro || null,
        endereco?.cidade || null,
        endereco?.estado || null,
        endereco?.latitude ?? null,
        endereco?.longitude ?? null,
        passwordHash,
        nowPlusMinutes(60 * 24 * 7)
      ]
    );

    return {
      ok: true,
      statusCode: 201,
      message: "Profissional registrado com sucesso.",
      // A senha nao volta no corpo da resposta: quem chamou acabou de defini-la,
      // e ecoar senha em texto claro deixa rastro em log de proxy e no devtools.
      data: {
        id: result.insertId,
        crm: crmInfo.value,
        crmUf: crmUf ? String(crmUf).toUpperCase() : null,
        name,
        unidade,
        unidadeId
      }
    };
  } catch (err) {
    console.error("Erro em registerProfessional:", err);

    if (err.code === "23505") {
      return { ok: false, statusCode: 409, message: "CRM ou email ja cadastrado." };
    }

    if (err.code === "23503") {
      return { ok: false, statusCode: 404, message: "Clinica nao encontrada." };
    }

    return { ok: false, statusCode: 500, message: "Erro ao registrar profissional." };
  }
}

// ===========================================================================
// ACESSO DO RESPONSAVEL AOS DADOS DO PACIENTE
//
// As permissoes de responsavel_permissoes eram gravadas no cadastro mas nenhuma
// rota as consultava - na pratica eram decorativas. O par abaixo passa a
// aplica-las de fato.
// ===========================================================================

/**
 * Resolve para qual paciente o responsavel esta agindo e quais permissoes ele
 * tem sobre esse paciente.
 *
 * Como a mesma pessoa pode acompanhar varios pacientes, quem chama pode indicar
 * o paciente desejado. Se nao indicar e houver so um vinculo, usa esse; com mais
 * de um, exige a escolha explicita em vez de adivinhar.
 */
export async function getGuardianPatientAccess(responsavelId, requestedPatientId = null) {
  const [vinculos] = await pool.execute(
    `SELECT pr.id_paciente AS "patientId"
     FROM paciente_responsavel pr
     WHERE pr.id_responsavel = ?
     ORDER BY pr.id_paciente ASC`,
    [Number(responsavelId)]
  );

  if (!vinculos.length) {
    return { ok: false, statusCode: 403, message: "Voce nao esta vinculado a nenhum paciente." };
  }

  let patientId;
  if (requestedPatientId !== null && requestedPatientId !== undefined && requestedPatientId !== "") {
    patientId = Number(requestedPatientId);
    if (!vinculos.some((vinculo) => Number(vinculo.patientId) === patientId)) {
      return { ok: false, statusCode: 403, message: "Voce nao e responsavel por esse paciente." };
    }
  } else if (vinculos.length === 1) {
    patientId = Number(vinculos[0].patientId);
  } else {
    return {
      ok: false,
      statusCode: 400,
      message: "Informe o paciente (pacienteId): voce e responsavel por mais de um."
    };
  }

  const [permissoes] = await pool.execute(
    `SELECT p.nome
     FROM responsavel_permissoes rp
     INNER JOIN permissoes p ON p.id = rp.id_permissao
     WHERE rp.id_responsavel = ?`,
    [Number(responsavelId)]
  );

  return {
    ok: true,
    patientId,
    permissions: permissoes.map((linha) => String(linha.nome))
  };
}

/**
 * Middleware que define req.patientId - o paciente cujos dados a rota vai
 * manipular - e cobra a permissao indicada quando quem chama e um responsavel.
 *
 * Paciente logado passa direto (esta acessando os proprios dados). Responsavel
 * precisa do vinculo e da permissao. Qualquer outro perfil e barrado.
 */
export function requirePatientAccess(permissionName = null) {
  return async (req, res, next) => {
    try {
      if (req.user?.profile === "paciente") {
        req.patientId = Number(req.user.sub);
        return next();
      }

      if (req.user?.profile === "responsavel") {
        const requested = req.query?.pacienteId ?? req.body?.pacienteId ?? null;
        const access = await getGuardianPatientAccess(Number(req.user.sub), requested);

        if (!access.ok) {
          return res.status(access.statusCode).json({ message: access.message });
        }

        if (permissionName && !access.permissions.includes(permissionName)) {
          return res.status(403).json({
            message: `Seu acesso nao inclui a permissao "${permissionName}".`
          });
        }

        req.patientId = access.patientId;
        req.guardianPermissions = access.permissions;
        return next();
      }

      return res.status(403).json({ message: "Perfil sem acesso a dados de paciente." });
    } catch (err) {
      return next(err);
    }
  };
}
