import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";

dotenv.config();

import { app } from "./app.js";
import { registerChatSocket } from "./socket/chat.socket.js";

const port = Number(process.env.PORT || 3000);
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
    methods: ["GET", "POST"]
  }
});

app.set("io", io);
registerChatSocket(io);

server.listen(port, () => {
  console.log(`API rodando em http://localhost:${port}`);
});

