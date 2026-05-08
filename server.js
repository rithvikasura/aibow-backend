const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Memory databases (In production, use MongoDB)
let users = {}; // { username: { password, security... } }
let sessions = {}; // { sessionId: username }
let groups = {}; // { groupId: { admin, users: [], messages: [] } }

// --- AUTH APIS ---

// Register
app.post('/api/register', (req, res) => {
    const { username, password, securityQ1, securityA1, securityQ2, securityA2 } = req.body;
    if (users[username]) return res.json({ success: false, message: "User already exists" });
    
    users[username] = { password, securityQ1, securityA1, securityQ2, securityA2 };
    res.json({ success: true });
});

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (users[username] && users[username].password === password) {
        const sessionId = uuidv4();
        sessions[sessionId] = username;
        res.json({ success: true, sessionId, username });
    } else {
        res.json({ success: false, message: "Invalid username or password" });
    }
});

// Verify Session
app.post('/api/verify', (req, res) => {
    const { sessionId } = req.body;
    if (sessions[sessionId]) {
        res.json({ valid: true, username: sessions[sessionId] });
    } else {
        res.json({ valid: false });
    }
});

// Search User Existence
app.get('/user-exists', (req, res) => {
    const { username } = req.query;
    res.json({ exists: !!users[username] });
});

// Logout
app.post('/api/logout', (req, res) => {
    const { sessionId } = req.body;
    delete sessions[sessionId];
    res.json({ success: true });
});

// --- SOCKET.IO LOGIC ---

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('create-group', ({ userId }) => {
        const id = Math.random().toString(36).substring(2, 8).toUpperCase();
        groups[id] = { admin: socket.id, users: [{id: socket.id, name: userId}], messages: [] };
        socket.join(id);
        socket.emit('group-created', id);
        io.to(id).emit('online-users', groups[id].users);
    });

    socket.on('join-group', ({ groupId, userId }) => {
        if (groups[groupId]) {
            groups[groupId].users.push({id: socket.id, name: userId});
            socket.join(groupId);
            socket.emit('joined-group', groupId);
            socket.emit('old-messages', groups[groupId].messages);
            io.to(groupId).emit('online-users', groups[groupId].users);
        }
    });

    socket.on('play-video', ({ groupId, videoId }) => {
        if (groups[groupId]) {
            io.to(groupId).emit('sync-video', { videoId });
        }
    });

    socket.on('send-message', ({ groupId, msg }) => {
        if (groups[groupId]) {
            groups[groupId].messages.push(msg);
            socket.to(groupId).emit('new-message', msg);
        }
    });

    socket.on('disconnect', () => {
        // Cleanup online users from groups
        for (let id in groups) {
            groups[id].users = groups[id].users.filter(u => u.id !== socket.id);
            io.to(id).emit('online-users', groups[id].users);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
