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

        // Duplicata do proprio paciente: mesmo medico, mesmo dia, mesmo
        // horario. Vem antes do conflito de agenda porque a mensagem precisa
        // ser outra - nao e "horario ocupado", e "voce ja marcou isso".
        const [duplicado] = await pool.execute(
            `SELECT id
             FROM agendamentos
             WHERE paciente_id = ?
               AND medico_id = ?
               AND data_agendamento = ?
               AND LOWER(status) <> 'cancelado'`,
            [paciente.id, profissional.id, data_agendamento]
        );

        if (duplicado.length > 0) {
            return {
                ok: false,
                statusCode: 409,
                message: "Voce ja tem uma consulta com esse profissional nesse dia e horario"
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
        // 23505 = idx_agendamentos_sem_duplicata. A checagem acima resolve o
        // caso comum; o indice fecha a corrida entre duas requisicoes que
        // passaram pelo SELECT ao mesmo tempo.
        if (error.code === "23505") {
            return {
                ok: false,
                statusCode: 409,
                message: "Voce ja tem uma consulta com esse profissional nesse dia e horario"
            };
        }

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
            // Colunas explicitas no lugar de `a.*` + o cadastro de saude do
            // paciente. A agenda da clinica e uma lista administrativa: quem
            // atende quem e quando. CPF, e-mail, data de nascimento e tipo de
            // deficiencia nao aparecem em tela nenhuma dela e nao tem por que
            // trafegar - qualquer um com o devtools aberto lia tudo isso.
            `SELECT a.id,
                    a.paciente_id,
                    a.medico_id,
                    a.clinica_id,
                    TO_CHAR(a.data_agendamento, 'YYYY-MM-DD"T"HH24:MI:SS') AS data_agendamento,
                    a.status,
                    p.nome_paciente AS paciente_nome,
                    m.name AS profissional_nome,
                    m.especialidade AS profissional_especialidade
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
            // CPF e e-mail ficam: sao o que a aba "Pacientes" do medico exibe
            // para identificar quem ele atende. Data de nascimento, tipo de
            // deficiencia e status do paciente saem - nenhuma tela do medico os
            // usa, e sao os campos mais sensiveis do cadastro.
            `SELECT a.id,
                    a.paciente_id,
                    a.medico_id,
                    a.clinica_id,
                    TO_CHAR(a.data_agendamento, 'YYYY-MM-DD"T"HH24:MI:SS') AS data_agendamento,
                    a.status,
                    p.nome_paciente AS paciente_nome,
                    p.cpf AS paciente_cpf,
                    p.email AS paciente_email,
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
            `SELECT a.id,
                    a.paciente_id,
                    a.medico_id,
                    a.clinica_id,
                    TO_CHAR(a.data_agendamento, 'YYYY-MM-DD"T"HH24:MI:SS') AS data_agendamento,
                    a.status,
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

// ===========================================================================
// HORARIOS DISPONIVEIS
//
// O modal de agendamento do paciente usava <input type="time"> livre: dava para
// escolher 03:47 de madrugada, ou um horario que o medico ja tinha ocupado - e
// o horario escolhido sequer era enviado ao servidor (a rota recebia so a data
// e gravava 00:00:00). Aqui ficam as regras de grade que o front consome.
// ===========================================================================

// Expediente padrao. O ultimo horario ofertado e ATENDIMENTO_FIM menos um
// intervalo, para a consulta caber dentro do expediente.
const ATENDIMENTO_INICIO_MIN = 8 * 60;   // 08:00
const ATENDIMENTO_FIM_MIN = 18 * 60;     // 18:00
const INTERVALO_MIN = 30;

function minutosParaHora(minutos) {
    const hora = String(Math.floor(minutos / 60)).padStart(2, "0");
    const minuto = String(minutos % 60).padStart(2, "0");
    return `${hora}:${minuto}`;
}

/** true se a string for uma data ISO de calendario valida (YYYY-MM-DD). */
function ehDataValida(data) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ""))) return false;
    const [ano, mes, dia] = String(data).split("-").map(Number);
    const referencia = new Date(ano, mes - 1, dia);
    return referencia.getFullYear() === ano
        && referencia.getMonth() === mes - 1
        && referencia.getDate() === dia;
}

/**
 * Grade de 30 em 30 minutos de um medico num dia, marcando o que ja esta
 * ocupado.
 *
 * `ignorarAgendamentoId` existe para a remarcacao: ao reabrir o modal de uma
 * consulta que ja existe, o horario dela precisa continuar selecionavel - caso
 * contrario o proprio agendamento se bloquearia.
 *
 * @returns {Promise<{ok: boolean, statusCode?: number, message?: string, data?: object}>}
 */
export async function listarHorariosDisponiveis(medicoId, data, { ignorarAgendamentoId = null } = {}) {
    try {
        if (!ehDataValida(data)) {
            return { ok: false, statusCode: 400, message: "Data invalida. Use o formato YYYY-MM-DD." };
        }

        const profissional = await resolveProfissionalId(medicoId);
        if (!profissional) {
            return { ok: false, statusCode: 404, message: "Profissional nao encontrado ou inativo" };
        }

        // TO_CHAR mantem a hora de parede gravada, sem a conversao para UTC que
        // o driver pg aplicaria ao devolver um Date - a mesma razao do TO_CHAR
        // nas listagens de agendamento.
        const condicoes = [
            "medico_id = ?",
            "data_agendamento >= ?::date",
            "data_agendamento < (?::date + INTERVAL '1 day')",
            "LOWER(status) <> 'cancelado'"
        ];
        const valores = [profissional.id, data, data];

        if (ignorarAgendamentoId) {
            condicoes.push("id <> ?");
            valores.push(ignorarAgendamentoId);
        }

        const [ocupadosRows] = await pool.execute(
            `SELECT TO_CHAR(data_agendamento, 'HH24:MI') AS hora
             FROM agendamentos
             WHERE ${condicoes.join(" AND ")}`,
            valores
        );

        const ocupados = new Set(ocupadosRows.map((linha) => linha.hora));

        // Para hoje, horario que ja passou nao pode ser ofertado. A comparacao
        // usa a hora local do servidor, que e a mesma referencia usada para
        // gravar data_agendamento (TIMESTAMP sem fuso).
        const agora = new Date();
        const hojeIso = [
            agora.getFullYear(),
            String(agora.getMonth() + 1).padStart(2, "0"),
            String(agora.getDate()).padStart(2, "0")
        ].join("-");

        const ehHoje = data === hojeIso;
        const minutosAgora = agora.getHours() * 60 + agora.getMinutes();

        const horarios = [];
        for (let minuto = ATENDIMENTO_INICIO_MIN; minuto <= ATENDIMENTO_FIM_MIN - INTERVALO_MIN; minuto += INTERVALO_MIN) {
            const hora = minutosParaHora(minuto);
            const ocupado = ocupados.has(hora);
            const passou = ehHoje && minuto <= minutosAgora;

            horarios.push({
                hora,
                disponivel: !ocupado && !passou,
                motivo: ocupado ? "ocupado" : (passou ? "passado" : null)
            });
        }

        return {
            ok: true,
            statusCode: 200,
            data: {
                data,
                medicoId: profissional.id,
                intervaloMinutos: INTERVALO_MIN,
                horarios
            }
        };
    } catch (error) {
        console.error("Erro ao listar horarios disponiveis:", error);
        return { ok: false, statusCode: 500, message: "Erro interno do servidor" };
    }
}

/** true se `hora` (HH:MM) cai exatamente na grade de 30 em 30 do expediente. */
export function horarioDentroDaGrade(hora) {
    const partes = /^(\d{2}):(\d{2})$/.exec(String(hora || ""));
    if (!partes) return false;

    const minutos = Number(partes[1]) * 60 + Number(partes[2]);

    return minutos >= ATENDIMENTO_INICIO_MIN
        && minutos <= ATENDIMENTO_FIM_MIN - INTERVALO_MIN
        && minutos % INTERVALO_MIN === 0;
}
