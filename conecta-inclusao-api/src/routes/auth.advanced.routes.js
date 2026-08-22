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
  resetPasswordSchema,
  guardianCreateSchema,
  guardianUpdateSchema,
  updatePatientProfileSchema,
  changePasswordSchema,
  unidadeCreateSchema,
  unidadeUpdateSchema,
  localizacaoSchema,
  registerProfessionalSchema,
  patientAppointmentSchema,
  patientAppointmentUpdateSchema
} from "../validators/auth.advanced.validators.js";
import {
  buscarEnderecoPorCep,
  resolverEndereco
} from "../services/endereco.service.js";
import {
  listarUnidades,
  listarUnidadesPorDistancia,
  criarUnidade,
  atualizarUnidade,
  desativarUnidade,
  garantirUnidadePrincipal,
  buscarUnidade
} from "../services/unidades.service.js";
import {
  listarHorariosDisponiveis,
  horarioDentroDaGrade
} from "../services/agendamentos.service.js";
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
  getAvailablePermissions,
  linkGuardianToPatient,
  requirePatientAccess
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

// Consulta de CEP e geocodificacao batem em servicos publicos de terceiros
// (ViaCEP e Nominatim). O limite protege as duas pontas: evita que a API vire
// um proxy aberto para eles e evita que a gente seja bloqueado por abuso.
const enderecoLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
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

/**
 * Edicao do proprio perfil do paciente. A aba "Meu Perfil" era somente leitura -
 * todos os valores eram <strong> sem formulario nenhum por tras.
 *
 * Cada campo so entra no UPDATE se veio no corpo, para que salvar um campo nao
 * apague os outros. String vazia vira NULL (o paciente limpou o campo);
 * ausencia do campo mantem o valor atual.
 */
router.put(
  "/profile",
  authenticateToken,
  requireProfile('paciente'),
  async (req, res, next) => {
    try {
      const parsed = updatePatientProfileSchema.safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);

      const colunas = [];
      const valores = [];

      const vazioViraNulo = (valor) => {
        const texto = String(valor ?? "").trim();
        return texto === "" ? null : texto;
      };

      const mapa = [
        ["nome_paciente", "name"],
        ["email", "email"],
        ["telefone", "telefone"],
        ["tipo_deficiencia", "tipoDeficiencia"],
        ["unidade_preferencia", "unidadePreferencia"],
        ["data_nascimento", "dataNascimento"]
      ];

      for (const [coluna, campo] of mapa) {
        if (parsed.data[campo] !== undefined) {
          colunas.push(`${coluna} = ?`);
          valores.push(vazioViraNulo(parsed.data[campo]));
        }
      }

      if (!colunas.length) {
        return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
      }

      valores.push(Number(req.user.sub));

      await pool.execute(
        `UPDATE pacientes SET ${colunas.join(', ')} WHERE id = ?`,
        valores
      );

      const result = await getUserProfile(req.user);
      if (!result.ok) {
        return res.status(result.statusCode).json({ message: result.message });
      }

      return res.status(200).json(result.data);
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ message: 'Esse e-mail ja esta em uso por outra conta.' });
      }
      return next(err);
    }
  }
);

/**
 * Troca de senha do paciente logado. Exige a senha atual: sem isso, quem
 * pegasse uma sessao aberta trocaria a senha e trancaria o dono para fora.
 *
 * O fluxo de "esqueci a senha" (deslogado) continua sendo /password/forgot.
 */
router.put(
  "/profile/password",
  authenticateToken,
  requireProfile('paciente'),
  async (req, res, next) => {
    try {
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);

      const [rows] = await pool.execute(
        `SELECT senha AS password_hash FROM pacientes WHERE id = ? LIMIT 1`,
        [Number(req.user.sub)]
      );

      if (!rows.length) {
        return res.status(404).json({ message: 'Paciente nao encontrado.' });
      }

      const confere = await bcrypt.compare(parsed.data.currentPassword, rows[0].password_hash);
      if (!confere) {
        return res.status(400).json({ message: 'Senha atual incorreta.' });
      }

      const novoHash = await bcrypt.hash(parsed.data.newPassword.trim(), 10);
      await pool.execute(
        `UPDATE pacientes SET senha = ? WHERE id = ?`,
        [novoHash, Number(req.user.sub)]
      );

      return res.status(200).json({ message: 'Senha alterada com sucesso.' });
    } catch (err) {
      return next(err);
    }
  }
);

// ===========================================================================
// PERMISSOES DE RESPONSAVEIS
// ===========================================================================

// Catalogo de permissoes: rota publica. O cadastro de paciente monta o mesmo
// formulario de responsavel do dashboard, e nesse momento ainda nao existe
// token para autenticar. O conteudo e uma tabela fixa de apoio ('Ver
// agendamentos', 'Enviar mensagens', 'Gerenciar agendamentos') - nao ha dado de
// usuario aqui, so os rotulos que o formulario precisa exibir.
router.get("/permissoes", async (req, res, next) => {
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
      const parsed = registerProfessionalSchema.safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);

      const clinicResult = await getClinicDetails(req.user.sub);
      if (!clinicResult.ok) {
        return res.status(clinicResult.statusCode).json({ message: clinicResult.message });
      }

      const clinicId = clinicResult.data?.clinicaId ?? Number(req.user.sub);
      const dados = parsed.data;

      // A unidade e resolvida pelo id e conferida contra a clinica logada: sem
      // isso uma clinica poderia vincular seu medico a uma filial de outra.
      let unidade = null;
      if (dados.unidadeId) {
        unidade = await buscarUnidade(clinicId, dados.unidadeId);
        if (!unidade) {
          return res.status(404).json({ message: "Unidade nao encontrada nesta clinica." });
        }
      }

      // Endereco do medico: alimenta a ordenacao por distancia e a UF do CRM.
      // Falha de CEP nao impede o cadastro - o medico entra sem coordenada.
      let endereco = null;
      if (dados.cep || (dados.cidade && dados.estado)) {
        const resolvido = await resolverEndereco({
          cep: dados.cep,
          manual: {
            logradouro: dados.logradouro,
            numero: dados.numero,
            bairro: dados.bairro,
            cidade: dados.cidade,
            estado: dados.estado,
            cep: dados.cep
          }
        });

        if (resolvido.ok) endereco = resolvido.data;
      }

      // Validacao dinamica do CRM, parte do servidor.
      //
      // Quando o endereco chega pelo CEP, o schema nao tem como comparar nada -
      // o corpo so traz o CEP, e a UF so aparece depois da consulta ao ViaCEP.
      // E por isso que a comparacao acontece aqui, e nao la: e o primeiro
      // momento em que os dois valores existem ao mesmo tempo.
      if (endereco?.estado && endereco.estado !== dados.crmUf && dados.crmUfConfirmado !== true) {
        return res.status(400).json({
          message: `O CEP informado e de ${endereco.estado}, mas o CRM foi cadastrado como ${dados.crmUf}. Confirme a UF do conselho antes de continuar.`,
          conflitoDeUf: { enderecoUf: endereco.estado, crmUf: dados.crmUf }
        });
      }

      const result = await registerProfessional({
        crm: dados.crm,
        crmUf: dados.crmUf,
        name: dados.name,
        especialidade: dados.especialidade,
        clinicaId: clinicId,
        bio: dados.bio,
        password: dados.password,
        unidade: unidade?.nome ?? dados.unidade,
        unidadeId: unidade?.id ?? null,
        email: dados.email,
        endereco
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

// ===========================================================================
// UNIDADES (FILIAIS) DA CLINICA
//
// Ate aqui a "unidade" do medico era um texto escolhido numa lista fixa no
// HTML ("Unidade A/B/C"), sem endereco nenhum. Com CEP e coordenada por
// unidade, o cadastro de medico passa a conseguir ordenar as filiais pela
// distancia ate a casa dele.
// ===========================================================================

router.get(
  "/clinic/units",
  authenticateToken,
  async (req, res, next) => {
    try {
      // O medico tambem le a lista (a tela dele mostra a unidade), mas so da
      // propria clinica.
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
        return res.status(404).json({ message: 'Clinica nao encontrada.' });
      }

      // Clinica que nunca cadastrou filial ganha a primeira a partir do proprio
      // endereco - senao a combobox do cadastro de medico nasceria vazia.
      const unidades = req.user.profile === 'clinica'
        ? await garantirUnidadePrincipal(clinicId)
        : await listarUnidades(clinicId, { apenasAtivas: true });

      return res.status(200).json(unidades);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/clinic/units",
  authenticateToken,
  requireProfile('clinica'),
  enderecoLimiter,
  async (req, res, next) => {
    try {
      const parsed = unidadeCreateSchema.safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);

      const result = await criarUnidade(Number(req.user.sub), parsed.data);

      if (!result.ok) {
        return res.status(result.statusCode).json({ message: result.message });
      }

      return res.status(201).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  "/clinic/units/:id",
  authenticateToken,
  requireProfile('clinica'),
  enderecoLimiter,
  async (req, res, next) => {
    try {
      const unidadeId = Number(req.params.id);
      if (!Number.isInteger(unidadeId) || unidadeId <= 0) {
        return res.status(400).json({ message: 'Unidade invalida.' });
      }

      const parsed = unidadeUpdateSchema.safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);

      const result = await atualizarUnidade(Number(req.user.sub), unidadeId, parsed.data);

      if (!result.ok) {
        return res.status(result.statusCode).json({ message: result.message });
      }

      return res.status(200).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  "/clinic/units/:id",
  authenticateToken,
  requireProfile('clinica'),
  async (req, res, next) => {
    try {
      const unidadeId = Number(req.params.id);
      if (!Number.isInteger(unidadeId) || unidadeId <= 0) {
        return res.status(400).json({ message: 'Unidade invalida.' });
      }

      const result = await desativarUnidade(Number(req.user.sub), unidadeId);

      if (!result.ok) {
        return res.status(result.statusCode).json({ message: result.message });
      }

      return res.status(200).json({ message: result.message });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /auth/clinic/units/nearest
 *
 * Recebe o CEP (ou o endereco digitado a mao) do medico, geocodifica pelo
 * Nominatim e devolve as unidades da clinica ordenadas pela distancia ate esse
 * ponto. E POST e nao GET porque o corpo carrega um endereco completo - e
 * porque endereco de pessoa nao deve ficar registrado em log de acesso como
 * query string.
 */
router.post(
  "/clinic/units/nearest",
  authenticateToken,
  requireProfile('clinica'),
  enderecoLimiter,
  async (req, res, next) => {
    try {
      const parsed = localizacaoSchema.safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);

      const clinicId = Number(req.user.sub);

      const endereco = await resolverEndereco({
        cep: parsed.data.cep,
        manual: {
          logradouro: parsed.data.logradouro,
          numero: parsed.data.numero,
          bairro: parsed.data.bairro,
          cidade: parsed.data.cidade,
          estado: parsed.data.estado,
          cep: parsed.data.cep
        }
      });

      if (!endereco.ok) {
        return res.status(endereco.statusCode).json({ message: endereco.message });
      }

      await garantirUnidadePrincipal(clinicId);

      const unidades = await listarUnidadesPorDistancia(clinicId, {
        latitude: endereco.data.latitude,
        longitude: endereco.data.longitude
      });

      return res.status(200).json({
        endereco: endereco.data,
        unidades
      });
    } catch (err) {
      next(err);
    }
  }
);

// ===========================================================================
// CONSULTA DE CEP
//
// Proxy do ViaCEP. Precisa existir no servidor porque a CSP definida em app.js
// so libera `connect-src 'self'`: um fetch do navegador direto para o ViaCEP e
// bloqueado quando o front e servido pela propria API.
// ===========================================================================

router.get("/cep/:cep", enderecoLimiter, async (req, res, next) => {
  try {
    const result = await buscarEnderecoPorCep(req.params.cep);

    if (!result.ok) {
      return res.status(result.statusCode).json({ message: result.message });
    }

    return res.status(200).json(result.data);
  } catch (err) {
    next(err);
  }
});

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
      `SELECT id, name, email, crm, crm_uf AS "crmUf", especialidade,
              unidade, unidade_id AS "unidadeId", cidade, estado,
              bio, status, created_at AS "createdAt"
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
const PUBLIC_DOCTOR_COLUMNS = `id, name, crm, crm_uf AS "crmUf", especialidade, unidade, bio, status`;

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

/**
 * Busca de atendimento com filtros. A aba "Buscar Atendimento" do paciente nao
 * tinha endpoint: o botao Filtrar apenas exibia um popup e a lista abaixo
 * continuava mostrando todos os profissionais, ignorando o que fora escolhido.
 *
 * Todos os filtros sao opcionais e se combinam. `termo` casa nome do
 * profissional, especialidade ou unidade, para a busca livre por texto.
 */
router.get("/doctors/search", async (req, res, next) => {
  try {
    const especialidade = String(req.query.especialidade || "").trim();
    const unidade = String(req.query.unidade || "").trim();
    const termo = String(req.query.termo || "").trim();

    const condicoes = ["LOWER(m.status) IN ('active', 'ativo', 'trabalhando')"];
    const valores = [];

    if (especialidade) {
      condicoes.push("LOWER(m.especialidade) = LOWER(?)");
      valores.push(especialidade);
    }

    if (unidade) {
      condicoes.push("LOWER(m.unidade) = LOWER(?)");
      valores.push(unidade);
    }

    if (termo) {
      condicoes.push("(m.name ILIKE ? OR m.especialidade ILIKE ? OR m.unidade ILIKE ?)");
      const curinga = `%${termo}%`;
      valores.push(curinga, curinga, curinga);
    }

    const [rows] = await pool.execute(
      `SELECT m.id, m.name, m.crm, m.especialidade, m.unidade, m.bio, m.status,
              c.nome AS "clinicName", c.cidade, c.estado
       FROM medicos m
       LEFT JOIN clinicas c ON m.clinica_id = c.id
       WHERE ${condicoes.join(" AND ")}
       ORDER BY m.especialidade ASC, m.name ASC`,
      valores
    );

    return res.status(200).json(rows);
  } catch (err) {
    return next(err);
  }
});

/**
 * Valores distintos para preencher os selects de filtro, sem precisar baixar a
 * lista inteira de profissionais so para extrair especialidades e unidades.
 */
router.get("/doctors/filters", async (req, res, next) => {
  try {
    const [especialidades] = await pool.execute(
      `SELECT DISTINCT especialidade AS valor
       FROM medicos
       WHERE especialidade IS NOT NULL AND TRIM(especialidade) <> ''
         AND LOWER(status) IN ('active', 'ativo', 'trabalhando')
       ORDER BY especialidade ASC`
    );

    const [unidades] = await pool.execute(
      `SELECT DISTINCT unidade AS valor
       FROM medicos
       WHERE unidade IS NOT NULL AND TRIM(unidade) <> ''
         AND LOWER(status) IN ('active', 'ativo', 'trabalhando')
       ORDER BY unidade ASC`
    );

    return res.status(200).json({
      especialidades: especialidades.map((linha) => linha.valor),
      unidades: unidades.map((linha) => linha.valor)
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /auth/doctors/:id/slots?date=YYYY-MM-DD[&ignore=<id do agendamento>]
 *
 * Grade de horarios do medico no dia, de 30 em 30 minutos, marcando o que ja
 * esta ocupado. E o que permite ao modal de agendamento mostrar so o que da
 * para escolher - antes o campo era um <input type="time"> livre, que aceitava
 * 03:47 e horario ja tomado por outro paciente.
 *
 * Exige token (qualquer perfil logado): a resposta revela a ocupacao da agenda
 * de um profissional, ainda que sem dizer de quem e a consulta.
 */
router.get("/doctors/:id/slots", authenticateToken, async (req, res, next) => {
  try {
    const medicoId = Number(req.params.id);
    if (!Number.isInteger(medicoId) || medicoId <= 0) {
      return res.status(400).json({ message: 'Profissional invalido.' });
    }

    const ignorar = Number(req.query.ignore);

    const result = await listarHorariosDisponiveis(medicoId, String(req.query.date || ''), {
      ignorarAgendamentoId: Number.isInteger(ignorar) && ignorar > 0 ? ignorar : null
    });

    if (!result.ok) {
      return res.status(result.statusCode).json({ message: result.message });
    }

    return res.status(200).json(result.data);
  } catch (err) {
    return next(err);
  }
});

// ===========================================================================
// AGENDAMENTOS DO PACIENTE
// ===========================================================================

router.get(
  "/patient/appointments",
  authenticateToken,
  requirePatientAccess('Ver agendamentos'),
  async (req, res, next) => {
    try {
      const [rows] = await pool.execute(
        // data_agendamento e TIMESTAMP sem fuso: o driver pg o converte em Date
        // usando o fuso do processo Node e o res.json() serializa em UTC, o que
        // desloca os digitos da data/hora conforme o offset do servidor. O front
        // le essa string textualmente (split('T')[0]), entao a consulta caia no
        // dia errado do calendario - e, virando o mes, sumia da tela mesmo
        // estando agendada. TO_CHAR devolve a hora de parede como foi gravada.
        `SELECT
           a.id,
           TO_CHAR(a.data_agendamento, 'YYYY-MM-DD"T"HH24:MI:SS') AS "appointmentDate",
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
        [req.patientId]
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
  requirePatientAccess('Gerenciar agendamentos'),
  async (req, res, next) => {
    try {
      const parsed = patientAppointmentSchema.safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);

      const { med_crm, date, time } = parsed.data;

      // O horario existia no formulario mas nunca chegava aqui: a tela mandava
      // so a data e este endpoint completava com 00:00:00. Toda consulta ficava
      // marcada para a meia-noite.
      if (!time) {
        return res.status(400).json({ message: 'Informe o horario da consulta.' });
      }

      if (!horarioDentroDaGrade(time)) {
        return res.status(400).json({ message: 'Horario fora da grade de atendimento (08:00 as 17:30, de 30 em 30 minutos).' });
      }

      const appointmentDate = `${date} ${time}:00`;

      const medico = await findDoctorByCRM(med_crm);
      if (!medico) {
        return res.status(404).json({ message: 'Profissional nao encontrado.' });
      }

      if (medico.clinica_id == null) {
        return res.status(400).json({ message: 'Profissional nao vinculado a nenhuma clinica. Atualize o cadastro do medico antes de agendar.' });
      }

      // A duplicata do proprio paciente e checada ANTES da agenda do medico.
      // As duas situacoes acabam no mesmo 409, mas por motivos diferentes - e
      // "esse horario acabou de ser ocupado" seria enganoso para quem esta
      // apenas repetindo um agendamento que ele mesmo ja fez.
      const [[duplicado]] = await pool.execute(
        `SELECT id FROM agendamentos
         WHERE paciente_id = ? AND medico_id = ? AND data_agendamento = ?
           AND LOWER(status) <> 'cancelado'
         LIMIT 1`,
        [req.patientId, medico.id, appointmentDate]
      );

      if (duplicado) {
        return res.status(409).json({
          message: 'Voce ja tem uma consulta com esse profissional nesse dia e horario.'
        });
      }

      // O horario precisa estar livre na agenda do medico - inclusive quando
      // quem o ocupou foi outro paciente.
      const disponibilidade = await listarHorariosDisponiveis(medico.id, date);
      if (!disponibilidade.ok) {
        return res.status(disponibilidade.statusCode).json({ message: disponibilidade.message });
      }

      const faixa = disponibilidade.data.horarios.find((item) => item.hora === time);
      if (!faixa || !faixa.disponivel) {
        return res.status(409).json({
          message: faixa?.motivo === 'passado'
            ? 'Esse horario ja passou. Escolha outro.'
            : 'Esse horario acabou de ser ocupado. Escolha outro.'
        });
      }

      let createdId;
      try {
        const [insertResult] = await pool.execute(
          `INSERT INTO agendamentos (clinica_id, paciente_id, medico_id, data_agendamento, status)
           VALUES (?, ?, ?, ?, 'pendente') RETURNING id`,
          [medico.clinica_id, req.patientId, medico.id, appointmentDate]
        );

        createdId = insertResult.rows?.[0]?.id ?? insertResult.insertId;
      } catch (erroInsercao) {
        // 23505 vem do indice parcial idx_agendamentos_sem_duplicata. E ele que
        // fecha a janela entre a checagem acima e o INSERT: dois cliques rapidos
        // (ou duas abas) chegavam aqui juntos e criavam a consulta duas vezes.
        if (erroInsercao.code === '23505') {
          return res.status(409).json({
            message: 'Voce ja tem uma consulta com esse profissional nesse dia e horario.'
          });
        }
        throw erroInsercao;
      }

      if (!createdId) {
        return res.status(500).json({ message: 'Nao foi possivel criar o agendamento no banco de dados.' });
      }

      const [rows] = await pool.execute(
        // TO_CHAR pelo mesmo motivo do GET /patient/appointments: manter a hora
        // de parede, sem a conversao para UTC que o pg + res.json() aplicariam.
        `SELECT a.id, TO_CHAR(a.data_agendamento, 'YYYY-MM-DD"T"HH24:MI:SS') AS "appointmentDate", a.status,
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
  requirePatientAccess('Gerenciar agendamentos'),
  async (req, res, next) => {
    try {
      const appointmentId = Number(req.params.id);
      if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
        return res.status(400).json({ message: 'ID de agendamento invalido.' });
      }

      const parsed = patientAppointmentUpdateSchema.safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed);

      const { med_crm, date, time } = parsed.data;

      if (!time) {
        return res.status(400).json({ message: 'Informe o horario da consulta.' });
      }

      if (!horarioDentroDaGrade(time)) {
        return res.status(400).json({ message: 'Horario fora da grade de atendimento (08:00 as 17:30, de 30 em 30 minutos).' });
      }

      const appointmentDate = `${date} ${time}:00`;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const compareDate = new Date(`${date}T00:00:00`);
      if (compareDate < today) {
        return res.status(400).json({ message: 'Nao e possivel remarcar para uma data passada.' });
      }

      const [[existing]] = await pool.execute(
        `SELECT id, paciente_id, medico_id, status FROM agendamentos WHERE id = ? LIMIT 1`,
        [appointmentId]
      );

      if (!existing) {
        return res.status(404).json({ message: 'Agendamento nao encontrado.' });
      }

      if (Number(existing.paciente_id) !== Number(req.patientId)) {
        return res.status(403).json({ message: 'Acesso negado. Este agendamento nao pertence ao paciente autenticado.' });
      }

      if (String(existing.status).toLowerCase() === 'cancelado') {
        return res.status(400).json({ message: 'Agendamento ja cancelado.' });
      }

      const medico = med_crm ? await findDoctorByCRM(med_crm) : null;
      if (med_crm && !medico) {
        return res.status(404).json({ message: 'Profissional nao encontrado para o med_crm fornecido.' });
      }

      const medicoAlvo = medico?.id ?? Number(existing.medico_id);

      // Mesma checagem de agenda da criacao. `ignorarAgendamentoId` mantem o
      // horario atual selecionavel: sem isso a consulta bloquearia a si mesma e
      // remarcar para o mesmo horario com outro medico ficaria impossivel.
      const disponibilidade = await listarHorariosDisponiveis(medicoAlvo, date, {
        ignorarAgendamentoId: appointmentId
      });

      if (!disponibilidade.ok) {
        return res.status(disponibilidade.statusCode).json({ message: disponibilidade.message });
      }

      const faixa = disponibilidade.data.horarios.find((item) => item.hora === time);
      if (!faixa || !faixa.disponivel) {
        return res.status(409).json({
          message: faixa?.motivo === 'passado'
            ? 'Esse horario ja passou. Escolha outro.'
            : 'Esse horario acabou de ser ocupado. Escolha outro.'
        });
      }

      try {
        if (medico) {
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
      } catch (erroAtualizacao) {
        if (erroAtualizacao.code === '23505') {
          return res.status(409).json({
            message: 'Voce ja tem uma consulta com esse profissional nesse dia e horario.'
          });
        }
        throw erroAtualizacao;
      }

      const [rows] = await pool.execute(
        // TO_CHAR pelo mesmo motivo do GET /patient/appointments: manter a hora
        // de parede, sem a conversao para UTC que o pg + res.json() aplicariam.
        `SELECT a.id, TO_CHAR(a.data_agendamento, 'YYYY-MM-DD"T"HH24:MI:SS') AS "appointmentDate", a.status,
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
  requirePatientAccess('Gerenciar agendamentos'),
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

      if (Number(existing.paciente_id) !== Number(req.patientId)) {
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
      // As permissoes vinham faltando aqui: eram gravadas no cadastro, mas a
      // listagem nao as devolvia, entao o card do dashboard nunca tinha o que
      // exibir. O agregado traz os ids e os nomes ja resolvidos.
      const [rows] = await pool.execute(
        `SELECT r.id,
                r.nome AS name,
                r.email,
                r.cpf,
                pr.parentesco AS relationship,
                COALESCE(
                  ARRAY_AGG(p.id ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL),
                  '{}'::int[]
                ) AS "permissionIds",
                COALESCE(
                  ARRAY_AGG(p.nome ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL),
                  '{}'::text[]
                ) AS "permissionNames"
         FROM paciente_responsavel pr
         INNER JOIN responsavel r ON pr.id_responsavel = r.id
         LEFT JOIN responsavel_permissoes rp ON rp.id_responsavel = r.id
         LEFT JOIN permissoes p ON p.id = rp.id_permissao
         WHERE pr.id_paciente = ?
         GROUP BY r.id, r.nome, r.email, r.cpf, pr.parentesco
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
    // A validacao era so `if (!name || !relationship ...)`: aceitava e-mail
    // malformado e senha de um caractere. Agora usa o mesmo schema do cadastro
    // do paciente, com CPF verificado e senha forte.
    const parsed = guardianCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);

    const pacienteId = Number(req.user.sub);

    const [patientRows] = await pool.execute(
      `SELECT cpf FROM pacientes WHERE id = ? LIMIT 1`,
      [pacienteId]
    );

    const soDigitos = (valor) => String(valor || "").replace(/\D/g, "");
    if (soDigitos(patientRows[0]?.cpf) === soDigitos(parsed.data.cpf)) {
      return res.status(400).json({ message: 'O CPF do responsavel deve ser diferente do seu proprio CPF.' });
    }

    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const linkResult = await linkGuardianToPatient(conn, pacienteId, parsed.data);
      if (!linkResult.ok) {
        await conn.rollback();
        return res.status(linkResult.statusCode).json({ message: linkResult.message });
      }

      await conn.commit();

      return res.status(201).json({
        id: linkResult.responsavelId,
        name: parsed.data.name,
        email: parsed.data.email,
        cpf: soDigitos(parsed.data.cpf),
        relationship: parsed.data.relationship,
        permissions: linkResult.permissions,
        // Avisa o front que o CPF ja pertencia a um responsavel cadastrado e o
        // vinculo apenas reaproveitou a conta existente.
        reused: linkResult.reused
      });
    } catch (err) {
      await conn.rollback();

      if (err.code === "23505") {
        return res.status(409).json({ message: 'Ja existe um responsavel com esse e-mail ou CPF.' });
      }

      return next(err);
    } finally {
      conn.release();
    }
  }
);

router.put(
  "/patient/guardians/:id",
  authenticateToken,
  requireProfile('paciente'),
  async (req, res, next) => {
    const parsed = guardianUpdateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed);

    const pacienteId = Number(req.user.sub);
    const responsavelId = Number(req.params.id);

    if (!Number.isInteger(responsavelId) || responsavelId <= 0) {
      return res.status(400).json({ message: 'Responsavel invalido.' });
    }

    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // So permite editar quem esta de fato vinculado a este paciente - sem
      // isso, qualquer paciente logado alteraria o responsavel de outro.
      const [vinculo] = await conn.execute(
        `SELECT 1 FROM paciente_responsavel
         WHERE id_paciente = ? AND id_responsavel = ? LIMIT 1`,
        [pacienteId, responsavelId]
      );

      if (!vinculo.length) {
        await conn.rollback();
        return res.status(404).json({ message: 'Responsavel nao encontrado para este paciente.' });
      }

      if (parsed.data.name || parsed.data.email) {
        await conn.execute(
          `UPDATE responsavel
           SET nome = COALESCE(?, nome),
               email = COALESCE(?, email)
           WHERE id = ?`,
          [
            parsed.data.name ?? null,
            parsed.data.email ? String(parsed.data.email).trim().toLowerCase() : null,
            responsavelId
          ]
        );
      }

      // O parentesco descreve o vinculo com ESTE paciente, entao mora na tabela
      // de ligacao e nao no cadastro do responsavel.
      if (parsed.data.relationship) {
        await conn.execute(
          `UPDATE paciente_responsavel SET parentesco = ?
           WHERE id_paciente = ? AND id_responsavel = ?`,
          [parsed.data.relationship, pacienteId, responsavelId]
        );
      }

      if (Array.isArray(parsed.data.permissions)) {
        await conn.execute(
          `DELETE FROM responsavel_permissoes WHERE id_responsavel = ?`,
          [responsavelId]
        );

        for (const permissionId of parsed.data.permissions) {
          await conn.execute(
            `INSERT INTO responsavel_permissoes (id_permissao, id_responsavel)
             VALUES (?, ?) ON CONFLICT DO NOTHING`,
            [permissionId, responsavelId]
          );
        }
      }

      await conn.commit();

      return res.status(200).json({ id: responsavelId, ...parsed.data });
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

router.delete(
  "/patient/guardians/:id",
  authenticateToken,
  requireProfile('paciente'),
  async (req, res, next) => {
    const pacienteId = Number(req.user.sub);
    const responsavelId = Number(req.params.id);

    if (!Number.isInteger(responsavelId) || responsavelId <= 0) {
      return res.status(400).json({ message: 'Responsavel invalido.' });
    }

    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const [removido] = await conn.execute(
        `DELETE FROM paciente_responsavel
         WHERE id_paciente = ? AND id_responsavel = ?`,
        [pacienteId, responsavelId]
      );

      if (!removido.affectedRows) {
        await conn.rollback();
        return res.status(404).json({ message: 'Responsavel nao encontrado para este paciente.' });
      }

      // pacientes.id_responsavel aponta para um unico responsavel "principal".
      // Se era este, promove outro vinculo remanescente (ou zera).
      const [restantes] = await conn.execute(
        `SELECT id_responsavel FROM paciente_responsavel
         WHERE id_paciente = ? ORDER BY id_responsavel ASC LIMIT 1`,
        [pacienteId]
      );

      await conn.execute(
        `UPDATE pacientes SET id_responsavel = ? WHERE id = ? AND id_responsavel = ?`,
        [restantes[0]?.id_responsavel ?? null, pacienteId, responsavelId]
      );

      // A conta do responsavel so e apagada se ele nao acompanhar mais ninguem.
      // Como o mesmo CPF pode atender varios pacientes, apagar sempre tiraria o
      // acesso dele aos demais.
      const [outrosVinculos] = await conn.execute(
        `SELECT 1 FROM paciente_responsavel WHERE id_responsavel = ? LIMIT 1`,
        [responsavelId]
      );

      if (!outrosVinculos.length) {
        await conn.execute(`DELETE FROM responsavel WHERE id = ?`, [responsavelId]);
      }

      await conn.commit();

      return res.status(200).json({ id: responsavelId, removed: true });
    } catch (err) {
      await conn.rollback();
      return next(err);
    } finally {
      conn.release();
    }
  }
);

// ===========================================================================
// AREA DO RESPONSAVEL
// ===========================================================================

/**
 * Pacientes que o responsavel logado acompanha, com as permissoes concedidas.
 * E a primeira chamada do dashboard do responsavel: define quem ele pode ver e
 * o que a interface deve habilitar.
 *
 * As permissoes sao do responsavel (tabela responsavel_permissoes) e valem para
 * todos os pacientes vinculados a ele.
 */
router.get(
  "/responsavel/pacientes",
  authenticateToken,
  requireProfile('responsavel'),
  async (req, res, next) => {
    try {
      const responsavelId = Number(req.user.sub);

      const [pacientes] = await pool.execute(
        `SELECT p.id,
                p.nome_paciente AS name,
                p.cpf,
                p.email,
                p.telefone,
                TO_CHAR(p.data_nascimento, 'YYYY-MM-DD') AS "dataNascimento",
                p.tipo_deficiencia AS "tipoDeficiencia",
                p.unidade_preferencia AS "unidadePreferencia",
                p.status,
                pr.parentesco AS relationship
         FROM paciente_responsavel pr
         INNER JOIN pacientes p ON p.id = pr.id_paciente
         WHERE pr.id_responsavel = ?
         ORDER BY p.nome_paciente ASC`,
        [responsavelId]
      );

      const [permissoes] = await pool.execute(
        `SELECT p.id, p.nome
         FROM responsavel_permissoes rp
         INNER JOIN permissoes p ON p.id = rp.id_permissao
         WHERE rp.id_responsavel = ?
         ORDER BY p.id ASC`,
        [responsavelId]
      );

      return res.status(200).json({
        pacientes,
        permissions: permissoes.map((linha) => linha.nome),
        permissionIds: permissoes.map((linha) => linha.id)
      });
    } catch (err) {
      next(err);
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
