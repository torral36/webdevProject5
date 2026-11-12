// Intro to Web Dev - Project 5
const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serves the html, css, js and the .glb files from the public folder
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.redirect("/BabylonJS_glb.html"));

// ADDED: list of the .glb files in the public folder, used by the host's dropdown menu.
// Only .glb files are returned, so the html/css/js files in public/ never show up.
app.get("/models", (req, res) => {
    fs.readdir(path.join(__dirname, "public"), (err, files) => {
        if (err) {
            return res.status(500).json({ error: "Could not read public folder" });
        }
        res.json(files.filter(f => f.toLowerCase().endsWith(".glb")).sort());
    });
});

// SCENE STATE (authoritative; model info only, never the glb data)
let sceneState = {
    models: []
};
let host = null;

// SEND SCENE STATE TO EVERYONE
function broadcastState() {
    const payload = JSON.stringify({
        type: "state", sceneState
    });

    // Loop through clients, call lambda expression with each client
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

wss.on("connection", ws => {
    // First client to connect is the host, everyone after is a spectator
    if (host === null) {
        host = ws;
        ws.send(JSON.stringify({ type: "role", role: "host" }));
    } else {
        ws.send(JSON.stringify({ type: "role", role: "spectator" }));
    }
    console.log("Client connected. Role:", ws === host ? "host" : "spectator");

    // Send the current scene so late joiners see what is already loaded
    ws.send(JSON.stringify({ type: "state", sceneState }));

    ws.on("message", message => {
        const data = JSON.parse(message);

        if (data.type === "loadModel") {
            if (ws !== host) {
                return;   // only the host may add models
            }
            sceneState.models.push({
                id: data.id,
                fileName: data.fileName,
                position: data.position
            });
            broadcastState();
        }
    }); // end of ws.on("message", message => {

    ws.on("close", () => {
        if (ws === host) {
            host = null;   // the next client to connect becomes the host
            console.log("Host disconnected");
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
