// Rotas de autenticacao e area logada (CRM, CNPJ, CPF e e-mail).
import { Router } from "express";
import rateLimit from "express-rate-limit";
// bcrypt e jwt eram usados neste arquivo sem estarem importados: as rotas
// /patient/guardians e /records/authenticate lancavam ReferenceError (500) em
// toda chamada.
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import { env } from "../env.js";
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
  requireProfile,
  getClinicDetails,
  getUserProfile,
  getResponsavelPermissions,
  setGuardianPermissions,
  getAvailablePermissions
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

function validationError(res, parsed) {
  return res.status(400).json({
    message: "Dados invalidos",
    errors: parsed.error.issues
  });
}

/**
 * Localiza um medico por CRM. A versao anterior usava
 * `WHERE REPLACE(UPPER(crm),'CRM','') LIKE '%XXX%'`, que casava por substring:
 * um CRM curto podia selecionar o medico errado e agendar com outro profissional.
 */
async function findDoctorByCRM(rawCRM) {
  const normalized = String(rawCRM || "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase()
    .replace(/^CRM/, "");

  if (!normalized) return null;

  const [rows] = await pool.execute(
    `SELECT id, clinica_id
     FROM medicos
     WHERE REPLACE(UPPER(crm), 'CRM', '') = ?
     LIMIT 1`,
    [normalized]
  );

  return rows[0] || null;
}

// ===========================================================================
// LOGIN / CADASTRO
// ===========================================================================

router.post("/login/universal", loginLimiter, async (req, res, next) => {
  try {
    const parsed = universalLoginSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);

    const result = await loginUniversal(parsed.data);

    if (!result.ok) {
      return res.status(result.statusCode).json({ message: result.message });
    }

    return res.status(200).json(result.data);
  } catch (err) {
    next(err);
  }
});

router.post("/login/responsavel", loginLimiter, async (req, res, next) => {
  try {
    const parsed = universalLoginSchema.safeParse({ ...req.body, expectedProfile: 'responsavel' });
    if (!parsed.success) return validationError(res, parsed);

    const result = await loginUniversal(parsed.data);

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
    if (!parsed.success) return validationError(res, parsed);

    const result = await registerUser({
      identifier: parsed.data.cpf,
      password: parsed.data.password,
      name: parsed.data.name,
      profile: 'paciente',
      userData: {
        email: parsed.data.email,
        tipoDeficiencia: parsed.data.tipoDeficiencia,
        dataNascimento: parsed.data.dataNascimento,
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

router.post("/register/doctor", registerLimiter, async (req, res, next) => {
  try {
    const parsed = registerDoctorSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);

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
    if (!parsed.success) return validationError(res, parsed);

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

router.post("/professional/reset-temporary-password", loginLimiter, async (req, res, next) => {
  try {
    const parsed = resetTemporaryPasswordSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);

    const result = await resetTemporaryProfessionalPassword(parsed.data);

    if (!result.ok) {
      return res.status(result.statusCode).json({ message: result.message });
    }

    return res.status(200).json(result.data);
  } catch (err) {
    next(err);
  }
});

router.post("/password/forgot", loginLimiter, async (req, res, next) => {
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);

    const result = await requestPasswordReset(parsed.data);

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
    if (!parsed.success) return validationError(res, parsed);

    const result = await resetPasswordWithToken(parsed.data);

    if (!result.ok) {
      return res.status(result.statusCode).json({ message: result.message });
    }

    return res.status(200).json({ message: result.message });
  } catch (err) {
    next(err);
  }
});

// ===========================================================================
// PERFIL
// ===========================================================================

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

// ===========================================================================
// PERMISSOES DE RESPONSAVEIS
// ===========================================================================

// Catalogo de permissoes: exige login, mas serve a qualquer perfil (o front do
// paciente monta o formulario de responsavel a partir daqui).
router.get("/permissoes", authenticateToken, async (req, res, next) => {
  try {
    const result = await getAvailablePermissions();

    if (!result.ok) {
      return res.status(result.statusCode).json({ message: result.message });
    }

    return res.status(200).json(result.data);
  } catch (err) {
    next(err);
  }
});

// O responsavel apenas LE as proprias permissoes. Antes ele podia atualiza-las
// (POST /permissoes_responsaveis), o que e escalonamento de privilegio.
router.get(
  "/permissoes_responsaveis",
  authenticateToken,
  requireProfile('responsavel'),
  async (req, res, next) => {
    try {
      const result = await getResponsavelPermissions(Number(req.user.sub));

      if (!result.ok) {
        return res.status(result.statusCode).json({ message: result.message });
      }

      return res.status(200).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

// Quem concede permissao e o paciente, sobre um responsavel vinculado a ele.
router.put(
  "/patient/guardians/:id/permissions",
  authenticateToken,
  requireProfile('paciente'),
  async (req, res, next) => {
    try {
      const responsavelId = Number(req.params.id);

      if (!Number.isInteger(responsavelId) || responsavelId <= 0) {
        return res.status(400).json({ message: 'Responsavel invalido.' });
      }

      const result = await setGuardianPermissions(
        Number(req.user.sub),
        responsavelId,
        req.body?.permissions
      );

      if (!result.ok) {
        return res.status(result.statusCode).json({ message: result.message });
      }

      return res.status(200).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

// ===========================================================================
// CLINICA
// ===========================================================================

router.post(
  "/register/professional",
  authenticateToken,
  requireProfile('clinica'),
  registerLimiter,
  async (req, res, next) => {
    try {
      const clinicResult = await getClinicDetails(req.user.sub);
      if (!clinicResult.ok) {
        return res.status(clinicResult.statusCode).json({ message: clinicResult.message });
      }

      const clinicId = clinicResult.data?.clinicaId ?? Number(req.user.sub);
      const { crm, name, especialidade, bio, password, unidade, email } = req.body;

      if (!crm || !name || !unidade || !password) {
        return res.status(400).json({
          message: "Dados invalidos",
          errors: [{ message: "CRM, nome, unidade e senha sao obrigatorios" }]
        });
      }

      const result = await registerProfessional({
        crm,
        name,
        especialidade,
        clinicaId: clinicId,
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
  }
);

router.get(
  "/clinic/details",
  authenticateToken,
  requireProfile('clinica'),
  async (req, res, next) => {
    try {
      const result = await getClinicDetails(req.user.sub);

      if (!result.ok) {
        return res.status(result.statusCode).json({ message: result.message });
      }

      return res.status(200).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

router.get("/clinic/professionals", authenticateToken, async (req, res, next) => {
  try {
    let clinicId = Number(req.user.sub);

    if (req.user.profile === 'medico') {
      const [[doctor]] = await pool.execute(
        `SELECT clinica_id FROM medicos WHERE id = ? LIMIT 1`,
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
      `SELECT id, name, email, crm, especialidade, unidade, bio, status, created_at AS "createdAt"
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

router.delete(
  "/clinic/professionals/:id",
  authenticateToken,
  requireProfile('clinica'),
  async (req, res, next) => {
    try {
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
         WHERE id = ? AND clinica_id = ?`,
        [professionalId, clinicId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Profissional nao encontrado para esta clinica.' });
      }

      return res.status(200).json({ message: 'Profissional inativado com sucesso.' });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  "/clinic/professionals/:id/activate",
  authenticateToken,
  requireProfile('clinica'),
  async (req, res, next) => {
    try {
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
         WHERE id = ? AND clinica_id = ?`,
        [professionalId, clinicId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Profissional nao encontrado para esta clinica.' });
      }

      return res.status(200).json({ message: 'Profissional reativado com sucesso.' });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/clinic/dashboard-summary",
  authenticateToken,
  requireProfile('clinica'),
  async (req, res, next) => {
    try {
      const clinicaId = Number(req.user.sub);

      const [[professionalStats]] = await pool.execute(
        `SELECT
           COUNT(*) AS "activeEmployees",
           SUM(CASE WHEN LOWER(status) = 'trabalhando' THEN 1 ELSE 0 END) AS "workingEmployees",
           SUM(CASE WHEN LOWER(status) IN ('ferias', 'férias', 'folga', 'licenca', 'licença') THEN 1 ELSE 0 END) AS "breakEmployees"
         FROM medicos
         WHERE clinica_id = ?
           AND LOWER(status) IN ('active', 'ativo', 'trabalhando', 'ferias', 'férias', 'folga', 'licenca', 'licença')`,
        [clinicaId]
      );

      const [[appointmentStats]] = await pool.execute(
        `SELECT
           SUM(CASE WHEN data_agendamento >= NOW() AND status <> 'cancelado' THEN 1 ELSE 0 END) AS "upcomingAppointments",
           SUM(CASE WHEN status = 'pendente' THEN 1 ELSE 0 END) AS "pendingRequests"
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
  }
);

// ===========================================================================
// DIRETORIO DE PROFISSIONAIS
// ===========================================================================

// Lista publica para agendamento: apenas dados profissionais, sem e-mail.
// Antes /professional e /professionals (rotas duplicadas e identicas) expunham
// o e-mail de todos os medicos a qualquer usuario autenticado.
const PUBLIC_DOCTOR_COLUMNS = `id, name, crm, especialidade, unidade, bio, status`;

async function listAvailableDoctors(res, next) {
  try {
    const [rows] = await pool.execute(
      `SELECT ${PUBLIC_DOCTOR_COLUMNS}
       FROM medicos
       WHERE LOWER(status) IN ('active', 'ativo', 'trabalhando')
       ORDER BY name ASC`
    );

    return res.status(200).json(rows);
  } catch (err) {
    return next(err);
  }
}

router.get("/doctors/available", (req, res, next) => listAvailableDoctors(res, next));
router.get("/professionals", authenticateToken, (req, res, next) => listAvailableDoctors(res, next));

// ===========================================================================
// AGENDAMENTOS DO PACIENTE
// ===========================================================================

router.get(
  "/patient/appointments",
  authenticateToken,
  requireProfile('paciente'),
  async (req, res, next) => {
    try {
      const [rows] = await pool.execute(
        `SELECT
           a.id,
           a.data_agendamento AS "appointmentDate",
           a.status,
           m.id AS "doctorId",
           m.name AS "doctorName",
           m.especialidade AS specialty,
           m.unidade AS unit,
           c.nome AS "clinicName"
         FROM agendamentos a
         INNER JOIN medicos m ON a.medico_id = m.id
         INNER JOIN clinicas c ON a.clinica_id = c.id
         WHERE a.paciente_id = ?
           AND a.status <> 'cancelado'
         ORDER BY a.data_agendamento ASC`,
        [Number(req.user.sub)]
      );

      return res.status(200).json(rows);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/patient/appointments",
  authenticateToken,
  requireProfile('paciente'),
  async (req, res, next) => {
    try {
      const { med_crm, date } = req.body;
      if (!med_crm || !date) {
        return res.status(400).json({ message: 'med_crm e date sao obrigatorios.' });
      }

      const rawDate = String(date).trim();
      const appointmentDate = rawDate.length === 10 ? `${rawDate} 00:00:00` : rawDate;
      if (Number.isNaN(new Date(appointmentDate).getTime())) {
        return res.status(400).json({ message: 'Date invalido. Use formato YYYY-MM-DD ou YYYY-MM-DD HH:MM:SS.' });
      }

      const medico = await findDoctorByCRM(med_crm);
      if (!medico) {
        return res.status(404).json({ message: 'Profissional nao encontrado.' });
      }

      if (medico.clinica_id == null) {
        return res.status(400).json({ message: 'Profissional nao vinculado a nenhuma clinica. Atualize o cadastro do medico antes de agendar.' });
      }

      const [insertResult] = await pool.execute(
        `INSERT INTO agendamentos (clinica_id, paciente_id, medico_id, data_agendamento, status)
         VALUES (?, ?, ?, ?, 'pendente') RETURNING id`,
        [medico.clinica_id, Number(req.user.sub), medico.id, appointmentDate]
      );

      const createdId = insertResult.rows?.[0]?.id ?? insertResult.insertId;
      if (!createdId) {
        return res.status(500).json({ message: 'Nao foi possivel criar o agendamento no banco de dados.' });
      }

      const [rows] = await pool.execute(
        `SELECT a.id, a.data_agendamento AS "appointmentDate", a.status,
                m.id AS "doctorId", m.name AS "doctorName", m.especialidade AS specialty,
                m.unidade AS unit, c.nome AS "clinicName"
         FROM agendamentos a
         INNER JOIN medicos m ON a.medico_id = m.id
         INNER JOIN clinicas c ON a.clinica_id = c.id
         WHERE a.id = ? LIMIT 1`,
        [createdId]
      );

      return res.status(201).json(rows[0] || null);
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  "/patient/appointments/:id",
  authenticateToken,
  requireProfile('paciente'),
  async (req, res, next) => {
    try {
      const appointmentId = Number(req.params.id);
      if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
        return res.status(400).json({ message: 'ID de agendamento invalido.' });
      }

      const { med_crm, date } = req.body;
      if (!date) {
        return res.status(400).json({ message: 'Date e obrigatorio para remarcar.' });
      }

      const rawDate = String(date).trim();
      const appointmentDate = rawDate.length === 10 ? `${rawDate} 00:00:00` : rawDate;
      if (Number.isNaN(new Date(appointmentDate).getTime())) {
        return res.status(400).json({ message: 'Date invalido. Use formato YYYY-MM-DD ou YYYY-MM-DD HH:MM:SS.' });
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const compareDate = new Date(appointmentDate);
      compareDate.setHours(0, 0, 0, 0);
      if (compareDate < today) {
        return res.status(400).json({ message: 'Nao e possivel remarcar para uma data passada.' });
      }

      const [[existing]] = await pool.execute(
        `SELECT id, paciente_id, status FROM agendamentos WHERE id = ? LIMIT 1`,
        [appointmentId]
      );

      if (!existing) {
        return res.status(404).json({ message: 'Agendamento nao encontrado.' });
      }

      if (Number(existing.paciente_id) !== Number(req.user.sub)) {
        return res.status(403).json({ message: 'Acesso negado. Este agendamento nao pertence ao paciente autenticado.' });
      }

      if (String(existing.status).toLowerCase() === 'cancelado') {
        return res.status(400).json({ message: 'Agendamento ja cancelado.' });
      }

      if (med_crm) {
        const medico = await findDoctorByCRM(med_crm);
        if (!medico) {
          return res.status(404).json({ message: 'Profissional nao encontrado para o med_crm fornecido.' });
        }

        await pool.execute(
          `UPDATE agendamentos SET medico_id = ?, clinica_id = ?, data_agendamento = ? WHERE id = ?`,
          [medico.id, medico.clinica_id, appointmentDate, appointmentId]
        );
      } else {
        await pool.execute(
          `UPDATE agendamentos SET data_agendamento = ? WHERE id = ?`,
          [appointmentDate, appointmentId]
        );
      }

      const [rows] = await pool.execute(
        `SELECT a.id, a.data_agendamento AS "appointmentDate", a.status,
                m.id AS "doctorId", m.name AS "doctorName", m.especialidade AS specialty,
                m.unidade AS unit, c.nome AS "clinicName"
         FROM agendamentos a
         INNER JOIN medicos m ON a.medico_id = m.id
         INNER JOIN clinicas c ON a.clinica_id = c.id
         WHERE a.id = ? LIMIT 1`,
        [appointmentId]
      );

      return res.status(200).json(rows[0] || null);
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  "/patient/appointments/:id",
  authenticateToken,
  requireProfile('paciente'),
  async (req, res, next) => {
    try {
      const appointmentId = Number(req.params.id);
      if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
        return res.status(400).json({ message: 'ID de agendamento invalido.' });
      }

      const [[existing]] = await pool.execute(
        `SELECT id, paciente_id, status, data_agendamento FROM agendamentos WHERE id = ? LIMIT 1`,
        [appointmentId]
      );

      if (!existing) {
        return res.status(404).json({ message: 'Agendamento nao encontrado.' });
      }

      if (Number(existing.paciente_id) !== Number(req.user.sub)) {
        return res.status(403).json({ message: 'Acesso negado. Este agendamento nao pertence ao paciente autenticado.' });
      }

      if (String(existing.status).toLowerCase() === 'cancelado') {
        return res.status(400).json({ message: 'Agendamento ja cancelado.' });
      }

      if (existing.data_agendamento) {
        const apptDate = new Date(existing.data_agendamento);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diffInDays = Math.ceil((apptDate.getTime() - today.getTime()) / (1000 * 3600 * 24));
        if (diffInDays < 14) {
          return res.status(400).json({ message: 'Cancelamentos devem ser feitos com no minimo 2 semanas de antecedencia.' });
        }
      }

      await pool.execute(
        `UPDATE agendamentos SET status = 'cancelado' WHERE id = ?`,
        [appointmentId]
      );

      return res.status(200).json({ message: 'Agendamento cancelado com sucesso.' });
    } catch (err) {
      next(err);
    }
  }
);

// ===========================================================================
// RESPONSAVEIS DO PACIENTE
// ===========================================================================

router.get(
  "/patient/guardians",
  authenticateToken,
  requireProfile('paciente'),
  async (req, res, next) => {
    try {
      const [rows] = await pool.execute(
        `SELECT r.id, r.nome AS name, r.email, pr.parentesco AS relationship
         FROM paciente_responsavel pr
         INNER JOIN responsavel r ON pr.id_responsavel = r.id
         WHERE pr.id_paciente = ?
         ORDER BY r.nome ASC`,
        [Number(req.user.sub)]
      );

      return res.status(200).json(rows);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/patient/guardians",
  authenticateToken,
  requireProfile('paciente'),
  async (req, res, next) => {
    const conn = await pool.getConnection();

    try {
      const { name, relationship, email, password, permissions } = req.body;
      if (!name || !relationship || !email || !password) {
        return res.status(400).json({ message: 'name, relationship, email e password sao obrigatorios.' });
      }

      await conn.beginTransaction();

      const passwordHash = await bcrypt.hash(String(password), 10);
      const [insertResp] = await conn.execute(
        `INSERT INTO responsavel (nome, email, senha, status) VALUES (?, ?, ?, 1) RETURNING id`,
        [name, email, passwordHash]
      );

      const responsavelId = insertResp.rows?.[0]?.id ?? insertResp.insertId;
      if (!responsavelId) {
        await conn.rollback();
        return res.status(500).json({ message: 'Nao foi possivel criar o responsavel no banco de dados.' });
      }

      const pacienteId = Number(req.user.sub);
      await conn.execute(
        `INSERT INTO paciente_responsavel (id_paciente, id_responsavel, parentesco) VALUES (?, ?, ?)`,
        [pacienteId, responsavelId, relationship]
      );

      await conn.execute(
        `UPDATE pacientes SET id_responsavel = ? WHERE id = ?`,
        [responsavelId, pacienteId]
      );

      const permissionIds = (Array.isArray(permissions) ? permissions : [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0);

      for (const permissionId of permissionIds) {
        await conn.execute(
          `INSERT INTO responsavel_permissoes (id_permissao, id_responsavel)
           VALUES (?, ?) ON CONFLICT DO NOTHING`,
          [permissionId, responsavelId]
        );
      }

      await conn.commit();

      return res.status(201).json({ id: responsavelId, name, email, relationship, permissions: permissionIds });
    } catch (err) {
      await conn.rollback();

      if (err.code === "23505") {
        return res.status(409).json({ message: 'Ja existe um responsavel com esse e-mail.' });
      }

      return next(err);
    } finally {
      conn.release();
    }
  }
);

// ===========================================================================
// ACESSO A PRONTUARIO
// ===========================================================================

/**
 * POST /auth/records/authenticate
 * Reautentica um profissional (CNPJ da clinica + CRM + senha) para liberar
 * acesso aos prontuarios. Emite um token separado (type: records_access) que
 * nao serve como token de sessao.
 */
router.post("/records/authenticate", loginLimiter, async (req, res, next) => {
  try {
    const { cnpj, crm, password } = req.body;

    if (!cnpj || !crm || !password) {
      return res.status(400).json({ message: "CNPJ, CRM e senha sao obrigatorios" });
    }

    const cleanCNPJ = String(cnpj).replace(/\D/g, '');
    if (cleanCNPJ.length !== 14) {
      return res.status(400).json({ message: "CNPJ invalido" });
    }

    const normalizedCRM = String(crm).trim().toUpperCase();
    if (normalizedCRM.length < 4) {
      return res.status(400).json({ message: "CRM invalido" });
    }

    const [doctorRows] = await pool.execute(
      `SELECT m.id, m.name, m.email, m.senha AS password_hash, m.status, m.crm, c.cnpj
       FROM medicos m
       INNER JOIN clinicas c ON m.clinica_id = c.id
       WHERE m.crm = ? AND c.cnpj = ? LIMIT 1`,
      [normalizedCRM, cleanCNPJ]
    );

    const genericError = { message: "Credenciais invalidas. Verifique CNPJ, CRM e tente novamente." };

    if (doctorRows.length === 0) {
      return res.status(401).json(genericError);
    }

    const doctor = doctorRows[0];

    if (!['active', 'ativo', 'trabalhando'].includes(String(doctor.status || '').toLowerCase())) {
      return res.status(403).json({ message: "Sua conta esta desativada. Entre em contato com o administrador." });
    }

    const passwordMatch = await bcrypt.compare(password, doctor.password_hash);
    if (!passwordMatch) {
      return res.status(401).json(genericError);
    }

    const token = jwt.sign(
      {
        sub: String(doctor.id),
        profile: 'medico',
        crm: doctor.crm,
        cnpj: doctor.cnpj,
        type: 'records_access'
      },
      env.JWT_SECRET,
      { expiresIn: '4h' }
    );

    return res.status(200).json({
      message: "Autenticado com sucesso",
      token,
      user: {
        name: doctor.name,
        crm: doctor.crm,
        profile: 'medico'
      }
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
