import { pool } from "../db.js";

// A tabela `mensagens` do schema real nao tem colunas de destinatario: uma
// mensagem pertence a um agendamento, e o destinatario e sempre "a outra parte"
// daquele atendimento. A conversa entre um paciente e um medico e, portanto, o
// conjunto de mensagens de todos os agendamentos que ligam os dois.
//
// A versao anterior deste arquivo consultava remetente_profile/destinatario_*
// e ainda rodava um CREATE TABLE com DDL de MySQL (AUTO_INCREMENT/ENUM) contra
// o Postgres, o que fazia toda rota /messages responder 500.

const MESSAGE_PROFILES = ["paciente", "medico"];

export async function resolveActor(reqUser) {
  const profileId = Number(reqUser?.sub);
  const profile = reqUser?.profile;

  if (!profileId || !MESSAGE_PROFILES.includes(profile)) {
    return {
      ok: false,
      statusCode: 403,
      message: "Acesso negado. Apenas pacientes e medicos podem usar mensagens."
    };
  }

  const [rows] = profile === "paciente"
    ? await pool.execute(
        `SELECT id, nome_paciente AS name FROM pacientes WHERE id = ? LIMIT 1`,
        [profileId]
      )
    : await pool.execute(
        `SELECT id, name FROM medicos WHERE id = ? LIMIT 1`,
        [profileId]
      );

  if (!rows[0]) {
    return {
      ok: false,
      statusCode: 404,
      message: profile === "paciente" ? "Paciente nao encontrado." : "Medico nao encontrado."
    };
  }

  return {
    ok: true,
    data: { profile, profileId, name: rows[0].name }
  };
}

/**
 * Retorna o vinculo entre o ator e o outro perfil, ou null se eles nunca
 * compartilharam um atendimento. Esta funcao e a unica autorizacao de
 * mensagens: sem vinculo, nao ha conversa.
 */
export async function findLinkBetweenProfiles(actor, targetProfileId) {
  const normalizedTargetProfileId = Number(targetProfileId);

  if (!Number.isInteger(normalizedTargetProfileId) || normalizedTargetProfileId <= 0) {
    return null;
  }

  const [rows] = actor.profile === "paciente"
    ? await pool.execute(
        `SELECT a.id AS appointment_id,
                a.data_agendamento,
                m.id AS target_id,
                m.name AS target_name,
                m.especialidade AS target_specialty,
                m.unidade AS target_unit,
                m.crm AS target_registry
         FROM agendamentos a
         INNER JOIN medicos m ON m.id = a.medico_id
         WHERE a.paciente_id = ? AND a.medico_id = ?
         ORDER BY a.data_agendamento DESC`,
        [actor.profileId, normalizedTargetProfileId]
      )
    : await pool.execute(
        `SELECT a.id AS appointment_id,
                a.data_agendamento,
                p.id AS target_id,
                p.nome_paciente AS target_name,
                NULL AS target_specialty,
                NULL AS target_unit,
                p.cpf AS target_registry
         FROM agendamentos a
         INNER JOIN pacientes p ON p.id = a.paciente_id
         WHERE a.medico_id = ? AND a.paciente_id = ?
         ORDER BY a.data_agendamento DESC`,
        [actor.profileId, normalizedTargetProfileId]
      );

  if (!rows.length) return null;

  return {
    // Todos os agendamentos entre as duas partes compoem uma unica thread.
    appointmentIds: rows.map((row) => Number(row.appointment_id)),
    // Mensagens novas sao gravadas no atendimento mais recente.
    appointmentId: Number(rows[0].appointment_id),
    targetProfile: actor.profile === "paciente" ? "medico" : "paciente",
    targetProfileId: Number(rows[0].target_id),
    targetName: rows[0].target_name,
    targetSpecialty: rows[0].target_specialty || null,
    targetUnit: rows[0].target_unit || null,
    targetRegistry: rows[0].target_registry || null
  };
}

/**
 * Nome canonico da sala de socket. Sempre derivado do par (paciente, medico)
 * no servidor - o cliente nunca escolhe a sala em que entra.
 */
export function conversationRoom(actor, link) {
  const pacienteId = actor.profile === "paciente" ? actor.profileId : link.targetProfileId;
  const medicoId = actor.profile === "medico" ? actor.profileId : link.targetProfileId;
  return `conversa:paciente:${pacienteId}:medico:${medicoId}`;
}

export async function listAllowedMessageContacts(reqUser) {
  try {
    const actorResult = await resolveActor(reqUser);
    if (!actorResult.ok) return actorResult;

    const actor = actorResult.data;

    if (actor.profile === "paciente") {
      const [rows] = await pool.execute(
        `SELECT m.id AS "profileId",
                m.id AS "userId",
                'medico' AS profile,
                m.name,
                m.crm AS registry,
                m.especialidade AS specialty,
                m.unidade AS unit,
                MAX(a.data_agendamento) AS "lastAppointmentAt",
                COUNT(msg.id) FILTER (
                  WHERE msg.remetente_profile = 'medico' AND msg.lida = FALSE
                ) AS "unreadCount"
         FROM agendamentos a
         INNER JOIN medicos m ON m.id = a.medico_id
         LEFT JOIN mensagens msg ON msg.agendamento_id = a.id
         WHERE a.paciente_id = ?
         GROUP BY m.id, m.name, m.crm, m.especialidade, m.unidade
         ORDER BY "lastAppointmentAt" DESC, m.name ASC`,
        [actor.profileId]
      );

      return { ok: true, statusCode: 200, data: rows };
    }

    const [rows] = await pool.execute(
      `SELECT p.id AS "profileId",
              p.id AS "userId",
              'paciente' AS profile,
              p.nome_paciente AS name,
              MAX(a.data_agendamento) AS "lastAppointmentAt",
              COUNT(msg.id) FILTER (
                WHERE msg.remetente_profile = 'paciente' AND msg.lida = FALSE
              ) AS "unreadCount"
       FROM agendamentos a
       INNER JOIN pacientes p ON p.id = a.paciente_id
       LEFT JOIN mensagens msg ON msg.agendamento_id = a.id
       WHERE a.medico_id = ?
       GROUP BY p.id, p.nome_paciente
       ORDER BY "lastAppointmentAt" DESC, p.nome_paciente ASC`,
      [actor.profileId]
    );

    return { ok: true, statusCode: 200, data: rows };
  } catch (error) {
    console.error("Erro em listAllowedMessageContacts:", error);
    return { ok: false, statusCode: 500, message: "Erro interno do servidor." };
  }
}

function serializeMessage(row, actor) {
  return {
    id: Number(row.id),
    appointmentId: Number(row.appointmentId),
    senderProfile: row.senderProfile,
    senderProfileId: Number(row.senderProfileId),
    content: row.content,
    read: row.read === true,
    createdAt: row.createdAt,
    mine: row.senderProfile === actor.profile && Number(row.senderProfileId) === actor.profileId
  };
}

async function markIncomingAsRead(actor, appointmentIds) {
  await pool.execute(
    `UPDATE mensagens
     SET lida = TRUE
     WHERE agendamento_id = ANY(?)
       AND remetente_profile <> ?
       AND lida = FALSE`,
    [appointmentIds, actor.profile]
  );
}

export async function getConversationWithUser(reqUser, targetProfileId) {
  try {
    const actorResult = await resolveActor(reqUser);
    if (!actorResult.ok) return actorResult;

    const actor = actorResult.data;
    const link = await findLinkBetweenProfiles(actor, targetProfileId);

    if (!link) {
      return {
        ok: false,
        statusCode: 403,
        message: "Acesso negado. Esta conversa so pode ocorrer entre partes vinculadas pelo mesmo atendimento."
      };
    }

    const [rows] = await pool.execute(
      `SELECT id,
              agendamento_id AS "appointmentId",
              remetente_profile AS "senderProfile",
              remetente_profile_id AS "senderProfileId",
              conteudo AS content,
              lida AS read,
              created_at AS "createdAt"
       FROM mensagens
       WHERE agendamento_id = ANY(?)
       ORDER BY created_at ASC, id ASC`,
      [link.appointmentIds]
    );

    await markIncomingAsRead(actor, link.appointmentIds);

    return {
      ok: true,
      statusCode: 200,
      data: {
        contact: {
          profileId: link.targetProfileId,
          userId: link.targetProfileId,
          profile: link.targetProfile,
          name: link.targetName,
          specialty: link.targetSpecialty,
          unit: link.targetUnit
        },
        appointmentId: link.appointmentId,
        messages: rows.map((row) => serializeMessage(row, actor))
      }
    };
  } catch (error) {
    console.error("Erro em getConversationWithUser:", error);
    return { ok: false, statusCode: 500, message: "Erro interno do servidor." };
  }
}

/**
 * Persiste uma mensagem. Recebe o `actor` ja resolvido e revalida o vinculo,
 * de modo que REST e socket compartilham exatamente a mesma autorizacao.
 */
export async function saveMessageForConversation(actor, targetProfileId, content) {
  try {
    const normalizedContent = String(content || "").trim();

    if (!normalizedContent) {
      return { ok: false, statusCode: 400, message: "A mensagem nao pode ser vazia." };
    }

    if (normalizedContent.length > 2000) {
      return { ok: false, statusCode: 400, message: "Mensagem muito longa." };
    }

    const link = await findLinkBetweenProfiles(actor, targetProfileId);
    if (!link) {
      return {
        ok: false,
        statusCode: 403,
        message: "Acesso negado. Voce so pode enviar mensagens para usuarios vinculados ao mesmo atendimento."
      };
    }

    const [result] = await pool.execute(
      `INSERT INTO mensagens (agendamento_id, remetente_profile, remetente_profile_id, conteudo, lida)
       VALUES (?, ?, ?, ?, FALSE)
       RETURNING id, created_at`,
      [link.appointmentId, actor.profile, actor.profileId, normalizedContent]
    );

    const inserted = result.rows?.[0] || {};

    return {
      ok: true,
      statusCode: 201,
      data: {
        message: {
          id: Number(inserted.id),
          appointmentId: link.appointmentId,
          senderProfile: actor.profile,
          senderProfileId: actor.profileId,
          senderName: actor.name,
          content: normalizedContent,
          read: false,
          createdAt: inserted.created_at || new Date().toISOString()
        },
        link
      }
    };
  } catch (error) {
    console.error("Erro ao salvar mensagem da conversa:", error);
    return { ok: false, statusCode: 500, message: "Erro interno do servidor." };
  }
}

export async function sendMessageToUser(reqUser, targetProfileId, content) {
  try {
    const actorResult = await resolveActor(reqUser);
    if (!actorResult.ok) return actorResult;

    const result = await saveMessageForConversation(actorResult.data, targetProfileId, content);
    if (!result.ok) return result;

    return {
      ok: true,
      statusCode: 201,
      data: result.data.message
    };
  } catch (error) {
    console.error("Erro em sendMessageToUser:", error);
    return { ok: false, statusCode: 500, message: "Erro interno do servidor." };
  }
}
