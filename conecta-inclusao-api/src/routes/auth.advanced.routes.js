// Rotas avançadas de autenticação com suporte a CRM, CNPJ e CPF
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../db.js";
import {
  universalLoginSchema,
  registerPatientSchema,
  registerDoctorSchema,
  registerClinicSchema,
  resetTemporaryPasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema
} from "../validators/auth.advanced.validators.js";
import {
  loginUniversal,
  registerUser,
  registerProfessional,
  resetTemporaryProfessionalPassword,
  requestPasswordReset,
  resetPasswordWithToken,
  authenticateToken,
  getClinicDetails,
  getUserProfile
} from "../services/auth.advanced.service.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false
});

router.post("/login/universal", loginLimiter, async (req, res, next) => {
  try {
    const parsed = universalLoginSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: "Dados invalidos",
        errors: parsed.error.errors
      });
    }

    const result = await loginUniversal(parsed.data);

    if (!result.ok) {
      return res.status(result.statusCode).json({ message: result.message });
    }

    return res.status(200).json(result.data);
  } catch (err) {
    next(err);
  }
});

router.post("/professional/reset-temporary-password", loginLimiter, async (req, res, next) => {
  try {
    const parsed = resetTemporaryPasswordSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: "Dados invalidos",
        errors: parsed.error.errors
      });
    }

    const result = await resetTemporaryProfessionalPassword(parsed.data);

    if (!result.ok) {
      return res.status(result.statusCode).json({ message: result.message });
    }

    return res.status(200).json(result.data);
  } catch (err) {
    next(err);
  }
});

router.get("/profile", authenticateToken, async (req, res, next) => {
  try {
    const result = await getUserProfile(req.user);

    if (!result.ok) {
      return res.status(result.statusCode).json({ message: result.message });
    }

    return res.status(200).json(result.data);
  } catch (err) {
    next(err);
  }
});

router.post("/register/patient", registerLimiter, async (req, res, next) => {
  try {
    const parsed = registerPatientSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: "Dados invalidos",
        errors: parsed.error.errors
      });
    }

    const result = await registerUser({
      identifier: parsed.data.cpf,
      password: parsed.data.password,
      name: parsed.data.name,
      profile: 'paciente',
      userData: {
        email: parsed.data.email,
        nomeResponsavel: parsed.data.nomeResponsavel,
        tipoDeficiencia: parsed.data.tipoDeficiencia,
        planoAtual: parsed.data.planoAtual,
        dataNascimento: parsed.data.dataNascimento
      }
    });

    if (!result.ok) {
      return res.status(result.statusCode).json({ message: result.message });
    }

    return res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/register/doctor", registerLimiter, async (req, res, next) => {
  try {
    const parsed = registerDoctorSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: "Dados invalidos",
        errors: parsed.error.errors
      });
    }

    const result = await registerUser({
      identifier: parsed.data.crm,
      password: parsed.data.password,
      name: parsed.data.name,
      profile: 'medico',
      userData: {
        email: parsed.data.email,
        especialidade: parsed.data.especialidade,
        bio: parsed.data.bio,
        unidade: parsed.data.unidade,
        clinicaId: parsed.data.clinicaId
      }
    });

    if (!result.ok) {
      return res.status(result.statusCode).json({ message: result.message });
    }

    return res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/register/clinic", registerLimiter, async (req, res, next) => {
  try {
    const parsed = registerClinicSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: "Dados invalidos",
        errors: parsed.error.errors
      });
    }

    const result = await registerUser({
      identifier: parsed.data.cnpj,
      password: parsed.data.password,
      name: parsed.data.name,
      profile: 'clinica',
      userData: {
        email: parsed.data.email,
        razaoSocial: parsed.data.razaoSocial,
        endereco: parsed.data.endereco,
        cidade: parsed.data.cidade,
        estado: parsed.data.estado,
        cep: parsed.data.cep,
        telefone: parsed.data.telefone,
        responsavel: parsed.data.responsavel
      }
    });

    if (!result.ok) {
      return res.status(result.statusCode).json({ message: result.message });
    }

    return res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/register/professional", authenticateToken, registerLimiter, async (req, res, next) => {
  try {
    if (req.user.profile !== 'clinica') {
      return res.status(403).json({ message: 'Acesso negado. Apenas clinicas podem cadastrar profissionais.' });
    }

    const clinicResult = await getClinicDetails(req.user.sub);
    if (!clinicResult.ok) {
      return res.status(clinicResult.statusCode).json({ message: clinicResult.message });
    }

    const { crm, name, especialidade, bio, password, unidade, email } = req.body;

    if (!crm || !name) {
      return res.status(400).json({
        message: "Dados invalidos",
        errors: [{ message: "CRM e nome sao obrigatorios" }]
      });
    }

    const result = await registerProfessional({
      crm,
      name,
      especialidade,
      clinicaId: clinicResult.data.clinicaId,
      bio,
      password,
      unidade,
      email
    });

    if (!result.ok) {
      return res.status(result.statusCode).json({ message: result.message });
    }

    return res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/password/forgot", loginLimiter, async (req, res, next) => {
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: "Dados invalidos",
        errors: parsed.error.errors
      });
    }

    const result = await requestPasswordReset(parsed.data);

    if (!result.ok) {
      return res.status(result.statusCode).json({ message: result.message });
    }

    return res.status(200).json({
      message: result.message,
      email: result.data.email
    });
  } catch (err) {
    next(err);
  }
});

router.post("/password/reset", loginLimiter, async (req, res, next) => {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: "Dados invalidos",
        errors: parsed.error.errors
      });
    }

    const result = await resetPasswordWithToken(parsed.data);

    if (!result.ok) {
      return res.status(result.statusCode).json({ message: result.message });
    }

    return res.status(200).json({ message: result.message });
  } catch (err) {
    next(err);
  }
});

router.get("/clinic/professionals", authenticateToken, async (req, res, next) => {
  try {
    let clinicId = req.user.sub;

    if (req.user.profile === 'medico') {
      const [[doctor]] = await pool.execute(
        `SELECT clinica_id
         FROM medicos
         WHERE id = ? LIMIT 1`,
        [req.user.sub]
      );

      clinicId = doctor?.clinica_id;
    } else if (req.user.profile !== 'clinica') {
      return res.status(403).json({ message: 'Acesso negado.' });
    }

    if (!clinicId) {
      return res.status(404).json({ message: 'Clinica do profissional nao encontrada.' });
    }

    const [rows] = await pool.execute(
      `SELECT id, name, email, crm, especialidade, unidade, bio, status, created_at AS createdAt
       FROM medicos
       WHERE clinica_id = ?
       ORDER BY name ASC`,
      [clinicId]
    );

    return res.status(200).json(rows);
  } catch (err) {
    next(err);
  }
});

router.delete("/clinic/professionals/:id", authenticateToken, async (req, res, next) => {
  try {
    if (req.user.profile !== 'clinica') {
      return res.status(403).json({ message: 'Acesso negado. Apenas clinicas podem inativar profissionais.' });
    }

    const professionalId = Number(req.params.id);
    const clinicId = Number(req.user.sub);

    if (!Number.isInteger(professionalId) || professionalId <= 0) {
      return res.status(400).json({ message: 'Profissional invalido.' });
    }

    const [result] = await pool.execute(
      `UPDATE medicos
       SET status = 'inativo',
           failed_attempts = 0,
           locked_until = NULL,
           temporary_password_token = NULL,
           temporary_password_expires_at = NULL,
           password_reset_token = NULL,
           password_reset_expires_at = NULL
       WHERE id = ?
         AND clinica_id = ?`,
      [professionalId, clinicId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Profissional nao encontrado para esta clinica.' });
    }

    return res.status(200).json({ message: 'Profissional inativado com sucesso.' });
  } catch (err) {
    next(err);
  }
});

// Reativar profissional (undo soft delete)
router.put("/clinic/professionals/:id/activate", authenticateToken, async (req, res, next) => {
  try {
    if (req.user.profile !== 'clinica') {
      return res.status(403).json({ message: 'Acesso negado. Apenas clinicas podem reativar profissionais.' });
    }

    const professionalId = Number(req.params.id);
    const clinicId = Number(req.user.sub);

    if (!Number.isInteger(professionalId) || professionalId <= 0) {
      return res.status(400).json({ message: 'Profissional invalido.' });
    }

    const [result] = await pool.execute(
      `UPDATE medicos
       SET status = 'ativo',
           failed_attempts = 0,
           locked_until = NULL,
           temporary_password_token = NULL,
           temporary_password_expires_at = NULL,
           password_reset_token = NULL,
           password_reset_expires_at = NULL
       WHERE id = ?
         AND clinica_id = ?`,
      [professionalId, clinicId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Profissional nao encontrado para esta clinica.' });
    }

    return res.status(200).json({ message: 'Profissional reativado com sucesso.' });
  } catch (err) {
    next(err);
  }
});

router.get("/clinic/dashboard-summary", authenticateToken, async (req, res, next) => {
  try {
    if (req.user.profile !== 'clinica') {
      return res.status(403).json({ message: 'Acesso negado. Apenas clinicas podem acessar o resumo.' });
    }

    const clinicaId = Number(req.user.sub);

    const [[professionalStats]] = await pool.execute(
      `SELECT
         COUNT(*) AS activeEmployees,
         SUM(CASE WHEN LOWER(status) = 'trabalhando' THEN 1 ELSE 0 END) AS workingEmployees,
         SUM(CASE WHEN LOWER(status) IN ('ferias', 'férias', 'folga', 'licenca', 'licença') THEN 1 ELSE 0 END) AS breakEmployees
       FROM medicos
       WHERE clinica_id = ?
         AND LOWER(status) IN ('active', 'ativo', 'trabalhando', 'ferias', 'férias', 'folga', 'licenca', 'licença')`,
      [clinicaId]
    );

    const [[appointmentStats]] = await pool.execute(
      `SELECT
         SUM(CASE WHEN data_agendamento >= NOW() AND status <> 'cancelado' THEN 1 ELSE 0 END) AS upcomingAppointments,
         SUM(CASE WHEN status = 'pendente' THEN 1 ELSE 0 END) AS pendingRequests
       FROM agendamentos
       WHERE clinica_id = ?`,
      [clinicaId]
    );

    return res.status(200).json({
      activeEmployees: Number(professionalStats.activeEmployees || 0),
      workingEmployees: Number(professionalStats.workingEmployees || 0),
      breakEmployees: Number(professionalStats.breakEmployees || 0),
      upcomingAppointments: Number(appointmentStats.upcomingAppointments || 0),
      pendingRequests: Number(appointmentStats.pendingRequests || 0),
      documentsToValidate: 0
    });
  } catch (err) {
    next(err);
  }
});

// Endpoint de acesso a registros removido.
router.get("/clinic/details", authenticateToken, async (req, res, next) => {
  try {
    if (req.user.profile !== 'clinica') {
      return res.status(403).json({ message: 'Acesso negado. Apenas clínicas podem acessar este endpoint.' });
    }

    const result = await getClinicDetails(req.user.sub);

    if (!result.ok) {
      return res.status(result.statusCode).json({ message: result.message });
    }

    return res.status(200).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /auth/doctors/available - Listar médicos disponíveis para agendamento (sem autenticação)
router.get("/doctors/available", async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, name, crm, especialidade, unidade, bio, status
       FROM medicos
       WHERE LOWER(status) IN ('active', 'ativo', 'trabalhando')
       ORDER BY name ASC`
    );

    return res.status(200).json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
