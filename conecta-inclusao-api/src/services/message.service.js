import { pool } from "../db.js";

const ALLOWED_PROFILES = ["paciente", "medico", "responsavel", "clinica"];
const MAX_MESSAGE_LENGTH = 2000;
const MAX_PAGE_LIMIT = 100;

export function getRoomName(agendamentoId) {
  return `chat_${agendamentoId}`;
}

function actorIdFromUser(user) {
  return Number(user?.sub || user?.profileId);
}

function normalizePagination({ page = 1, limit = 30 } = {}) {
  const normalizedPage = Math.max(Number(page) || 1, 1);
  const normalizedLimit = Math.min(Math.max(Number(limit) || 30, 1), MAX_PAGE_LIMIT);
  const offset = (normalizedPage - 1) * normalizedLimit;

  return { page: normalizedPage, limit: normalizedLimit, offset };
}

export function resolveActorFromAuth(user) {
  const profile = user?.profile;
  const profileId = actorIdFromUser(user);

  if (!ALLOWED_PROFILES.includes(profile) || !profileId) {
    return null;
  }

  return { profile, profileId };
}

async function ensureMessagingTable() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS mensagens (
      id BIGSERIAL PRIMARY KEY,
      agendamento_id INTEGER NOT NULL,
      remetente_profile VARCHAR(20) NOT NULL,
      remetente_profile_id INTEGER NOT NULL,
      conteudo TEXT NOT NULL,
      lida BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_mensagens_agendamento FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id) ON DELETE CASCADE
    )
  `);

  await pool.execute("ALTER TABLE mensagens ADD COLUMN IF NOT EXISTS lida BOOLEAN DEFAULT FALSE");
  await pool.execute("ALTER TABLE mensagens ALTER COLUMN remetente_profile TYPE VARCHAR(20)");
  await pool.execute("ALTER TABLE mensagens ALTER COLUMN remetente_profile SET NOT NULL");
}

async function findAppointment(agendamentoId) {
  const [rows] = await pool.execute(
    `SELECT id, paciente_id, medico_id, clinica_id, status, data_agendamento
     FROM agendamentos
     WHERE id = ?
     LIMIT 1`,
    [agendamentoId]
  );

  return rows[0] || null;
}

async function guardianCanAccess(pacienteId, responsavelId) {
  const [rows] = await pool.execute(
    `SELECT 1
     FROM paciente_responsavel
     WHERE id_paciente = ? AND id_responsavel = ?
     LIMIT 1`,
    [pacienteId, responsavelId]
  );

  return Boolean(rows[0]);
}

async function canAccessAppointment(appointment, actor) {
  if (actor.profile === "paciente") {
    return Number(appointment.paciente_id) === actor.profileId;
  }

  if (actor.profile === "medico") {
    return Number(appointment.medico_id) === actor.profileId;
  }

  if (actor.profile === "clinica") {
    return Number(appointment.clinica_id) === actor.profileId;
  }

  if (actor.profile === "responsavel") {
    return guardianCanAccess(appointment.paciente_id, actor.profileId);
  }

  return false;
}

export async function validateChatAccess(user, agendamentoId) {
  try {
    const actor = resolveActorFromAuth(user);
    const normalizedAgendamentoId = Number(agendamentoId);

    if (!actor) {
      return { ok: false, statusCode: 403, message: "Perfil sem permissao para acessar o chat." };
    }

    if (!normalizedAgendamentoId) {
      return { ok: false, statusCode: 400, message: "Agendamento invalido." };
    }

    const appointment = await findAppointment(normalizedAgendamentoId);
    if (!appointment) {
      return { ok: false, statusCode: 404, message: "Agendamento nao encontrado." };
    }

    const allowed = await canAccessAppointment(appointment, actor);
    if (!allowed) {
      return { ok: false, statusCode: 403, message: "Acesso negado ao chat deste agendamento." };
    }

    return {
      ok: true,
      statusCode: 200,
      data: { actor, appointment, room: getRoomName(normalizedAgendamentoId) }
    };
  } catch (error) {
    console.error("Erro em validateChatAccess:", error);
    return { ok: false, statusCode: 500, message: "Erro interno do servidor." };
  }
}

export async function listMessagesByAppointment(user, agendamentoId, pagination = {}) {
  try {
    await ensureMessagingTable();

    const access = await validateChatAccess(user, agendamentoId);
    if (!access.ok) return access;

    const { page, limit, offset } = normalizePagination(pagination);
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM mensagens
       WHERE agendamento_id = ?`,
      [access.data.appointment.id]
    );

    const total = Number(countRows[0]?.total || 0);
    const [messages] = await pool.execute(
      `SELECT
          id,
          agendamento_id AS agendamentoId,
          remetente_profile AS remetenteProfile,
          remetente_profile_id AS remetenteProfileId,
          conteudo,
          lida,
          created_at AS createdAt
       FROM mensagens
       WHERE agendamento_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [access.data.appointment.id, limit, offset]
    );

    return {
      ok: true,
      statusCode: 200,
      data: {
        agendamentoId: access.data.appointment.id,
        room: access.data.room,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        messages: messages.reverse()
      }
    };
  } catch (error) {
    console.error("Erro em listMessagesByAppointment:", error);
    return { ok: false, statusCode: 500, message: "Erro interno do servidor." };
  }
}

export async function createMessageForAppointment(user, agendamentoId, content) {
  try {
    await ensureMessagingTable();

    const access = await validateChatAccess(user, agendamentoId);
    if (!access.ok) return access;

    if (access.data.actor.profile === "clinica") {
      return { ok: false, statusCode: 403, message: "Clinicas ainda nao podem enviar mensagens." };
    }

    const normalizedContent = String(content || "").trim();

    if (!normalizedContent) {
      return { ok: false, statusCode: 400, message: "A mensagem nao pode ser vazia." };
    }

    if (normalizedContent.length > MAX_MESSAGE_LENGTH) {
      return { ok: false, statusCode: 400, message: "Mensagem muito longa." };
    }

    const { actor, appointment, room } = access.data;
    const [result] = await pool.execute(
      `INSERT INTO mensagens
       (agendamento_id, remetente_profile, remetente_profile_id, conteudo)
       VALUES (?, ?, ?, ?)`,
      [appointment.id, actor.profile, actor.profileId, normalizedContent]
    );

    const [rows] = await pool.execute(
      `SELECT
          id,
          agendamento_id AS agendamentoId,
          remetente_profile AS remetenteProfile,
          remetente_profile_id AS remetenteProfileId,
          conteudo,
          lida,
          created_at AS createdAt
       FROM mensagens
       WHERE id = ?
       LIMIT 1`,
      [result.insertId]
    );

    return {
      ok: true,
      statusCode: 201,
      data: {
        room,
        message: rows[0]
      }
    };
  } catch (error) {
    console.error("Erro em createMessageForAppointment:", error);
    return { ok: false, statusCode: 500, message: "Erro interno do servidor." };
  }
}
