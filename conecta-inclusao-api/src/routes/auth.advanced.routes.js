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

router.get("/professional", authenticateToken, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, name, email, crm, especialidade, unidade, bio, status, clinica_id
       FROM medicos
       WHERE LOWER(status) IN ('active', 'ativo', 'trabalhando')
       ORDER BY name ASC`
    );

    return res.status(200).json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/professionals", authenticateToken, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, name, email, crm, especialidade, unidade, bio, status, clinica_id
       FROM medicos
       WHERE LOWER(status) IN ('active', 'ativo', 'trabalhando')
       ORDER BY name ASC`
    );

    return res.status(200).json(rows);
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

router.get("/patient/appointments", authenticateToken, async (req, res, next) => {
  try {
    if (req.user.profile !== 'paciente') {
      return res.status(403).json({ message: 'Acesso negado. Apenas pacientes podem ver seus agendamentos.' });
    }

    const patientId = Number(req.user.sub);
    const [rows] = await pool.execute(
      `SELECT
         a.id,
         a.data_agendamento AS appointmentDate,
         a.status,
         m.name AS doctorName,
         m.especialidade AS specialty,
         m.unidade AS unit,
         c.nome AS clinicName
       FROM agendamentos a
       INNER JOIN medicos m ON a.medico_id = m.id
       INNER JOIN clinicas c ON a.clinica_id = c.id
       WHERE a.paciente_id = ?
         AND a.status <> 'cancelado'
       ORDER BY a.data_agendamento ASC`,
      [patientId]
    );

    return res.status(200).json(rows);
  } catch (err) {
    next(err);
  }
});

router.delete("/patient/appointments/:id", authenticateToken, async (req, res, next) => {
  try {
    if (req.user.profile !== 'paciente') {
      return res.status(403).json({ message: 'Acesso negado. Apenas pacientes podem cancelar seus agendamentos.' });
    }

    const appointmentId = Number(req.params.id);
    if (!appointmentId || Number.isNaN(appointmentId)) {
      return res.status(400).json({ message: 'ID de agendamento inválido.' });
    }

    const patientId = Number(req.user.sub);
    const [[existing]] = await pool.execute(
      `SELECT id, paciente_id, status, data_agendamento FROM agendamentos WHERE id = ? LIMIT 1`,
      [appointmentId]
    );

    if (!existing) {
      return res.status(404).json({ message: 'Agendamento nao encontrado.' });
    }

    if (Number(existing.paciente_id) !== patientId) {
      return res.status(403).json({ message: 'Acesso negado. Este agendamento nao pertence ao paciente autenticado.' });
    }

    if (String(existing.status).toLowerCase() === 'cancelado') {
      return res.status(400).json({ message: 'Agendamento ja cancelado.' });
    }

    // Verificar prazo minimo de 14 dias para cancelamento
    if (existing && existing.data_agendamento) {
      const apptDate = new Date(existing.data_agendamento);
      const today = new Date();
      today.setHours(0,0,0,0);
      const diffInTime = apptDate.getTime() - today.getTime();
      const diffInDays = Math.ceil(diffInTime / (1000 * 3600 * 24));
      if (diffInDays < 14) {
        return res.status(400).json({ message: 'Cancelamentos devem ser feitos com no mínimo 2 semanas de antecedência.' });
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
});

router.post("/patient/appointments", authenticateToken, async (req, res, next) => {
  try {
    if (req.user.profile !== 'paciente') {
      return res.status(403).json({ message: 'Acesso negado. Apenas pacientes podem criar agendamentos.' });
    }

    const { med_crm, date } = req.body;
    if (!med_crm || !date) {
      return res.status(400).json({ message: 'med_crm e date sao obrigatorios.' });
    }

    const rawDate = String(date).trim();
    const appointmentDate = rawDate.length === 10 ? `${rawDate} 00:00:00` : rawDate;
    if (Number.isNaN(new Date(appointmentDate).getTime())) {
      return res.status(400).json({ message: 'Date inválido. Use formato YYYY-MM-DD ou YYYY-MM-DD HH:MM:SS.' });
    }

    // Normalizar CRM
    const normalizedCRM = String(med_crm).replace(/[^A-Z0-9]/gi, '').toUpperCase();

    const [[medRows]] = await pool.execute(
      `SELECT id, clinica_id FROM medicos WHERE REPLACE(UPPER(crm), 'CRM', '') LIKE ? LIMIT 1`,
      [`%${normalizedCRM.replace(/^CRM/, '')}%`]
    );

    const medico = medRows || null;
    if (!medico || !medico.id) {
      return res.status(404).json({ message: 'Profissional nao encontrado.' });
    }

    const pacienteId = Number(req.user.sub);
    const clinicaId = medico.clinica_id;

    if (clinicaId == null) {
      return res.status(400).json({ message: 'Profissional não vinculado a nenhuma clínica. Atualize o cadastro do médico antes de agendar.' });
    }

    const [insertResult] = await pool.execute(
      `INSERT INTO agendamentos (clinica_id, paciente_id, medico_id, data_agendamento, status)
       VALUES (?, ?, ?, ?, 'pendente')`,
      [clinicaId, pacienteId, medico.id, appointmentDate]
    );

    const createdId = insertResult.insertId;
    if (!createdId) {
      return res.status(500).json({ message: 'Nao foi possivel criar o agendamento no banco de dados.' });
    }

    const [rows] = await pool.execute(
      `SELECT a.id, a.data_agendamento AS appointmentDate, a.status, m.name AS doctorName, m.especialidade AS specialty, m.unidade AS unit, c.nome AS clinicName
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
});

// Criar responsável e vincular ao paciente
router.post("/patient/guardians", authenticateToken, async (req, res, next) => {
  try {
    if (req.user.profile !== 'paciente') {
      return res.status(403).json({ message: 'Acesso negado. Apenas pacientes podem adicionar responsáveis.' });
    }

    const { name, relationship, email, password } = req.body;
    if (!name || !relationship || !email || !password) {
      return res.status(400).json({ message: 'name, relationship, email e password sao obrigatorios.' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Inserir na tabela responsavel
      const passwordHash = await bcrypt.hash(String(password), 10);
      const [insertResp] = await conn.execute(
        `INSERT INTO responsavel (nome, email, senha) VALUES (?, ?, ?)`,
        [name, email, passwordHash]
      );
      console.log("Resultado da inserção do responsável:", insertResp);

      const responsavelId = insertResp.insertId;
      console.log("Responsavel criado com ID:", responsavelId);
      if (!responsavelId) {
        await conn.rollback();
        return res.status(500).json({ message: 'Nao foi possivel criar o responsavel no banco de dados.' });
      }

      // Vincular paciente e responsavel na tabela paciente_responsavel
      const pacienteId = Number(req.user.sub);
      await conn.execute(
        `INSERT INTO paciente_responsavel (id_paciente, id_responsavel, parentesco) VALUES (?, ?, ?)`,
        [pacienteId, responsavelId, relationship]
      );

      await conn.commit();

      return res.status(201).json({ id: responsavelId, name, email, relationship });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    next(err);
  }
});

router.get("/patient/guardians", authenticateToken, async (req, res, next) => {
  try {
    if (req.user.profile !== 'paciente') {
      return res.status(403).json({ message: 'Acesso negado. Apenas pacientes podem listar responsáveis.' });
    }

    const pacienteId = Number(req.user.sub);
    const [rows] = await pool.execute(
      `SELECT r.id, r.nome AS name, r.email, pr.parentesco AS relationship
       FROM paciente_responsavel pr
       INNER JOIN responsavel r ON pr.id_responsavel = r.id
       WHERE pr.id_paciente = ?`,
      [pacienteId]
    );

    return res.status(200).json(rows || []);
  } catch (err) {
    next(err);
  }
});

// Atualizar (remarcar) um agendamento existente
router.put("/patient/appointments/:id", authenticateToken, async (req, res, next) => {
  try {
    if (req.user.profile !== 'paciente') {
      return res.status(403).json({ message: 'Acesso negado. Apenas pacientes podem remarcar seus agendamentos.' });
    }

    const appointmentId = Number(req.params.id);
    if (!appointmentId || Number.isNaN(appointmentId)) {
      return res.status(400).json({ message: 'ID de agendamento inválido.' });
    }

    const { med_crm, date } = req.body;
    if (!date) {
      return res.status(400).json({ message: 'Date é obrigatório para remarcar.' });
    }

    const rawDate = String(date).trim();
    const appointmentDate = rawDate.length === 10 ? `${rawDate} 00:00:00` : rawDate;
    if (Number.isNaN(new Date(appointmentDate).getTime())) {
      return res.status(400).json({ message: 'Date inválido. Use formato YYYY-MM-DD ou YYYY-MM-DD HH:MM:SS.' });
    }

    // Não permitir remarcar para data no passado
    const newDateObj = new Date(appointmentDate);
    const today = new Date();
    today.setHours(0,0,0,0);
    const compareDate = new Date(newDateObj);
    compareDate.setHours(0,0,0,0);
    if (compareDate < today) {
      return res.status(400).json({ message: 'Nao é possivel remarcar para uma data passada.' });
    }

    const patientId = Number(req.user.sub);
    const [[existing]] = await pool.execute(
      `SELECT id, paciente_id, status FROM agendamentos WHERE id = ? LIMIT 1`,
      [appointmentId]
    );

    if (!existing) {
      return res.status(404).json({ message: 'Agendamento nao encontrado.' });
    }

    if (Number(existing.paciente_id) !== patientId) {
      return res.status(403).json({ message: 'Acesso negado. Este agendamento nao pertence ao paciente autenticado.' });
    }

    if (String(existing.status).toLowerCase() === 'cancelado') {
      return res.status(400).json({ message: 'Agendamento ja cancelado.' });
    }

    // Se med_crm fornecido, localizar médico e clinica
    let medicoId = null;
    let clinicaId = null;
    if (med_crm) {
      const normalizedCRM = String(med_crm).replace(/[^A-Z0-9]/gi, '').toUpperCase();
      const [[medRows]] = await pool.execute(
        `SELECT id, clinica_id FROM medicos WHERE REPLACE(UPPER(crm), 'CRM', '') LIKE ? LIMIT 1`,
        [`%${normalizedCRM.replace(/^CRM/, '')}%`]
      );
      const medico = medRows || null;
      if (!medico || !medico.id) {
        return res.status(404).json({ message: 'Profissional nao encontrado para o med_crm fornecido.' });
      }
      medicoId = medico.id;
      clinicaId = medico.clinica_id;
    }

    // Montar query de atualização
    if (medicoId) {
      await pool.execute(
        `UPDATE agendamentos SET medico_id = ?, clinica_id = ?, data_agendamento = ? WHERE id = ?`,
        [medicoId, clinicaId, appointmentDate, appointmentId]
      );
    } else {
      await pool.execute(
        `UPDATE agendamentos SET data_agendamento = ? WHERE id = ?`,
        [appointmentDate, appointmentId]
      );
    }

    const [rows] = await pool.execute(
      `SELECT a.id, a.data_agendamento AS appointmentDate, a.status, m.name AS doctorName, m.especialidade AS specialty, m.unidade AS unit, c.nome AS clinicName
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
});

/**
 * POST /auth/records/authenticate
 * Autentica um profissional para acesso aos prontuários
 * Requer CNPJ da clínica, CRM do profissional e senha
 * 
 * Body:
 * {
 *   "cnpj": "12345678000190",
 *   "crm": "ABC1234",
 *   "password": "senha123"
 * }
 */
router.post("/records/authenticate", loginLimiter, async (req, res, next) => {
  try {
    const { cnpj, crm, password } = req.body;
    
    if (!cnpj || !crm || !password) {
      return res.status(400).json({ 
        message: "CNPJ, CRM e senha são obrigatórios"
      });
    }

    // Validar e normalizar CNPJ
    const cleanCNPJ = cnpj.replace(/\D/g, '');
    if (cleanCNPJ.length !== 14) {
      return res.status(400).json({ 
        message: "CNPJ inválido"
      });
    }

    // Validar e normalizar CRM
    const normalizedCRM = crm.trim().toUpperCase();
    if (normalizedCRM.length < 4) {
      return res.status(400).json({ 
        message: "CRM inválido"
      });
    }

    // Verificar se existe um medico com esse CRM, CNPJ e senha
    const [doctorRows] = await pool.execute(
      `SELECT m.id, m.name, m.email, m.senha AS password_hash, 'medico' AS profile,
              m.status, m.crm, c.cnpj
       FROM medicos m
       INNER JOIN clinicas c ON m.clinica_id = c.id
       WHERE m.crm = ? AND c.cnpj = ? LIMIT 1`,
      [normalizedCRM, cleanCNPJ]
    );

    if (doctorRows.length === 0) {
      return res.status(401).json({ 
        message: "Credenciais inválidas. Verifique CNPJ, CRM e tente novamente."
      });
    }

    const doctor = doctorRows[0];

    // Verificar status do usuário
    if (!['ACTIVE', 'ativo'].includes(doctor.status)) {
      return res.status(403).json({ 
        message: "Sua conta está desativada. Entre em contato com o administrador."
      });
    }

    // Validar senha
    const passwordMatch = await bcrypt.compare(password, doctor.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ 
        message: "Credenciais inválidas. Verifique CNPJ, CRM e tente novamente."
      });
    }

    // Gerar token JWT para a sessão
    const token = jwt.sign(
      {
        profileId: doctor.id,
        profile: 'medico',
        crm: doctor.crm,
        cnpj: doctor.cnpj,
        type: 'records_access'
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '4h' }
    );

    return res.status(200).json({
      message: "Autenticado com sucesso",
      token: token,
      user: {
        name: doctor.name,
        crm: doctor.crm,
        profile: doctor.profile
      }
    });

  } catch (error) {
    console.error("Erro em /auth/records/authenticate:", error);
    return res.status(500).json({ 
      message: "Erro interno do servidor"
    });
  }
});
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
