const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

io.on("connection", (socket) => {
  socket.emit("hello", { connected: true });
});

app.use("/api/config", require("./routes/config")(io));
app.use("/api/business", require("./routes/business")(io));
app.use("/api/health", require("./routes/health")(io));
app.use("/api/pet", require("./routes/pet")(io));
app.use("/api/budget", require("./routes/budget")(io));

app.get("/api/ping", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`NEXUS Ecosystem server running on port ${PORT}`);
});
