// Importa a biblioteca Zod para validacao de dados
import { z } from "zod";

function parseDateTime(value) {
    return new Date(String(value).replace(' ', 'T'));
}

// Schema de validacao para criacao de agendamento
export const createAgendamentoSchema = z.object({
    clinica_id: z
        .number()
        .int()
        .positive("ID da clinica deve ser um numero positivo"),

    paciente_id: z
        .number()
        .int()
        .positive("ID do paciente deve ser um numero positivo"),

    profissional_id: z
        .number()
        .int()
        .positive("ID do profissional deve ser um numero positivo"),

    data_agendamento: z
        .string()
        .refine((date) => !Number.isNaN(parseDateTime(date).getTime()), "Data de agendamento invalida")
        .refine((date) => parseDateTime(date) > new Date(), "Data de agendamento deve ser futura"),

    hora_agendamento: z
        .string()
        .regex(/^\d{2}:\d{2}(:\d{2})?$/, "Hora de agendamento invalida")
        .optional(),

    especialidade: z
        .string()
        .trim()
        .min(1, "Especialidade e obrigatoria")
        .max(100, "Especialidade muito longa"),

    tipo_consulta: z
        .enum(['presencial', 'online', 'telefone'])
        .default('presencial'),

    observacoes: z
        .string()
        .trim()
        .max(500, "Observacoes nao podem ter mais de 500 caracteres")
        .optional()
});
