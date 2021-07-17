const express = require("express");
const socketIO = require("socket.io");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json())

const port = process.env.PORT || 4000;

const server = app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
});

const io = socketIO(server, {
  cors: {
    // origin: "http://localhost:3000",
    origin: "https://carrot-in-a-box.netlify.app",
    credentials: true
  }
});

app.post('/openroom', (req, res) => {
  let requestedRoomId = req.body.room_id;
  for (let i = 0; i < rooms.length; i++) {
    let thisRoom = rooms[i];
    if (thisRoom["room_id"] === requestedRoomId) {
      res.send({
        exists: true,
        clientCount: thisRoom["clients"].length
      });
      return
    }
  }
  res.send({
    exists: false,
    clientCount: 0
  });
});

const flipCoin = () => (
  Math.random() > 0.5 ? 0 : 1
);

const removeId = (client) => {
  return {
    username: client.username,
    isPeeker: client.isPeeker,
    hasCarrot: client.hasCarrot,
    score: client.score,
  }
}

const MAX_SECONDS = 120

const updateTimer = async (emitter, room_id, room) => {
  room["seconds"]--;
  if (room["seconds"] >= 0) {
    await emitter.to(room_id).emit("update_time", room["seconds"]);
  }
  if (room["seconds"] < 0) {
    await emitter.to(room_id).emit('log_event', "Time's up!");
    madeMove(emitter, true, room_id);
    resetClock(room);
    emitter.to(room_id).emit("update_time", room["seconds"]);
  }
}

const resetClock = (room) => {
  clearInterval(room["timer"]);
  room["seconds"] = MAX_SECONDS;
}

const madeMove = async (emitter, keep, room_id) => {
  let room = rooms.filter(room => room["room_id"] == room_id)[0]
  resetClock(room);
  await emitter.to(room_id).emit("update_time", room["seconds"]);
  let clients = room["clients"];
  let player_index = !clients[0]["isPeeker"] ? 0 : 1;
  let opponent_index = player_index ? 0 : 1;
  let player = clients[player_index];
  let opponent = clients[opponent_index];
  let won = (player["hasCarrot"] && keep) || (!player["hasCarrot"] && !keep)
  if (won) {
    player["score"]++;
  } else {
    opponent["score"]++;
  }
  await emitter.to(room_id).emit("what_happened", {
    actionPlayer: player["username"],
    kept: keep,
    won: won
  })
  await emitter.to(player["client_id"]).emit("game_update", {won: won, scores: [player["score"], opponent["score"]]});
  await emitter.to(opponent["client_id"]).emit("game_update", {won: !won, scores: [opponent["score"], player["score"]]});
  for (let i = 0; i < room["spectators"].length; i++) {
    emitter.to(room["spectators"][i]["client_id"]).emit("game_update", {won: false, scores: [clients[0]["score"], clients[1]["score"]]});
  }
}

let rooms = []

io.on("connection", (socket) => {
  socket.on("join_room", (data) => {
    socket.join(data.room);
    filteredRooms = rooms.filter(room => room["room_id"] === data.room);
    let newUser = {
      username: data.username,
      client_id: socket.id,
      isPeeker: false,
      hasCarrot: false,
      score: 0
    }
    if (!filteredRooms.length) {
      rooms.push({
        room_id: data.room,
        clients: [newUser],
        spectators: [],
        num_ready: 0,
        seconds: MAX_SECONDS,
        timer: null
      })
    } else {
      ourRoom = filteredRooms[0]
      let clients = ourRoom["clients"]
      if (clients.length < 2) {
        clients.push(newUser);
        if (clients.length === 2) {
          clients[flipCoin()]["isPeeker"] = true;
          clients[flipCoin()]["hasCarrot"] = true;
          let player_data = clients.map(client => removeId(client));
          io.to(data.room).emit("game_ready", player_data);
        }
      } else {
        ourRoom["spectators"].push(newUser);
        let player_data = clients.map(client => removeId(client));
        io.to(socket.id).emit("game_ready", player_data);
      }
    }

    socket.on("choose_box", async (data) => {
      madeMove(io, data.keep, data.room);
    });

    socket.on("new_round_client", (room_id) => {
      let room = rooms.filter(room => room["room_id"] == room_id)[0];
      let clients = room["clients"];
      room["num_ready"]++;
      if (room["num_ready"] == 2) {
        room["num_ready"] = 0;
        let hasCarrotIndex = flipCoin()
        // Randomly pick who gets the carrot
        clients[hasCarrotIndex]["hasCarrot"] = true;
        clients[hasCarrotIndex ? 0 : 1]["hasCarrot"] = false;
        // Flip peeker
        clients[0]["isPeeker"] = !clients[0]["isPeeker"]
        clients[1]["isPeeker"] = !clients[1]["isPeeker"]
        let player_data = clients.map(client => removeId(client));
        io.to(data.room).emit("new_round_server", player_data);

        // Set timer
        if (room["timer"]) {
          clearInterval(room["timer"]);
        }
        room["timer"] = setInterval(() => {
          updateTimer(io, room_id, room);
        }, 1000);
      }
    });
  });

  socket.on("disconnect", () => {
    for (let i = 0; i < rooms.length; i++) {
      let room = rooms[i];
      for (let j = 0; j < room["clients"].length; j++) {
        let client = room["clients"][j];
        if (client["client_id"] == socket.id) {
          room["clients"].splice(j, 1);
          break;
        }
      }
      if (room["clients"].length === 0) {
        clearInterval(room["timer"]);
        rooms.splice(i, 1);
      }
    }
  });
});