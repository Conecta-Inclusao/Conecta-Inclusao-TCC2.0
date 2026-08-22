import { Router } from "express";
import { z } from "zod";
import { authenticateToken } from "../services/auth.advanced.service.js";
import {
  getConversationWithUser,
  listAllowedMessageContacts,
  sendMessageToUser
} from "../services/message.service.js";

const router = Router();

const sendMessageSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Mensagem obrigatoria")
    .max(2000, "Mensagem muito longa")
});

// pacienteId so e usado quando quem chama e um responsavel que acompanha mais
// de um paciente; nos demais perfis o valor e ignorado.
function pacienteAlvo(req) {
  return { pacienteId: req.query?.pacienteId ?? req.body?.pacienteId ?? null };
}

router.get("/contacts", authenticateToken, async (req, res) => {
  const result = await listAllowedMessageContacts(req.user, pacienteAlvo(req));

  if (!result.ok) {
    return res.status(result.statusCode).json({ message: result.message });
  }

  return res.status(200).json(result.data);
});

router.get("/thread/:targetProfileId", authenticateToken, async (req, res) => {
  const result = await getConversationWithUser(req.user, req.params.targetProfileId, pacienteAlvo(req));

  if (!result.ok) {
    return res.status(result.statusCode).json({ message: result.message });
  }

  return res.status(200).json(result.data);
});

router.post("/thread/:targetProfileId", authenticateToken, async (req, res) => {
  const parsed = sendMessageSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Dados invalidos",
      errors: parsed.error.issues
    });
  }

  const result = await sendMessageToUser(req.user, req.params.targetProfileId, parsed.data.content, pacienteAlvo(req));

  if (!result.ok) {
    return res.status(result.statusCode).json({ message: result.message });
  }

  return res.status(201).json(result.data);
});

export default router;
