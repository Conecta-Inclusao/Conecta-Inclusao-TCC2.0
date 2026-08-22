// Validadores avançados de autenticação com Zod
import { z } from "zod";
import { validateCPF, validateCNPJ } from "../utils/documents.js";

// Schema para login universal (aceita CRM, CNPJ, CPF ou Email)
export const universalLoginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(3, "Identificador muito curto")
    .max(100, "Identificador muito longo")
    .refine(
      (value) => {
        // Aceita: CPF (11 dígitos), CNPJ (14 dígitos), CRM (4-7 caracteres), Email
        const cpf = /^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{11}$/;
        const cnpj = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$|^\d{14}$/;
        const crm = /^[A-Z0-9]{4,7}$/i;
        const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        
        return cpf.test(value) || cnpj.test(value) || crm.test(value) || email.test(value);
      },
      "Formato inválido. Use CPF, CNPJ, CRM ou Email."
    ),
  password: z
    .string()
    .min(8, "Senha deve ter no mínimo 8 caracteres")
    .max(100, "Senha muito longa"),
  expectedProfile: z
    .enum(["paciente", "medico", "clinica", "responsavel"])
    .optional()
});

const strongPasswordSchema = z
  .string()
  .min(8, "Senha deve ter no mínimo 8 caracteres")
  .max(100, "Senha muito longa")
  .regex(/[a-z]/, "Senha deve conter letra minúscula")
  .regex(/[A-Z]/, "Senha deve conter letra maiúscula")
  .regex(/\d/, "Senha deve conter número")
  .regex(/[^A-Za-z0-9]/, "Senha deve conter caractere especial");

// CPF com formato e digito verificador. Extraido para constante porque agora e
// usado tanto pelo paciente quanto pelo responsavel.
const cpfSchema = z
  .string()
  .trim()
  .refine(
    (value) => /^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{11}$/.test(value) && validateCPF(value),
    "CPF inválido"
  );

// Campos do responsavel, compartilhados entre o cadastro do paciente e o modal
// da aba "Responsáveis" do dashboard - os dois passaram a pedir os mesmos dados.
const guardianFields = {
  name: z.string().trim().min(3, "Nome do responsável muito curto").max(100),
  cpf: cpfSchema,
  relationship: z.string().trim().min(2, "Parentesco muito curto").max(100),
  email: z.string().trim().email("Email inválido"),
  password: strongPasswordSchema,
  // Ids da tabela `permissoes`. Antes eram strings livres gravadas numa
  // coluna JSON `paciente_responsavel.permissions` que nao existe no schema.
  permissions: z.array(z.coerce.number().int().positive()).optional()
};

export const guardianCreateSchema = z.object(guardianFields);

// Edicao do proprio perfil do paciente. Todos os campos sao opcionais: a tela
// envia apenas o que mudou. CPF fica de fora de proposito - e o identificador
// de login e nao deve ser trocado por aqui.
export const updatePatientProfileSchema = z.object({
  name: z.string().trim().min(3, "Nome muito curto").max(100).optional(),
  email: z.string().trim().email("Email inválido").nullish(),
  telefone: z
    .string()
    .trim()
    .regex(/^\(?\d{2}\)?[\s-]?\d{4,5}-?\d{4}$/, "Telefone inválido")
    .nullish(),
  tipoDeficiencia: z.string().trim().max(100).nullish(),
  unidadePreferencia: z.string().trim().max(120).nullish(),
  dataNascimento: z
    .string()
    .trim()
    .refine((date) => !Number.isNaN(Date.parse(date)), "Data inválida")
    .nullish()
}).refine(
  (data) => Object.values(data).some((valor) => valor !== undefined),
  { message: "Envie ao menos um campo para atualizar." }
);

// A senha atual e exigida para que uma sessao sequestrada nao consiga trocar a
// senha sozinha e travar o dono da conta do lado de fora.
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Informe a senha atual"),
  newPassword: strongPasswordSchema
});

// Na edicao a senha nao e reenviada e o CPF identifica a pessoa, entao so os
// dados de contato/vinculo podem mudar.
export const guardianUpdateSchema = z.object({
  name: guardianFields.name.optional(),
  relationship: guardianFields.relationship.optional(),
  email: guardianFields.email.optional(),
  permissions: guardianFields.permissions
});

export const resetTemporaryPasswordSchema = z.object({
  resetToken: z
    .string()
    .trim()
    .min(20, "Token inválido"),
  newPassword: strongPasswordSchema
});

export const forgotPasswordSchema = z.object({
  type: z.enum(["cpf", "crm", "cnpj"]),
  identifier: z
    .string()
    .trim()
    .min(4, "Identificador invalido")
    .max(30, "Identificador muito longo")
});

export const resetPasswordSchema = z.object({
  token: z
    .string()
    .trim()
    .min(20, "Token invalido"),
  newPassword: strongPasswordSchema
});

// Schema para registro de paciente (CPF)
export const registerPatientSchema = z.object({
  // Alem do formato, valida o digito verificador.
  cpf: cpfSchema,
  password: strongPasswordSchema,
  name: z
    .string()
    .trim()
    .min(3, "Nome muito curto")
    .max(100),
  email: z
    .string()
    .email("Email inválido")
    .optional(),
  responsavel: guardianCreateSchema.optional(),
  tipoDeficiencia: z
    .string()
    .trim()
    .max(100)
    .optional(),
  dataNascimento: z
    .string()
    .refine(
      (date) => !isNaN(Date.parse(date)),
      "Data inválida"
    )
    .optional()
}).refine(
  // O responsavel e uma segunda conta, com login proprio pelo CPF. Se o CPF
  // fosse o mesmo do paciente, o cadastro criaria duas contas disputando o
  // mesmo documento e o login por CPF ficaria ambiguo.
  (data) => {
    if (!data.responsavel?.cpf) return true;
    const soDigitos = (valor) => String(valor).replace(/\D/g, "");
    return soDigitos(data.responsavel.cpf) !== soDigitos(data.cpf);
  },
  {
    message: "O CPF do responsável deve ser diferente do CPF do paciente.",
    path: ["responsavel", "cpf"]
  }
);

// Schema para registro de médico (CRM)
export const registerDoctorSchema = z.object({
  crm: z
    .string()
    .trim()
    .toUpperCase()
    .refine(
      (value) => /^[A-Z0-9]{4,7}$/.test(value),
      "CRM inválido"
    ),
  password: strongPasswordSchema,
  name: z
    .string()
    .trim()
    .min(3)
    .max(100),
  email: z
    .string()
    .email("Email inválido")
    .optional(),
  especialidade: z
    .string()
    .trim()
    .max(100)
    .optional(),
  bio: z
    .string()
    .trim()
    .max(500)
    .optional(),
  unidade: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional(),
  clinicaId: z
    .number()
    .int()
    .positive()
    .optional()
});

// Schema para registro de clínica (CNPJ)
export const registerClinicSchema = z.object({
  cnpj: z
    .string()
    .trim()
    .refine(
      (value) => /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$|^\d{14}$/.test(value) && validateCNPJ(value),
      "CNPJ inválido"
    ),
  password: strongPasswordSchema,
  name: z
    .string()
    .trim()
    .min(3)
    .max(100),
  razaoSocial: z
    .string()
    .trim()
    .max(150),
  email: z
    .string()
    .email("Email inválido")
    .optional(),
  endereco: z
    .string()
    .trim()
    .max(255)
    .optional(),
  cidade: z
    .string()
    .trim()
    .max(100)
    .optional(),
  estado: z
    .string()
    .trim()
    .length(2)
    .optional(),
  cep: z
    .string()
    .trim()
    .max(10)
    .optional(),
  telefone: z
    .string()
    .trim()
    .max(20)
    .optional(),
  responsavel: z
    .string()
    .trim()
    .max(100)
    .optional()
});
