const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const rooms = new Map();
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const wanted = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = path.resolve(ROOT, wanted);
  if (
    !file.startsWith(ROOT) ||
    !fs.existsSync(file) ||
    fs.statSync(file).isDirectory()
  ) {
    res.writeHead(404);
    return res.end("Not found");
  }
  res.writeHead(200, {
    "Content-Type": types[path.extname(file)] || "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  fs.createReadStream(file).pipe(res);
});
const wss = new WebSocketServer({ server });
const code = () => {
  let c;
  do c = Math.random().toString(36).slice(2, 8).toUpperCase();
  while (rooms.has(c));
  return c;
};
const send = (ws, data) =>
  ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(data));
const broadcast = (room, data, except) =>
  room &&
  room.players.forEach((p) => {
    if (p.ws !== except) send(p.ws, data);
  });
const roster = (room) =>
  [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    color: p.color,
    avatar: p.avatar,
    ready: p.ready,
  }));
wss.on("connection", (ws) => {
  const player = {
    id: Math.random().toString(36).slice(2, 10),
    name: "Player",
    x: 480,
    y: 440,
    color: Math.floor(Math.random() * 360),
    avatar: 0,
    ready: false,
    ws,
    room: null,
  };
  send(ws, { type: "connected", id: player.id });
  ws.on("message", (raw) => {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.type === "create" || m.type === "join") {
      const roomCode =
        m.type === "create" ? code() : String(m.code || "").toUpperCase();
      let room = rooms.get(roomCode);
      if (m.type === "join" && !room)
        return send(ws, { type: "error", message: "Lobby non trovata" });
      if (m.type === "create") {
        room = {
          code: roomCode,
          players: new Map(),
          money: 1000,
          round: 1,
          goal: 1300,
          combo: 0,
          event: null,
          nextEvent: Date.now() + 35000,
        };
        rooms.set(roomCode, room);
      }
      if (room.players.size >= 12)
        return send(ws, { type: "error", message: "Lobby piena" });
      player.name =
        String(m.name || "Player")
          .trim()
          .slice(0, 14) || "Player";
      player.avatar = Math.max(0, Math.min(3, +m.avatar || 0));
      player.ready = false;
      player.room = roomCode;
      room.players.set(player.id, player);
      send(ws, {
        type: "joined",
        code: roomCode,
        id: player.id,
        players: roster(room),
        economy: {
          money: room.money,
          round: room.round,
          goal: room.goal,
          combo: room.combo,
        },
        event: room.event,
      });
      broadcast(
        room,
        {
          type: "playerJoined",
          player: roster(room).find((p) => p.id === player.id),
        },
        ws,
      );
      broadcast(room, { type: "count", count: room.players.size });
    } else if (m.type === "ready" && player.room) {
      const room = rooms.get(player.room);
      player.ready = !!m.ready;
      broadcast(room, { type: "roster", players: roster(room) });
      if (room.players.size && [...room.players.values()].every((p) => p.ready))
        broadcast(room, {
          type: "start",
          players: roster(room),
          economy: {
            money: room.money,
            round: room.round,
            goal: room.goal,
            combo: room.combo,
          },
        });
    } else if (m.type === "money" && player.room) {
      const room = rooms.get(player.room),
        delta = Math.max(
          -1000000,
          Math.min(1000000, Math.floor(+m.delta || 0)),
        ),
        oldRound = room.round;
      room.money = Math.max(0, room.money + delta);
      if (m.outcome === "win") room.combo++;
      else if (m.outcome === "loss") room.combo = 0;
      while (room.money >= room.goal) {
        const growth = 1.38 + (room.round - 1) * 0.05;
        room.goal = Math.ceil((room.goal * growth) / 50) * 50;
        room.round++;
      }
      broadcast(room, {
        type: "economy",
        money: room.money,
        round: room.round,
        goal: room.goal,
        combo: room.combo,
        levelUps: room.round - oldRound,
        actor: player.name,
        delta,
        outcome: m.outcome || null,
      });
    } else if (m.type === "emote" && player.room) {
      const room = rooms.get(player.room),
        emote = ["🎉", "😂", "😡", "👉", "🎲"][
          Math.max(0, Math.min(4, +m.emote || 0))
        ];
      broadcast(room, { type: "emote", id: player.id, emote });
    } else if (m.type === "punch" && player.room) {
      const room = rooms.get(player.room),
        target = room.players.get(String(m.target)),
        dx = Math.max(-1, Math.min(1, +m.dx || 0)),
        dy = Math.max(-1, Math.min(1, +m.dy || 0)),
        strength = Math.max(0, Math.min(1, +m.strength || 0));
      if (
        target &&
        target !== player &&
        Math.hypot(target.x - player.x, target.y - player.y) < 105
      ) {
        const fromX = target.x,
          fromY = target.y,
          role = player.avatar === 3 ? 1.25 : 1,
          power = (70 + strength * 150) * role;
        target.x = Math.max(20, Math.min(940, target.x + dx * power));
        target.y = Math.max(75, Math.min(495, target.y + dy * power));
        broadcast(room, {
          type: "knock",
          target: target.id,
          fromX,
          fromY,
          x: target.x,
          y: target.y,
          attacker: player.id,
          dx,
          dy,
          strength,
        });
      }
    } else if (m.type === "move" && player.room) {
      const room = rooms.get(player.room);
      player.x = Math.max(0, Math.min(960, +m.x || 0));
      player.y = Math.max(55, Math.min(540, +m.y || 55));
      broadcast(
        room,
        { type: "move", id: player.id, x: player.x, y: player.y },
        ws,
      );
    }
  });
  ws.on("close", () => {
    if (!player.room) return;
    const room = rooms.get(player.room);
    if (!room) return;
    room.players.delete(player.id);
    broadcast(room, { type: "playerLeft", id: player.id });
    broadcast(room, { type: "count", count: room.players.size });
    if (!room.players.size) rooms.delete(player.room);
  });
});
server.listen(PORT, () => console.log(`Neon Fortune listening on ${PORT}`));

const eventTypes = [
  "BLACKOUT",
  "HAPPY HOUR",
  "PIOGGIA DI FICHES",
  "MODALITÀ CAOS",
];
setInterval(() => {
  const now = Date.now();
  rooms.forEach((room) => {
    if (room.event && now >= room.event.endsAt) {
      room.event = null;
      room.nextEvent = now + 50000 + Math.random() * 35000;
      broadcast(room, { type: "eventEnd" });
    } else if (!room.event && now >= room.nextEvent) {
      room.event = {
        name: eventTypes[Math.floor(Math.random() * eventTypes.length)],
        endsAt: now + 25000,
      };
      broadcast(room, { type: "eventStart", event: room.event });
    }
  });
}, 1000);
