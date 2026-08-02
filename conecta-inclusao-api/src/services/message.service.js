import { pool } from "../db.js";

export async function resolveActor(reqUser) {
  const profileId = Number(reqUser?.sub);
  const profile = reqUser?.profile;

  if (!profileId || !["paciente", "medico"].includes(profile)) {
    return {
      ok: false,
      statusCode: 403,
      message: "Acesso negado. Apenas pacientes e medicos podem usar mensagens."
    };
  }

  if (profile === "paciente") {
    const [rows] = await pool.execute(
      `SELECT id, nome_paciente AS name FROM pacientes WHERE id = ? LIMIT 1`,
      [profileId]
    );

    if (!rows[0]) {
      return { ok: false, statusCode: 404, message: "Paciente nao encontrado." };
    }
  } else {
    const [rows] = await pool.execute(
      `SELECT id, name FROM medicos WHERE id = ? LIMIT 1`,
      [profileId]
    );

    if (!rows[0]) {
      return { ok: false, statusCode: 404, message: "Medico nao encontrado." };
    }
  }

  return {
    ok: true,
    data: { profile, profileId }
  };
}

async function ensureMessagingTable() {
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS mensagens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      agendamento_id INT NOT NULL,
      remetente_profile ENUM('paciente', 'medico') NOT NULL,
      remetente_profile_id INT NOT NULL,
      destinatario_profile ENUM('paciente', 'medico') NOT NULL,
      destinatario_profile_id INT NOT NULL,
      conteudo TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id) ON DELETE CASCADE
    )`
  );
}

export async function findLinkBetweenProfiles(actor, targetProfileId) {
  if (actor.profile === "paciente") {
    const [rows] = await pool.execute(
      `SELECT
          a.id AS appointmentId,
          m.id AS targetProfileId,
          'medico' AS targetProfile,
          m.name AS targetName,
          m.especialidade AS targetSpecialty,
          m.unidade AS targetUnit
       FROM agendamentos a
       INNER JOIN medicos m ON m.id = a.medico_id
       WHERE a.paciente_id = ? AND m.id = ?
       ORDER BY a.data_agendamento DESC
       LIMIT 1`,
      [actor.profileId, targetProfileId]
    );

    return rows[0] || null;
  }

  const [rows] = await pool.execute(
    `SELECT
        a.id AS appointmentId,
        p.id AS targetProfileId,
        'paciente' AS targetProfile,
        p.nome_paciente AS targetName
     FROM agendamentos a
     INNER JOIN pacientes p ON p.id = a.paciente_id
     WHERE a.medico_id = ? AND p.id = ?
     ORDER BY a.data_agendamento DESC
     LIMIT 1`,
    [actor.profileId, targetProfileId]
  );

  return rows[0] || null;
}

export async function listAllowedMessageContacts(reqUser) {
  try {
    await ensureMessagingTable();

    const actorResult = await resolveActor(reqUser);
    if (!actorResult.ok) return actorResult;

    const actor = actorResult.data;

    if (actor.profile === "paciente") {
      const [rows] = await pool.execute(
        `SELECT
            DISTINCT m.id AS profileId,
            m.id AS userId,
            'medico' AS profile,
            m.name,
            m.crm AS registry,
            m.especialidade AS specialty,
            m.unidade AS unit,
            MAX(a.data_agendamento) AS lastAppointmentAt
         FROM agendamentos a
         INNER JOIN medicos m ON m.id = a.medico_id
         WHERE a.paciente_id = ?
         GROUP BY m.id, m.name, m.crm, m.especialidade, m.unidade
         ORDER BY lastAppointmentAt DESC, m.name ASC`,
        [actor.profileId]
      );

      return { ok: true, statusCode: 200, data: rows };
    }

    const [rows] = await pool.execute(
      `SELECT
          DISTINCT p.id AS profileId,
          p.id AS userId,
          'paciente' AS profile,
          p.nome_paciente AS name,
          p.cpf,
          MAX(a.data_agendamento) AS lastAppointmentAt
       FROM agendamentos a
       INNER JOIN pacientes p ON p.id = a.paciente_id
       WHERE a.medico_id = ?
       GROUP BY p.id, p.nome_paciente, p.cpf
       ORDER BY lastAppointmentAt DESC, p.nome_paciente ASC`,
      [actor.profileId]
    );

    return { ok: true, statusCode: 200, data: rows };
  } catch (error) {
    console.error("Erro em listAllowedMessageContacts:", error);
    return { ok: false, statusCode: 500, message: "Erro interno do servidor." };
  }
}

export async function getConversationWithUser(reqUser, targetProfileId) {
  try {
    await ensureMessagingTable();

    const actorResult = await resolveActor(reqUser);
    if (!actorResult.ok) return actorResult;

    const actor = actorResult.data;
    const normalizedTargetProfileId = Number(targetProfileId);

    if (!normalizedTargetProfileId) {
      return { ok: false, statusCode: 400, message: "Destino invalido." };
    }

    const allowedLink = await findLinkBetweenProfiles(actor, normalizedTargetProfileId);
    if (!allowedLink) {
      return {
        ok: false,
        statusCode: 403,
        message: "Acesso negado. Esta conversa so pode ocorrer entre partes vinculadas pelo mesmo atendimento."
      };
    }

    const [messages] = await pool.execute(
      `SELECT
          id,
          agendamento_id AS appointmentId,
          remetente_profile AS senderProfile,
          remetente_profile_id AS senderProfileId,
          remetente_profile_id AS senderUserId,
          destinatario_profile AS recipientProfile,
          destinatario_profile_id AS recipientProfileId,
          destinatario_profile_id AS recipientUserId,
          conteudo AS content,
          created_at AS createdAt
       FROM mensagens
       WHERE agendamento_id = ?
         AND (
           (remetente_profile = ? AND remetente_profile_id = ? AND destinatario_profile = ? AND destinatario_profile_id = ?)
           OR
           (remetente_profile = ? AND remetente_profile_id = ? AND destinatario_profile = ? AND destinatario_profile_id = ?)
         )
       ORDER BY created_at ASC, id ASC`,
      [
        allowedLink.appointmentId,
        actor.profile,
        actor.profileId,
        allowedLink.targetProfile,
        normalizedTargetProfileId,
        allowedLink.targetProfile,
        normalizedTargetProfileId,
        actor.profile,
        actor.profileId
      ]
    );

    return {
      ok: true,
      statusCode: 200,
      data: {
        contact: {
          profileId: normalizedTargetProfileId,
          userId: normalizedTargetProfileId,
          profile: allowedLink.targetProfile,
          name: allowedLink.targetName,
          specialty: allowedLink.targetSpecialty || null,
          unit: allowedLink.targetUnit || null
        },
        appointmentId: allowedLink.appointmentId,
        messages
      }
    };
  } catch (error) {
    console.error("Erro em getConversationWithUser:", error);
    return { ok: false, statusCode: 500, message: "Erro interno do servidor." };
  }
}

export async function saveMessageForConversation(actor, targetProfileId, content, appointmentId = null) {
  try {
    await ensureMessagingTable();

    const normalizedTargetProfileId = Number(targetProfileId);
    const normalizedContent = String(content || "").trim();

    if (!normalizedTargetProfileId) {
      return { ok: false, statusCode: 400, message: "Destino invalido." };
    }

    if (!normalizedContent) {
      return { ok: false, statusCode: 400, message: "A mensagem nao pode ser vazia." };
    }

    const allowedLink = await findLinkBetweenProfiles(actor, normalizedTargetProfileId);
    if (!allowedLink) {
      return {
        ok: false,
        statusCode: 403,
        message: "Acesso negado. Voce so pode enviar mensagens para usuarios vinculados ao mesmo atendimento."
      };
    }

    const effectiveAppointmentId = Number(appointmentId || allowedLink.appointmentId);
    const [result] = await pool.execute(
      `INSERT INTO mensagens
       (agendamento_id, remetente_profile, remetente_profile_id, destinatario_profile, destinatario_profile_id, conteudo)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [effectiveAppointmentId, actor.profile, actor.profileId, allowedLink.targetProfile, normalizedTargetProfileId, normalizedContent]
    );

    return {
      ok: true,
      statusCode: 201,
      data: {
        id: result.insertId,
        appointmentId: effectiveAppointmentId,
        senderProfile: actor.profile,
        senderProfileId: actor.profileId,
        senderUserId: actor.profileId,
        recipientProfile: allowedLink.targetProfile,
        recipientProfileId: normalizedTargetProfileId,
        recipientUserId: normalizedTargetProfileId,
        content: normalizedContent
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

    return saveMessageForConversation(actorResult.data, targetProfileId, content);
  } catch (error) {
    console.error("Erro em sendMessageToUser:", error);
    return { ok: false, statusCode: 500, message: "Erro interno do servidor." };
  }
}
