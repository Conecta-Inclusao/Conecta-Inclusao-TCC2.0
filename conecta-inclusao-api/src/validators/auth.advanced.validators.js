// Validadores avançados de autenticação com Zod
import { z } from "zod";

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
    .enum(["paciente", "medico", "clinica"])
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

export const patientGuardianSchema = z.object({
  name: z.string().trim().min(3, "Nome do responsÃ¡vel muito curto").max(100),
  relationship: z.string().trim().min(2, "Parentesco muito curto").max(100),
  email: z.string().trim().email("Email invÃ¡lido"),
  password: strongPasswordSchema
});

// Schema para registro de paciente (CPF)
export const registerPatientSchema = z.object({
  cpf: z
    .string()
    .trim()
    .refine(
      (value) => /^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{11}$/.test(value),
      "CPF inválido"
    ),
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
  responsavel: z
    .object({
      name: z.string().trim().min(3, "Nome do responsável muito curto").max(100),
      relationship: z.string().trim().min(2, "Parentesco muito curto").max(100),
      email: z.string().email("Email inválido"),
      password: strongPasswordSchema
    })
    .optional(),
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
});

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
      (value) => /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$|^\d{14}$/.test(value),
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

// Schema original de login (para compatibilidade)
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email(),
  password: z
    .string()
    .min(8)
    .max(100)
});
