import { z } from "zod";

export const createClinicSchema = z.object({
    clinicName: z
        .string()
        .trim()
        .min(3, "Nome da clinica deve ter no minimo 3 caracteres")
        .max(100, "Nome da clinica deve ter no maximo 100 caracteres"),

    cnpj: z
        .string()
        .regex(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$|^\d{14}$/, "CNPJ invalido"),

    clinicPhone: z
        .string()
        .regex(/^\(\d{2}\)\s\d{4,5}-\d{4}$|^\d{10,11}$/, "Telefone invalido")
        .optional(),

    clinicEmail: z
        .string()
        .trim()
        .toLowerCase()
        .email("Email da clinica invalido")
        .optional(),

    cep: z
        .string()
        .regex(/^\d{5}-\d{3}$|^\d{8}$/, "CEP invalido")
        .optional(),

    address: z
        .string()
        .trim()
        .max(255, "Endereco muito longo")
        .optional(),

    number: z
        .string()
        .trim()
        .max(20)
        .optional(),

    complement: z
        .string()
        .trim()
        .max(100, "Complemento muito longo")
        .optional(),

    city: z
        .string()
        .trim()
        .max(100)
        .optional(),

    state: z
        .string()
        .trim()
        .length(2, "Estado deve ter 2 letras")
        .optional(),

    razaoSocial: z
        .string()
        .trim()
        .max(100)
        .optional(),

    responsibleName: z
        .string()
        .trim()
        .max(100)
        .optional(),

    password: z
        .string()
        .min(8, "Senha deve ter no minimo 8 caracteres")
        .max(100, "Senha muito longa")
        .regex(/[a-zA-Z]/, "Senha deve conter letras")
        .regex(/[0-9]/, "Senha deve conter numeros"),

    confirmPassword: z
        .string()
        .optional(),

    agreeTerms: z
        .boolean()
        .refine((value) => value === true, "Voce deve concordar com os termos")
        .optional()
}).refine((data) => !data.confirmPassword || data.password === data.confirmPassword, {
    message: "Senhas nao conferem",
    path: ["confirmPassword"]
});
