import jwt from "jsonwebtoken";
import {
  createMessageForAppointment,
  getRoomName,
  validateChatAccess
} from "../services/message.service.js";

function tokenFromSocket(socket) {
  const authToken = socket.handshake.auth?.token;
  const header = socket.handshake.headers?.authorization;

  if (authToken) return authToken;
  if (header?.startsWith("Bearer ")) return header.slice(7);

  return null;
}

function socketError(message, statusCode = 400) {
  return { ok: false, statusCode, message };
}

async function joinChat(socket, payload, callback) {
  const agendamentoId = payload?.agendamentoId || payload?.appointmentId;
  const result = await validateChatAccess(socket.user, agendamentoId);

  if (!result.ok) {
    const error = socketError(result.message, result.statusCode);
    if (callback) callback(error);
    socket.emit("chat:error", error);
    return;
  }

  socket.join(getRoomName(result.data.appointment.id));

  const response = {
    ok: true,
    agendamentoId: result.data.appointment.id,
    room: result.data.room
  };

  if (callback) callback(response);
  socket.emit("chat:joined", response);
}

async function sendChatMessage(io, socket, payload, callback) {
  const agendamentoId = payload?.agendamentoId || payload?.appointmentId;
  const content = payload?.conteudo || payload?.content;
  const result = await createMessageForAppointment(socket.user, agendamentoId, content);

  if (!result.ok) {
    const error = socketError(result.message, result.statusCode);
    if (callback) callback(error);
    socket.emit("chat:error", error);
    return;
  }

  io.to(result.data.room).emit("chat:message", result.data.message);
  if (callback) callback({ ok: true, message: result.data.message });
}

export function registerChatSocket(io) {
  io.use((socket, next) => {
    const token = tokenFromSocket(socket);

    if (!token) {
      return next(new Error("Token de acesso nao fornecido."));
    }

    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      return next();
    } catch {
      return next(new Error("Token invalido ou expirado."));
    }
  });

  io.on("connection", (socket) => {
    socket.on("chat:join", (payload, callback) => {
      joinChat(socket, payload, callback).catch((error) => {
        console.error("Erro no evento chat:join:", error);
        socket.emit("chat:error", socketError("Erro interno do servidor.", 500));
      });
    });

    socket.on("chat:send", (payload, callback) => {
      sendChatMessage(io, socket, payload, callback).catch((error) => {
        console.error("Erro no evento chat:send:", error);
        socket.emit("chat:error", socketError("Erro interno do servidor.", 500));
      });
    });

    socket.on("chat:leave", (payload, callback) => {
      const agendamentoId = Number(payload?.agendamentoId || payload?.appointmentId);
      if (agendamentoId) socket.leave(getRoomName(agendamentoId));
      if (callback) callback({ ok: true });
    });
  });
}

