import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { getMessages, sendMessage } from "../controllers/chat.controller.js";
import { authenticateToken } from "../middlewares/auth.middleware.js";

const router = Router();

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120
});

const agendamentoParamSchema = z.object({
  agendamentoId: z.coerce.number().int().positive()
});

const messageBodySchema = z.object({
  conteudo: z
    .string()
    .trim()
    .min(1, "Mensagem obrigatoria")
    .max(2000, "Mensagem muito longa")
    .optional(),
  content: z
    .string()
    .trim()
    .min(1, "Mensagem obrigatoria")
    .max(2000, "Mensagem muito longa")
    .optional()
}).refine((data) => data.conteudo || data.content, {
  message: "Mensagem obrigatoria",
  path: ["conteudo"]
});

function validateAgendamentoParam(req, res, next) {
  const parsed = agendamentoParamSchema.safeParse(req.params);

  if (!parsed.success) {
    return res.status(400).json({ message: "Agendamento invalido.", errors: parsed.error.issues });
  }

  req.params.agendamentoId = String(parsed.data.agendamentoId);
  return next();
}

function validateMessageBody(req, res, next) {
  const parsed = messageBodySchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: "Dados invalidos.", errors: parsed.error.issues });
  }

  req.body = parsed.data;
  return next();
}

router.get(
  "/agendamentos/:agendamentoId",
  authenticateToken,
  validateAgendamentoParam,
  getMessages
);

router.post(
  "/agendamentos/:agendamentoId",
  authenticateToken,
  chatLimiter,
  validateAgendamentoParam,
  validateMessageBody,
  sendMessage
);

export default router;

