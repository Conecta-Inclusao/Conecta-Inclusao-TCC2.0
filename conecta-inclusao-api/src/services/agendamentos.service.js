import { pool } from "../db.js";

async function resolvePacienteId(pacienteId) {
    const [pacienteRows] = await pool.execute(
        `SELECT p.id
         FROM pacientes p
         WHERE p.id = ?
           AND LOWER(p.status) IN ('active', 'ativo')
         LIMIT 1`,
        [pacienteId]
    );

    return pacienteRows[0] || null;
}

async function resolveProfissionalId(profissionalId) {
    const [profissionalRows] = await pool.execute(
        `SELECT m.id, m.clinica_id, m.especialidade, m.unidade
         FROM medicos m
         WHERE m.id = ?
           AND LOWER(m.status) IN ('active', 'ativo', 'trabalhando')
         LIMIT 1`,
        [profissionalId]
    );

    return profissionalRows[0] || null;
}

async function resolveClinicaId(clinicaId) {
    const [clinicaRows] = await pool.execute(
        "SELECT id, razao_social FROM clinicas WHERE id = ? AND LOWER(status) IN ('active', 'ativo') LIMIT 1",
        [clinicaId]
    );

    return clinicaRows[0] || null;
}

export async function createAgendamento(data) {
    try {
        const {
            clinica_id,
            paciente_id,
            profissional_id,
            data_agendamento,
            especialidade,
            tipo_consulta = "presencial",
            observacoes
        } = data;

        const clinica = await resolveClinicaId(clinica_id);
        if (!clinica) {
            return {
                ok: false,
                statusCode: 404,
                message: "Clinica nao encontrada"
            };
        }

        const paciente = await resolvePacienteId(paciente_id);
        if (!paciente) {
            return {
                ok: false,
                statusCode: 404,
                message: "Paciente nao encontrado ou inativo"
            };
        }

        const profissional = await resolveProfissionalId(profissional_id);
        if (!profissional) {
            return {
                ok: false,
                statusCode: 404,
                message: "Profissional nao encontrado ou inativo"
            };
        }

        const clinicaRelacionada = profissional.clinica_id || clinica.id;
        if (clinicaRelacionada !== clinica.id) {
            return {
                ok: false,
                statusCode: 409,
                message: "Profissional nao pertence a clinica informada"
            };
        }

        const [conflito] = await pool.execute(
            `SELECT id
             FROM agendamentos
             WHERE medico_id = ?
               AND data_agendamento = ?
               AND status IN ('confirmado', 'pendente')`,
            [profissional.id, data_agendamento]
        );

        if (conflito.length > 0) {
            return {
                ok: false,
                statusCode: 409,
                message: "Horario ja ocupado para este profissional"
            };
        }

        // RETURNING id e obrigatorio: sem ele o mapResult de db.js le rows[0].id
        // de um resultado vazio e o insertId volta sempre null.
        const [result] = await pool.execute(
            `INSERT INTO agendamentos (clinica_id, paciente_id, medico_id, data_agendamento, status)
             VALUES (?, ?, ?, ?, 'pendente')
             RETURNING id`,
            [
                clinica.id,
                paciente.id,
                profissional.id,
                data_agendamento
            ]
        );

        return {
            ok: true,
            statusCode: 201,
            message: "Agendamento criado com sucesso",
            data: {
                id: result.rows?.[0]?.id ?? result.insertId,
                clinica_id: clinica.id,
                paciente_id: paciente.id,
                medico_id: profissional.id,
                data_agendamento,
                status: "pendente"
            }
        };
    } catch (error) {
        console.error("Erro ao criar agendamento:", error);
        return {
            ok: false,
            statusCode: 500,
            message: "Erro interno do servidor"
        };
    }
}

export async function listAgendamentosByClinica(clinica_id, limit = 10, offset = 0) {
    try {
        const [rows] = await pool.execute(
            `SELECT a.*,
                    p.nome_paciente AS paciente_nome,
                    p.cpf AS paciente_cpf,
                    p.email AS paciente_email,
                    p.status AS paciente_status,
                    p.data_nascimento AS paciente_data_nascimento,
                    p.tipo_deficiencia AS paciente_tipo_deficiencia,
                    m.name AS profissional_nome,
                    m.crm AS profissional_crm
             FROM agendamentos a
             INNER JOIN pacientes p ON a.paciente_id = p.id
             INNER JOIN medicos m ON a.medico_id = m.id
             WHERE a.clinica_id = ?
             ORDER BY a.data_agendamento DESC
             LIMIT ? OFFSET ?`,
            [clinica_id, limit, offset]
        );

        return {
            ok: true,
            data: rows
        };
    } catch (error) {
        console.error("Erro ao listar agendamentos por clinica:", error);
        return {
            ok: false,
            statusCode: 500,
            message: "Erro interno do servidor"
        };
    }
}

export async function listAgendamentosByProfissional(profissional_id, limit = 10, offset = 0) {
    try {
        const profissional = await resolveProfissionalId(profissional_id);
        if (!profissional) {
            return {
                ok: false,
                statusCode: 404,
                message: "Profissional nao encontrado"
            };
        }

        const [rows] = await pool.execute(
            `SELECT a.*,
                    p.nome_paciente AS paciente_nome,
                    p.cpf AS paciente_cpf,
                    p.email AS paciente_email,
                    p.status AS paciente_status,
                    p.data_nascimento AS paciente_data_nascimento,
                    p.tipo_deficiencia AS paciente_tipo_deficiencia,
                    c.razao_social AS clinica_nome,
                    m.especialidade AS profissional_especialidade
             FROM agendamentos a
             INNER JOIN pacientes p ON a.paciente_id = p.id
             INNER JOIN clinicas c ON a.clinica_id = c.id
             INNER JOIN medicos m ON a.medico_id = m.id
             WHERE a.medico_id = ?
             ORDER BY a.data_agendamento DESC
             LIMIT ? OFFSET ?`,
            [profissional.id, limit, offset]
        );

        return {
            ok: true,
            data: rows
        };
    } catch (error) {
        console.error("Erro ao listar agendamentos por profissional:", error);
        return {
            ok: false,
            statusCode: 500,
            message: "Erro interno do servidor"
        };
    }
}

export async function listAgendamentosByPaciente(paciente_id, limit = 10, offset = 0) {
    try {
        const paciente = await resolvePacienteId(paciente_id);
        if (!paciente) {
            return {
                ok: false,
                statusCode: 404,
                message: "Paciente nao encontrado"
            };
        }

        const [rows] = await pool.execute(
            `SELECT a.*,
                    m.name AS profissional_nome,
                    m.crm AS profissional_crm,
                    m.especialidade AS profissional_especialidade,
                    c.razao_social AS clinica_nome
             FROM agendamentos a
             INNER JOIN medicos m ON a.medico_id = m.id
             INNER JOIN clinicas c ON a.clinica_id = c.id
             WHERE a.paciente_id = ?
             ORDER BY a.data_agendamento DESC
             LIMIT ? OFFSET ?`,
            [paciente.id, limit, offset]
        );

        return {
            ok: true,
            data: rows
        };
    } catch (error) {
        console.error("Erro ao listar agendamentos por paciente:", error);
        return {
            ok: false,
            statusCode: 500,
            message: "Erro interno do servidor"
        };
    }
}

export async function updateAgendamentoStatus(id, status) {
    try {
        const validStatuses = ["pendente", "confirmado", "cancelado", "realizado"];

        if (!validStatuses.includes(status)) {
            return {
                ok: false,
                statusCode: 400,
                message: "Status invalido"
            };
        }

        const [result] = await pool.execute(
            "UPDATE agendamentos SET status = ? WHERE id = ?",
            [status, id]
        );

        if (result.affectedRows === 0) {
            return {
                ok: false,
                statusCode: 404,
                message: "Agendamento nao encontrado"
            };
        }

        return {
            ok: true,
            statusCode: 200,
            message: "Status atualizado com sucesso"
        };
    } catch (error) {
        console.error("Erro ao atualizar status:", error);
        return {
            ok: false,
            statusCode: 500,
            message: "Erro interno do servidor"
        };
    }
}
