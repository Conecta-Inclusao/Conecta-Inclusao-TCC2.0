// Rotas de agendamentos.
//
// ATENCAO (era o pior problema do projeto): nenhuma rota deste arquivo exigia
// autenticacao. Como os SELECTs retornam cpf, email, data_nascimento e
// tipo_deficiencia do paciente, bastava iterar o :id na URL para baixar o
// cadastro de saude de todas as criancas atendidas. Agora toda rota exige token
// e valida que o solicitante e dono do recurso.
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../db.js";
import { createAgendamentoSchema } from "../validators/agendamentos.validators.js";
import { authenticateToken } from "../services/auth.advanced.service.js";
import {
    createAgendamento,
    listAgendamentosByClinica,
    listAgendamentosByProfissional,
    listAgendamentosByPaciente,
    updateAgendamentoStatus
} from "../services/agendamentos.service.js";

const router = Router();

const agendamentoCreateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false
});

// Todas as rotas abaixo exigem token valido.
router.use(authenticateToken);

function parsePagination(req) {
    return {
        limit: Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100),
        offset: Math.max(parseInt(req.query.offset, 10) || 0, 0)
    };
}

/** A clinica do medico autenticado, usada para autorizar acessos cruzados. */
async function getDoctorClinicId(medicoId) {
    const [[row]] = await pool.execute(
        `SELECT clinica_id FROM medicos WHERE id = ? LIMIT 1`,
        [medicoId]
    );
    return row?.clinica_id ?? null;
}

/** true se paciente e medico/clinica ja compartilham um atendimento. */
async function hasCareRelationship(user, pacienteId) {
    if (user.profile === 'medico') {
        const [[row]] = await pool.execute(
            `SELECT 1 AS ok FROM agendamentos
             WHERE medico_id = ? AND paciente_id = ? LIMIT 1`,
            [Number(user.sub), pacienteId]
        );
        return Boolean(row);
    }

    if (user.profile === 'clinica') {
        const [[row]] = await pool.execute(
            `SELECT 1 AS ok FROM agendamentos
             WHERE clinica_id = ? AND paciente_id = ? LIMIT 1`,
            [Number(user.sub), pacienteId]
        );
        return Boolean(row);
    }

    return false;
}

// POST /api/agendamentos - Criar novo agendamento
router.post("/", agendamentoCreateLimiter, async (req, res, next) => {
    try {
        const parsed = createAgendamentoSchema.safeParse(req.body);

        if (!parsed.success) {
            const errors = parsed.error.flatten().fieldErrors;
            const errorMessages = {};
            for (const [field, messages] of Object.entries(errors)) {
                errorMessages[field] = messages[0];
            }

            return res.status(400).json({ ok: false, message: "Dados invalidos", errors: errorMessages });
        }

        const data = { ...parsed.data };

        // Um paciente so agenda para si mesmo; uma clinica so na propria clinica.
        if (req.user.profile === 'paciente') {
            data.paciente_id = Number(req.user.sub);
            // A clinica vem do profissional escolhido, nunca do corpo da requisicao.
            data.clinica_id = await getDoctorClinicId(data.profissional_id);
            if (!data.clinica_id) {
                return res.status(400).json({ ok: false, message: "Profissional sem clinica vinculada." });
            }
        } else if (req.user.profile === 'clinica') {
            data.clinica_id = Number(req.user.sub);
        } else if (req.user.profile === 'medico') {
            const clinicaId = await getDoctorClinicId(Number(req.user.sub));
            if (!clinicaId) {
                return res.status(400).json({ ok: false, message: "Profissional sem clinica vinculada." });
            }
            data.clinica_id = clinicaId;
            data.profissional_id = Number(req.user.sub);
        } else {
            return res.status(403).json({ ok: false, message: "Perfil nao autorizado a criar agendamentos." });
        }

        const result = await createAgendamento(data);

        if (!result.ok) {
            return res.status(result.statusCode).json({ ok: false, message: result.message });
        }

        return res.status(result.statusCode).json(result);
    } catch (err) {
        next(err);
    }
});

// GET /api/agendamentos/clinica/:clinica_id
router.get("/clinica/:clinica_id", async (req, res, next) => {
    try {
        const clinicaId = parseInt(req.params.clinica_id, 10);
        if (!Number.isInteger(clinicaId) || clinicaId <= 0) {
            return res.status(400).json({ ok: false, message: "ID de clinica invalido" });
        }

        const isOwnClinic = req.user.profile === 'clinica' && Number(req.user.sub) === clinicaId;
        const isClinicDoctor = req.user.profile === 'medico'
            && (await getDoctorClinicId(Number(req.user.sub))) === clinicaId;

        if (!isOwnClinic && !isClinicDoctor) {
            return res.status(403).json({ ok: false, message: "Acesso negado a agenda desta clinica." });
        }

        const { limit, offset } = parsePagination(req);
        const result = await listAgendamentosByClinica(clinicaId, limit, offset);

        if (!result.ok) {
            return res.status(result.statusCode).json({ ok: false, message: result.message });
        }

        return res.status(200).json({ ok: true, data: result.data });
    } catch (err) {
        next(err);
    }
});

// GET /api/agendamentos/profissional/:profissional_id
router.get("/profissional/:profissional_id", async (req, res, next) => {
    try {
        const profissionalId = parseInt(req.params.profissional_id, 10);
        if (!Number.isInteger(profissionalId) || profissionalId <= 0) {
            return res.status(400).json({ ok: false, message: "ID de profissional invalido" });
        }

        const isSelf = req.user.profile === 'medico' && Number(req.user.sub) === profissionalId;
        const isOwningClinic = req.user.profile === 'clinica'
            && (await getDoctorClinicId(profissionalId)) === Number(req.user.sub);

        if (!isSelf && !isOwningClinic) {
            return res.status(403).json({ ok: false, message: "Acesso negado a agenda deste profissional." });
        }

        const { limit, offset } = parsePagination(req);
        const result = await listAgendamentosByProfissional(profissionalId, limit, offset);

        if (!result.ok) {
            return res.status(result.statusCode).json({ ok: false, message: result.message });
        }

        return res.status(200).json({ ok: true, data: result.data });
    } catch (err) {
        next(err);
    }
});

// GET /api/agendamentos/paciente/:paciente_id
router.get("/paciente/:paciente_id", async (req, res, next) => {
    try {
        const pacienteId = parseInt(req.params.paciente_id, 10);
        if (!Number.isInteger(pacienteId) || pacienteId <= 0) {
            return res.status(400).json({ ok: false, message: "ID de paciente invalido" });
        }

        const isSelf = req.user.profile === 'paciente' && Number(req.user.sub) === pacienteId;

        // Medico/clinica so veem o paciente com quem ja tem atendimento.
        if (!isSelf && !(await hasCareRelationship(req.user, pacienteId))) {
            return res.status(403).json({ ok: false, message: "Acesso negado aos agendamentos deste paciente." });
        }

        const { limit, offset } = parsePagination(req);
        const result = await listAgendamentosByPaciente(pacienteId, limit, offset);

        if (!result.ok) {
            return res.status(result.statusCode).json({ ok: false, message: result.message });
        }

        return res.status(200).json({ ok: true, data: result.data });
    } catch (err) {
        next(err);
    }
});

// PUT /api/agendamentos/:id/status
router.put("/:id/status", async (req, res, next) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ ok: false, message: "ID de agendamento invalido" });
        }

        const { status } = req.body;
        if (!status) {
            return res.status(400).json({ ok: false, message: "Status e obrigatorio" });
        }

        const [[appointment]] = await pool.execute(
            `SELECT id, clinica_id, medico_id, paciente_id FROM agendamentos WHERE id = ? LIMIT 1`,
            [id]
        );

        if (!appointment) {
            return res.status(404).json({ ok: false, message: "Agendamento nao encontrado" });
        }

        const userId = Number(req.user.sub);
        const canUpdate =
            (req.user.profile === 'medico' && Number(appointment.medico_id) === userId) ||
            (req.user.profile === 'clinica' && Number(appointment.clinica_id) === userId) ||
            // O paciente so pode cancelar o proprio agendamento.
            (req.user.profile === 'paciente'
                && Number(appointment.paciente_id) === userId
                && String(status).toLowerCase() === 'cancelado');

        if (!canUpdate) {
            return res.status(403).json({ ok: false, message: "Acesso negado a este agendamento." });
        }

        const result = await updateAgendamentoStatus(id, status);

        if (!result.ok) {
            return res.status(result.statusCode).json({ ok: false, message: result.message });
        }

        return res.status(result.statusCode).json(result);
    } catch (err) {
        next(err);
    }
});

export default router;
