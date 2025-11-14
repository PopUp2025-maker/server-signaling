import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.use(cors());

app.get("/", (req, res) => res.send("🟢 Socket server up!"));

//  ROUTE DI PING (per monitoraggio remoto)
app.get("/ping", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "✅ Socket server attivo",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(), 
    connectedClients: io.engine.clientsCount, 
  });
});

// Ogni stanza può avere al massimo 1 host
const roomRoles = {}; // { roomId: { host: socketId } }

// 🔁 Funzione helper per ottenere lista giocatori di una stanza
const getPlayersInRoom = (roomId) => {
  const room = io.sockets.adapter.rooms.get(roomId);
  if (!room) return [];
  return [...room].map((id) => ({ id }));
};

io.on("connection", (socket) => {
  console.log("🔌 Connesso:", socket.id);

  // 🏠 JOIN ROOM
  socket.on("join-room", ({ roomId, role }, ack) => {
    const hasHost = roomRoles[roomId]?.host;

    // 👑 HOST
    if (role === "host") {
      if (hasHost) {
        ack?.({
          ok: false,
          error: "❌ Stanza già occupata da un altro host. Scegline un'altra.",
        });
        return;
      }

      roomRoles[roomId] = { host: socket.id };
      socket.join(roomId);

      ack?.({
        ok: true,
        role: "host",
        message: "✅ Stanza creata correttamente.",
      });

      console.log(`👑 Host ${socket.id} -> "${roomId}"`);
      io.to(roomId).emit("players-update", { players: getPlayersInRoom(roomId) });
      return;
    }

    // 🙋 GUEST
    if (role === "guest") {
      if (!hasHost) {
        ack?.({
          ok: false,
          error: "⚠️ Nessun host trovato per questa stanza. Controlla l’ID e riprova.",
        });
        return;
      }

      socket.join(roomId);

      ack?.({
        ok: true,
        role: "guest",
        message: "✅ Connesso alla stanza.",
      });

      console.log(`🙋 Guest ${socket.id} -> "${roomId}"`);
      io.to(roomId).emit("players-update", { players: getPlayersInRoom(roomId) });
      return;
    }
  });

  // ▶️ Host decide di iniziare
  socket.on("start-game", ({ roomId }) => {
    io.to(roomId).emit("start-game");
    console.log(`▶️ Partita iniziata nella stanza ${roomId}`);
  });

  // 🔁 Host cambia pannello → sync ai guest
  socket.on("update-panel", ({ roomId, panel }) => {
    socket.to(roomId).emit("update-panel", { panel });
    console.log(`📨 update-panel → ${roomId}: ${panel}`);
  });

  // 🔤 Host invia una scelta (A/B)
  socket.on("choice", ({ roomId, value }, ack) => {
    socket.to(roomId).emit("choice", { value });
    ack?.({ ok: true });
    console.log(`📩 choice → ${roomId}: ${value}`);
  });

  // 👋 Quando qualcuno si disconnette
  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms].filter((r) => r !== socket.id);

    rooms.forEach((roomId) => {
      const isHost = roomRoles[roomId]?.host === socket.id;

      if (isHost) {
        // Libero la stanza
        delete roomRoles[roomId];

        // Espello tutti i giocatori → redirect forzato client-side
        io.to(roomId).emit("room-closed", {
          message: "⚠️ L'host ha lasciato la stanza. Verrai reindirizzato alla homepage.",
        });

        console.log(`❌ Host out → chiusa "${roomId}" (tutti scollegati)`);
      } else {
        // Se si disconnette un guest → aggiorno lista giocatori
        io.to(roomId).emit("players-update", { players: getPlayersInRoom(roomId) });
      }
    });
  });

  socket.on("disconnect", () => {
    console.log("🚪 Disconnesso:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Listening on port ${PORT}`));
