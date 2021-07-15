const express = require("express");
const socketIO = require("socket.io");
const cors = require("cors");
const e = require("cors");

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
    origin: "https://carrot-in-a-box.netlify.app/",
    credentials: true
  }
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

let rooms = []

io.on("connection", (socket) => {
  socket.on("join_room", (data) => {
    socket.join(data.room);
    io.to(data.room).emit("joined_room", data.username);
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
        num_ready: 0
      })
    } else {
      ourRoom = filteredRooms[0]
      let clients = ourRoom["clients"]
      clients.push(newUser);
      if (clients.length === 2) {
        // Choose peeker and carrot-haver
        clients[flipCoin()]["isPeeker"] = true;
        clients[flipCoin()]["hasCarrot"] = true;

        let player_data = clients.map(client => removeId(client));
        io.to(data.room).emit("game_ready", player_data);
      }
    }

    socket.on("choose_box", async (data) => {
      let message = data.keep ? `${data.username} chose to keep their box!` : `${data.username} chose to swap their box!`
      await io.to(data.room).emit('log_event', message);
      let clients = rooms.filter(room => room["room_id"] == data.room)[0]["clients"];
      let player_index = clients[0]["client_id"] == socket.id ? 0 : 1;
      let opponent_index = player_index ? 0 : 1;
      let player = clients[player_index];
      let opponent = clients[opponent_index];
      let won = (player["hasCarrot"] && data.keep) || (!player["hasCarrot"] && !data.keep)
      if (won) {
        player["score"]++;
      } else {
        opponent["score"]++;
      }
      io.to(player["client_id"]).emit("game_update", {won: won, scores: [player["score"], opponent["score"]]});
      io.to(opponent["client_id"]).emit("game_update", {won: !won, scores: [opponent["score"], player["score"]]});
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
        rooms.splice(i, 1);
      }
    }
  });
});