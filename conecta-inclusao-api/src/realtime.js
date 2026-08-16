// Camada de tempo real do chat paciente <-> medico.
//
// A versao anterior aceitava qualquer conexao e confiava no cliente para dizer
// quem ele era: `joinConversation({ roomId, userId, profile })` colocava o
// socket em qualquer sala pedida e `sendConversationMessage` retransmitia sem
// validar nem persistir. Na pratica, qualquer pessoa na internet conseguia
// entrar na conversa de qualquer atendimento e forjar mensagens.
//
// Agora:
//  - o handshake exige um JWT valido (mesmo token do REST);
//  - o cliente pede para falar com um *perfil*, nunca com uma sala;
//  - o servidor resolve a sala a partir do vinculo real no banco;
//  - toda mensagem passa pela mesma autorizacao e persistencia do REST.
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { env } from "./env.js";
import {
  conversationRoom,
  findLinkBetweenProfiles,
  resolveActor,
  saveMessageForConversation
} from "./services/message.service.js";

function extractToken(socket) {
  const fromAuth = socket.handshake.auth?.token;
  if (fromAuth) return String(fromAuth).replace(/^Bearer\s+/i, "");

  const header = socket.handshake.headers?.authorization;
  if (header) return String(header).replace(/^Bearer\s+/i, "");

  return null;
}

function respond(ack, payload) {
  if (typeof ack === "function") ack(payload);
}

export function initRealtime(server, allowedOrigins) {
  const io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  // --- Handshake autenticado -------------------------------------------------
  io.use(async (socket, next) => {
    const token = extractToken(socket);

    if (!token) {
      return next(new Error("Token de acesso nao fornecido."));
    }

    let decoded;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET);
    } catch {
      return next(new Error("Token invalido ou expirado."));
    }

    // Tokens de acesso ao prontuario (type: records_access) nao valem para chat.
    if (decoded.type) {
      return next(new Error("Token nao autorizado para mensagens."));
    }

    const actorResult = await resolveActor({ sub: decoded.sub, profile: decoded.profile });
    if (!actorResult.ok) {
      return next(new Error(actorResult.message));
    }

    socket.data.actor = actorResult.data;
    return next();
  });

  io.on("connection", (socket) => {
    const actor = socket.data.actor;

    // Sala privada do proprio usuario: permite notificar sobre conversas que
    // ele nao tem aberta no momento.
    socket.join(`perfil:${actor.profile}:${actor.profileId}`);

    socket.on("joinConversation", async ({ targetProfileId } = {}, ack) => {
      try {
        const link = await findLinkBetweenProfiles(actor, targetProfileId);

        if (!link) {
          return respond(ack, {
            ok: false,
            message: "Voce nao possui atendimento vinculado a este usuario."
          });
        }

        const room = conversationRoom(actor, link);

        // Sai da conversa anterior para nao acumular salas na mesma conexao.
        if (socket.data.room && socket.data.room !== room) {
          socket.leave(socket.data.room);
        }

        socket.join(room);
        socket.data.room = room;
        socket.data.targetProfileId = link.targetProfileId;

        return respond(ack, {
          ok: true,
          appointmentId: link.appointmentId,
          contact: {
            profileId: link.targetProfileId,
            profile: link.targetProfile,
            name: link.targetName,
            specialty: link.targetSpecialty,
            unit: link.targetUnit
          }
        });
      } catch (error) {
        console.error("Erro em joinConversation:", error);
        return respond(ack, { ok: false, message: "Erro interno do servidor." });
      }
    });

    socket.on("sendConversationMessage", async ({ targetProfileId, content } = {}, ack) => {
      try {
        // Se o cliente nao mandar o destino, usa o da sala ativa - mas nunca
        // aceita um roomId cru vindo do cliente.
        const destination = targetProfileId ?? socket.data.targetProfileId;

        const result = await saveMessageForConversation(actor, destination, content);

        if (!result.ok) {
          return respond(ack, { ok: false, message: result.message });
        }

        const { message, link } = result.data;
        const room = conversationRoom(actor, link);

        socket.join(room);
        socket.data.room = room;
        socket.data.targetProfileId = link.targetProfileId;

        io.to(room).emit("conversationMessage", message);

        // Avisa o destinatario mesmo que ele nao esteja com a conversa aberta.
        io.to(`perfil:${link.targetProfile}:${link.targetProfileId}`).emit("conversationNotification", {
          fromProfile: actor.profile,
          fromProfileId: actor.profileId,
          fromName: actor.name,
          preview: message.content.slice(0, 120),
          createdAt: message.createdAt
        });

        return respond(ack, { ok: true, message });
      } catch (error) {
        console.error("Erro em sendConversationMessage:", error);
        return respond(ack, { ok: false, message: "Erro interno do servidor." });
      }
    });

    socket.on("leaveConversation", () => {
      if (socket.data.room) {
        socket.leave(socket.data.room);
        socket.data.room = null;
        socket.data.targetProfileId = null;
      }
    });
  });

  return io;
}
