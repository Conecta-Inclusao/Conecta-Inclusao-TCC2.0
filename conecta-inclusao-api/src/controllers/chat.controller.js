import {
  createMessageForAppointment,
  getRoomName,
  listMessagesByAppointment
} from "../services/message.service.js";

export async function getMessages(req, res) {
  const result = await listMessagesByAppointment(req.user, req.params.agendamentoId, req.query);

  if (!result.ok) {
    return res.status(result.statusCode).json({ message: result.message });
  }

  return res.status(200).json(result.data);
}

export async function sendMessage(req, res) {
  const result = await createMessageForAppointment(req.user, req.params.agendamentoId, req.body?.conteudo || req.body?.content);

  if (!result.ok) {
    return res.status(result.statusCode).json({ message: result.message });
  }

  const io = req.app.get("io");
  if (io) {
    io.to(getRoomName(result.data.message.agendamentoId)).emit("chat:message", result.data.message);
  }

  return res.status(201).json(result.data.message);
}

