const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const LEADERBOARD_FILE = path.join(ROOT, "leaderboard.json");
let leaderboard = [];
try { leaderboard = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, "utf8")); } catch { leaderboard = []; }
const MAX_ECONOMY = 1e300;
const rooms = new Map();
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
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
const wss = new WebSocketServer({ server, perMessageDeflate: false });
const code = () => {
  let c;
  do c = Math.random().toString(36).slice(2, 8).toUpperCase();
  while (rooms.has(c));
  return c;
};
const send = (ws, data) =>
  ws.readyState === WebSocket.OPEN &&
  ws.send(typeof data === "string" ? data : JSON.stringify(data));
const broadcast = (room, data, except) => {
  if (!room) return;
  const payload = JSON.stringify(data);
  room.players.forEach((p) => {
    if (p.ws !== except) send(p.ws, payload);
  });
};
const sessionBoard = (room) => [...room.players.values()]
  .map((p) => ({ id:p.id, name:p.name, net:Math.trunc(p.sessionNet || 0) }))
  .sort((a,b) => b.net - a.net);
function leaderboardPayload() {
  const now = Date.now(), periods = { week:7 * 864e5, month:30 * 864e5, all:Infinity };
  const rank = (items) => items.slice().sort((a,b) => b.level - a.level || b.maxMoney - a.maxMoney).slice(0,10);
  return Object.fromEntries(Object.entries(periods).map(([key, age]) => [key, rank(leaderboard.filter((x) => now - x.at <= age))]));
}
function saveLeaderboard() {
  // Conserva soltanto i record necessari ai top 10 di ogni periodo.
  const boards = leaderboardPayload(), keep = new Set();
  Object.values(boards).flat().forEach((entry) => keep.add(`${entry.at}|${entry.team}|${entry.level}|${entry.maxMoney}`));
  leaderboard = leaderboard.filter((entry) => keep.has(`${entry.at}|${entry.team}|${entry.level}|${entry.maxMoney}`));
  try { fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2)); } catch {}
}
function recordRoom(room) {
  if (!room?.started || room.recorded) return;
  room.recorded = true;
  if (!String(room.teamName || "").trim()) return;
  leaderboard.push({ team:room.teamName, level:room.maxRound || room.round, maxMoney:room.maxMoney || room.money, at:Date.now() });
  saveLeaderboard();
  const data = { type:"leaderboard", boards:leaderboardPayload() };
  wss.clients.forEach((client) => send(client, data));
}
saveLeaderboard();
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
const mysteryEffects = ["luck", "luck", "curse", "cash", "cashloss", "time", "timeloss", "speed", "slow"];
function spawnSharedPickup(room, x, y, reason = "random") {
  if (!room || room.pickup) return false;
  room.pickup = {
    id: Math.random().toString(36).slice(2, 10),
    x: Math.round(Math.max(35, Math.min(925, Number(x) || 480))),
    y: Math.round(Math.max(85, Math.min(485, Number(y) || 270))),
    expiresAt: Date.now() + 18000,
  };
  broadcast(room, { type: "pickupSpawn", pickup: room.pickup, reason });
  return true;
}
function thiefPosition(thief, now = Date.now()) {
  const t = Math.max(0, (now - thief.spawnedAt) / 1000);
  return { x: thief.x + thief.vx * t, y: thief.y + thief.vy * t };
}
function spawnThief(room) {
  if (!room || room.thief) return;
  const fromLeft = Math.random() < 0.5,
    diagonal = Math.random() < 0.45,
    speed = 70 + Math.random() * 30;
  const travelTime = 1050 / speed + 2;
  room.thief = {
    id: Math.random().toString(36).slice(2, 10),
    x: fromLeft ? -45 : 1005,
    y: 105 + Math.random() * 330,
    vx: (fromLeft ? 1 : -1) * speed,
    vy: diagonal ? (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 8) : 0,
    spawnedAt: Date.now(),
    expiresAt: Date.now() + travelTime * 1000,
    stolen: false,
  };
  broadcast(room, { type: "thiefSpawn", thief: room.thief });
}
function thiefProgressBand(room) {
  const progress = room?.goal > 0 ? Math.max(0, Math.min(1, room.money / room.goal)) : 0;
  return progress >= 0.9 ? 3 : progress >= 0.7 ? 2 : progress >= 0.4 ? 1 : 0;
}
function scheduleNextThief(room, now = Date.now()) {
  const band = thiefProgressBand(room),
    ranges = [
      [60000, 95000], // lontani: ancora rari
      [42000, 68000],
      [25000, 42000],
      [10000, 21000], // vicini all'obiettivo: pressione alta
    ],
    [min, max] = ranges[band];
  room.thiefBand = band;
  room.nextThief = now + min + Math.random() * (max - min);
}
function refreshThiefSchedule(room, now = Date.now()) {
  const band = thiefProgressBand(room);
  if (band !== room.thiefBand && !room.thief) scheduleNextThief(room, now);
}
function executeThiefSteal(room, player, thief) {
  if (!room || !player || !thief || thief.stolen) return false;
  thief.stolen = true;
  const stolen = Math.min(room.money, Math.max(1, Math.floor(room.money * 0.05)));
  thief.stolenAmount = stolen;
  thief.victim = player.id;
  thief.victimName = player.name;
  room.money = Math.max(0, room.money - stolen);
  player.sessionNet = (player.sessionNet || 0) - stolen;
  broadcast(room, { type: "thiefStole", id: thief.id, victim: player.id, victimName: player.name, stolen });
  broadcast(room, {
    type: "economy", money: room.money, round: room.round, goal: room.goal,
    combo: room.combo, levelUps: 0, actor: player.name, delta: -stolen, outcome: null, session:sessionBoard(room),
  });
  return true;
}
wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  ws._socket?.setNoDelay(true);
  const player = {
    id: Math.random().toString(36).slice(2, 10),
    name: "Player",
    x: 480,
    y: 440,
    color: Math.floor(Math.random() * 360),
    avatar: 0,
    ready: false,
    sessionNet: 0,
    lastMoveAt: 0,
    ws,
    room: null,
  };
  const leaveRoom = () => {
    if (!player.room) return;
    const code = player.room,
      room = rooms.get(code);
    player.room = null;
    player.ready = false;
    if (!room) return;
    room.players.delete(player.id);
    broadcast(room, { type: "playerLeft", id: player.id });
    broadcast(room, { type: "count", count: room.players.size });
    if (!room.players.size) { recordRoom(room); rooms.delete(code); }
  };
  send(ws, { type: "connected", id: player.id });
  send(ws, { type: "leaderboard", boards: leaderboardPayload() });
  ws.on("message", (raw) => {
    if (raw.length > 4096) return;
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.type === "leave") {
      leaveRoom();
      return send(ws, { type: "left" });
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
          teamName: String(m.teamName || "").trim().slice(0,18),
          ownerId: player.id,
          maxMoney: 1000,
          maxRound: 1,
          started: false,
          pickup: null,
          nextPickup: Date.now() + 12000 + Math.random() * 18000,
          thief: null,
          lootBag: null,
          nextThief: Date.now() + 25000 + Math.random() * 17000,
          thiefBand: 2,
        };
        rooms.set(roomCode, room);
      }
      if (room.players.size >= 4)
        return send(ws, { type: "error", message: "Lobby piena: massimo 4 classi uniche" });
      player.name =
        String(m.name || "Player")
          .trim()
          .slice(0, 14) || "Player";
      player.avatar = null;
      player.ready = false;
      player.sessionNet = 0;
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
        pickup: room.pickup,
        thief: room.thief,
        lootBag: room.lootBag,
        teamName: room.teamName,
        ownerId: room.ownerId,
        leaderboard: leaderboardPayload(),
        session: sessionBoard(room),
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
    } else if (m.type === "profile" && player.room) {
      const room = rooms.get(player.room);
      if (!room) return;
      const requestedAvatar = m.avatar == null ? null : Math.max(0, Math.min(3, +m.avatar || 0));
      if (requestedAvatar != null && [...room.players.values()].some((p) => p.id !== player.id && p.avatar === requestedAvatar))
        return send(ws, { type:"classError", avatar:player.avatar, message:"Classe già scelta da un altro giocatore" });
      player.name =
        String(m.name || player.name || "Player")
          .trim()
          .slice(0, 14) || "Player";
      player.avatar = requestedAvatar;
      player.ready = false;
      if (player.id === room.ownerId) {
        room.teamName = String(m.teamName ?? room.teamName ?? "").trim().slice(0,18);
        broadcast(room, { type:"teamUpdated", teamName:room.teamName });
      }
      broadcast(room, { type: "roster", players: roster(room) });
    } else if (m.type === "ready" && player.room) {
      const room = rooms.get(player.room);
      if (m.ready && player.id === room.ownerId && !String(room.teamName || "").trim())
        return send(ws, { type:"teamNameError", message:"Inserisci il nome della squadra prima di essere pronto" });
      if (m.ready && player.avatar == null)
        return send(ws, { type:"classError", avatar:null, message:"Seleziona una classe prima di essere pronto" });
      player.ready = !!m.ready;
      broadcast(room, { type: "roster", players: roster(room) });
      if (room.players.size && [...room.players.values()].every((p) => p.ready)) {
        room.started = true;
        broadcast(room, {
          type: "start",
          players: roster(room),
          economy: {
            money: room.money,
            round: room.round,
            goal: room.goal,
            combo: room.combo,
            session: sessionBoard(room),
          },
        });
      }
    } else if (m.type === "pickupCollect" && player.room) {
      const room = rooms.get(player.room), item = room?.pickup;
      if (!item || item.id !== String(m.id || "")) return;
      if (Math.hypot(player.x - item.x, player.y - item.y) > 48) return;
      room.pickup = null;
      room.nextPickup = Date.now() + 38000 + Math.random() * 50000;
      const effect = mysteryEffects[Math.floor(Math.random() * mysteryEffects.length)];
      broadcast(room, { type: "pickupCollected", id: item.id, collector: player.id });
      send(ws, { type: "pickupAward", id: item.id, effect });
    } else if (m.type === "pickupDrop" && player.room) {
      const room = rooms.get(player.room);
      if (spawnSharedPickup(room, m.x, m.y, "bot"))
        room.nextPickup = Date.now() + 38000 + Math.random() * 50000;
    } else if (m.type === "thiefHit" && player.room) {
      const room = rooms.get(player.room), thief = room?.thief;
      if (!thief || thief.stolen || thief.id !== String(m.id || "")) return;
      const pos = thiefPosition(thief);
      // Raggio ampio e tollerante alla latenza della posizione multiplayer.
      if (Math.hypot(player.x - pos.x, player.y - pos.y) > 90) return;
      executeThiefSteal(room, player, thief);
    } else if (m.type === "thiefPunch" && player.room) {
      const room = rooms.get(player.room), thief = room?.thief;
      if (!thief || !thief.stolen || thief.recovered || thief.id !== String(m.id || "")) return;
      const pos = thiefPosition(thief);
      if (Math.hypot(player.x - pos.x, player.y - pos.y) > 180) return;
      thief.recovered = true;
      const recovered = Math.max(0, Number(thief.stolenAmount) || 0);
      room.thief = null;
      scheduleNextThief(room);
      room.lootBag = {
        id: Math.random().toString(36).slice(2, 10), amount: recovered,
        x: pos.x, y: pos.y, availableAt: Date.now() + 500, expiresAt: Date.now() + 15500,
      };
      broadcast(room, { type:"thiefDefeated", id:thief.id, hero:player.id, heroName:player.name, bag:room.lootBag, x:pos.x, y:pos.y });
    } else if (m.type === "lootCollect" && player.room) {
      const room = rooms.get(player.room), bag = room?.lootBag;
      if (!bag || bag.id !== String(m.id || "") || Date.now() < bag.availableAt) return;
      if (Math.hypot(player.x - bag.x, player.y - bag.y) > 52) return;
      const recovered = Math.max(0, Number(bag.amount) || 0);
      room.lootBag = null;
      room.money = Math.min(MAX_ECONOMY, room.money + recovered);
      player.sessionNet = (player.sessionNet || 0) + recovered;
      broadcast(room, { type:"lootCollected", id:bag.id, collector:player.id, collectorName:player.name, recovered });
      broadcast(room, {
        type:"economy", money:room.money, round:room.round, goal:room.goal,
        combo:room.combo, levelUps:0, actor:player.name, delta:recovered, outcome:null, session:sessionBoard(room),
      });
    } else if (m.type === "money" && player.room) {
      const room = rooms.get(player.room),
        requestedDelta = Number(m.delta),
        delta = Number.isFinite(requestedDelta)
          ? Math.trunc(
              Math.max(-MAX_ECONOMY, Math.min(MAX_ECONOMY, requestedDelta)),
            )
          : 0,
        oldRound = room.round;
      room.money = Math.min(MAX_ECONOMY, Math.max(0, room.money + delta));
      player.sessionNet = (player.sessionNet || 0) + delta;
      if (m.outcome === "win") room.combo++;
      else if (m.outcome === "loss") room.combo = 0;
      while (room.money >= room.goal) {
        const growth = 1.38 + (room.round - 1) * 0.05;
        room.goal = Math.min(
          MAX_ECONOMY,
          Math.ceil((room.goal * growth) / 50) * 50,
        );
        room.round++;
        if (room.goal >= MAX_ECONOMY) break;
      }
      room.maxMoney = Math.max(room.maxMoney || 0, room.money);
      room.maxRound = Math.max(room.maxRound || 1, room.round);
      refreshThiefSchedule(room);
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
        session: sessionBoard(room),
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
      const now = Date.now();
      if (now - player.lastMoveAt < 35) return;
      player.lastMoveAt = now;
      const room = rooms.get(player.room);
      player.x = Math.round(Math.max(0, Math.min(960, +m.x || 0)) * 10) / 10;
      player.y =
        Math.round(Math.max(55, Math.min(540, +m.y || 55)) * 10) / 10;
      broadcast(
        room,
        {
          type: "move",
          id: player.id,
          x: player.x,
          y: player.y,
          fx: Math.max(-1, Math.min(1, +m.fx || 0)),
          fy: Math.max(-1, Math.min(1, +m.fy || 0)),
        },
        ws,
      );
    }
  });
  ws.on("close", () => {
    leaveRoom();
  });
});
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 20000);
heartbeat.unref();
server.listen(PORT, () => console.log(`Neon Fortune listening on ${PORT}`));

const eventTypes = [
  "BLACKOUT",
  "HAPPY HOUR",
  "TAVOLO CHIUSO",
  "PIOGGIA DI FICHES",
  "MODALITÀ CAOS",
];
const closableGames = ["blackjack", "roulette", "horses", "slots", "fortune", "dice", "plinko"];
// Collisione rapida e autoritativa: evita che un ladro attraversi un
// giocatore in movimento tra due tick degli eventi (che avvengono ogni 1s).
const thiefCollisionTimer = setInterval(() => {
  const now = Date.now();
  rooms.forEach((room) => {
    if (!room.thief || room.thief.stolen) return;
    const pos = thiefPosition(room.thief, now),
      victim = [...room.players.values()].find(
        (p) => Math.hypot(p.x - pos.x, p.y - pos.y) <= 72,
      );
    if (victim) executeThiefSteal(room, victim, room.thief);
  });
}, 100);
thiefCollisionTimer.unref();
setInterval(() => {
  const now = Date.now();
  rooms.forEach((room) => {
    if (room.lootBag && now >= room.lootBag.expiresAt) {
      const bagId = room.lootBag.id;
      room.lootBag = null;
      broadcast(room, { type:"lootExpired", id:bagId });
    }
    if (room.thief && !room.thief.stolen) {
      const thiefPos = thiefPosition(room.thief, now);
      const victim = [...room.players.values()].find(
        (p) => Math.hypot(p.x - thiefPos.x, p.y - thiefPos.y) <= 72,
      );
      if (victim) executeThiefSteal(room, victim, room.thief);
    }
    if (room.thief && now >= room.thief.expiresAt) {
      const thiefId = room.thief.id;
      room.thief = null;
      scheduleNextThief(room, now);
      broadcast(room, { type: "thiefGone", id: thiefId });
    } else if (room.started && !room.thief && now >= room.nextThief) {
      spawnThief(room);
    }
    if (room.pickup && now >= room.pickup.expiresAt) {
      const expiredId = room.pickup.id;
      room.pickup = null;
      room.nextPickup = now + 25000 + Math.random() * 35000;
      broadcast(room, { type: "pickupExpired", id: expiredId });
    } else if (room.started && !room.pickup && now >= room.nextPickup) {
      spawnSharedPickup(room, 370 + Math.random() * 220, 100 + Math.random() * 350);
    }
    if (room.started && !room.pickup && room.event?.name === "PIOGGIA DI FICHES")
      room.nextPickup = Math.min(room.nextPickup, now + 5000);
    if (room.event && now >= room.event.endsAt) {
      room.event = null;
      room.nextEvent = now + 50000 + Math.random() * 35000;
      broadcast(room, { type: "eventEnd" });
    } else if (!room.event && now >= room.nextEvent) {
      const name = eventTypes[Math.floor(Math.random() * eventTypes.length)];
      room.event = {
        name,
        endsAt: now + 25000,
        ...(name === "TAVOLO CHIUSO"
          ? { blockedGame: closableGames[Math.floor(Math.random() * closableGames.length)] }
          : {}),
      };
      broadcast(room, { type: "eventStart", event: room.event });
    }
  });
}, 1000);
