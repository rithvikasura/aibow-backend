const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors());
app.get('/', (req, res) => res.send('Aibow Backend Live'));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const groups = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('create-group', ({ userId }) => {
    const groupId = Math.random().toString(36).substring(2, 8).toUpperCase();
    groups.set(groupId, {
      admin: socket.id,
      users: [{ id: socket.id, name: userId }],
      messages: [],
      currentVideo: 'dQw4w9WgXcQ'
    });
    socket.join(groupId);
    socket.emit('group-created', groupId);
    console.log('Group created:', groupId, 'by', userId);
  });
  
  socket.on('join-group', ({ groupId, userId }) => {
    const group = groups.get(groupId);
    if (group) {
      group.users.push({ id: socket.id, name: userId });
      socket.join(groupId);
      socket.emit('joined-group', groupId);
      socket.emit('old-messages', group.messages);
      if (group.currentVideo) socket.emit('sync-video', { videoId: group.currentVideo });
      // Send updated online users list to everyone in the room
      const userList = group.users.map(u => u.name);
      console.log('Online users in', groupId, ':', userList);
      io.to(groupId).emit('online-users', userList);
      socket.emit('admin-status', group.admin === socket.id);
    } else {
      socket.emit('error', 'Group not found');
    }
  });
  
  socket.on('send-message', ({ groupId, msg }) => {
    const group = groups.get(groupId);
    if (group) {
      group.messages.push(msg);
      io.to(groupId).emit('new-message', msg);
    }
  });
  
  socket.on('play-video', ({ groupId, videoId }) => {
    const group = groups.get(groupId);
    if (group && group.admin === socket.id) {
      group.currentVideo = videoId;
      io.to(groupId).emit('sync-video', { videoId });
    }
  });
  
  socket.on('check-admin', ({ groupId }) => {
    const group = groups.get(groupId);
    if (group) socket.emit('admin-status', group.admin === socket.id);
  });
  
  socket.on('leave-group', ({ groupId }) => {
    const group = groups.get(groupId);
    if (group) {
      group.users = group.users.filter(u => u.id !== socket.id);
      const userList = group.users.map(u => u.name);
      io.to(groupId).emit('online-users', userList);
      socket.leave(groupId);
      if (group.users.length === 0) {
        groups.delete(groupId);
        console.log('Group deleted:', groupId);
      }
    }
  });
  
  socket.on('close-group', ({ groupId }) => {
    const group = groups.get(groupId);
    if (group && group.admin === socket.id) {
      io.to(groupId).emit('group-closed');
      groups.delete(groupId);
      console.log('Group closed by admin:', groupId);
    }
  });
  
  socket.on('rename-user', ({ groupId, oldName, newName }) => {
    const group = groups.get(groupId);
    if (group) {
      const user = group.users.find(u => u.name === oldName);
      if (user) user.name = newName;
      const userList = group.users.map(u => u.name);
      io.to(groupId).emit('online-users', userList);
    }
  });
  
  socket.on('rejoin-group', ({ groupId, userId }) => {
    const group = groups.get(groupId);
    if (group) {
      const existing = group.users.find(u => u.id === socket.id);
      if (!existing) {
        group.users.push({ id: socket.id, name: userId });
        socket.join(groupId);
      }
      socket.emit('joined-group', groupId);
      socket.emit('old-messages', group.messages);
      if (group.currentVideo) socket.emit('sync-video', { videoId: group.currentVideo });
      const userList = group.users.map(u => u.name);
      io.to(groupId).emit('online-users', userList);
      socket.emit('admin-status', group.admin === socket.id);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (const [groupId, group] of groups.entries()) {
      const userExists = group.users.some(u => u.id === socket.id);
      if (userExists) {
        group.users = group.users.filter(u => u.id !== socket.id);
        const userList = group.users.map(u => u.name);
        io.to(groupId).emit('online-users', userList);
        if (group.users.length === 0) {
          groups.delete(groupId);
          console.log('Group deleted (empty):', groupId);
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
