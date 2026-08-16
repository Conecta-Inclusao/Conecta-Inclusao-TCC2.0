import { z } from "zod";

// Schema de criacao de agendamento.
//
// clinica_id e paciente_id sao opcionais no corpo porque a rota os deriva do
// token (um paciente so agenda para si; uma clinica so na propria clinica).
// Mante-los obrigatorios so obrigava o cliente a mandar um valor que o servidor
// descarta - e dava a falsa impressao de que o cliente escolhe o dono do registro.
export const createAgendamentoSchema = z.object({
    clinica_id: z
        .number()
        .int()
        .positive("ID da clínica deve ser um número positivo")
        .optional(),

    paciente_id: z
        .number()
        .int()
        .positive("ID do paciente deve ser um número positivo")
        .optional(),

    profissional_id: z
        .number()
        .int()
        .positive("ID do profissional deve ser um número positivo"),

    data_agendamento: z
        .string()
        .refine((date) => !isNaN(Date.parse(date)), "Data de agendamento inválida")
        .refine((date) => new Date(date) > new Date(), "Data de agendamento deve ser futura"),

    // Campos aceitos por compatibilidade com o front, mas nao persistidos:
    // a tabela `agendamentos` nao possui colunas para eles.
    especialidade: z
        .string()
        .trim()
        .max(100, "Especialidade muito longa")
        .optional(),

    tipo_consulta: z
        .enum(['presencial', 'online', 'telefone'])
        .default('presencial'),

    observacoes: z
        .string()
        .trim()
        .max(500, "Observações não podem ter mais de 500 caracteres")
        .optional()
});
