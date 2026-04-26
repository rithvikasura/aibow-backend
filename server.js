const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Store groups
const groups = new Map(); // groupId -> { messages, admin, users, videoId }

// Helper functions
function getGroup(groupId) {
  if (!groups.has(groupId)) {
    groups.set(groupId, {
      messages: [],
      admin: null,
      users: new Set(),
      videoId: null
    });
  }
  return groups.get(groupId);
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create-group', ({ userId }) => {
    const groupId = generateGroupId();
    const group = getGroup(groupId);
    group.admin = userId;
    group.users.add(userId);
    
    socket.join(groupId);
    socket.data.groupId = groupId;
    socket.data.userId = userId;
    
    socket.emit('group-created', groupId);
    io.to(groupId).emit('online-users', Array.from(group.users));
    console.log(`Group created: ${groupId} by ${userId}`);
  });

  socket.on('join-group', ({ groupId, userId }) => {
    if (!groupId) {
      socket.emit('error', 'Invalid group ID');
      return;
    }
    
    const group = getGroup(groupId);
    group.users.add(userId);
    
    socket.join(groupId);
    socket.data.groupId = groupId;
    socket.data.userId = userId;
    
    socket.emit('joined-group', groupId);
    socket.emit('old-messages', group.messages);
    
    // Send current video if exists
    if (group.videoId) {
      socket.emit('sync-video', { videoId: group.videoId });
    }
    
    io.to(groupId).emit('online-users', Array.from(group.users));
    socket.emit('admin-status', group.admin === userId);
    console.log(`${userId} joined group: ${groupId}`);
  });

  socket.on('check-admin', ({ groupId }) => {
    const group = getGroup(groupId);
    socket.emit('admin-status', group.admin === socket.data.userId);
  });

  socket.on('send-message', ({ groupId, msg }) => {
    const group = getGroup(groupId);
    group.messages.push(msg);
    // Keep only last 100 messages
    if (group.messages.length > 100) group.messages.shift();
    io.to(groupId).emit('new-message', msg);
  });

  socket.on('play-video', ({ groupId, videoId }) => {
    const group = getGroup(groupId);
    if (group.admin === socket.data.userId) {
      group.videoId = videoId;
      io.to(groupId).emit('sync-video', { videoId });
    }
  });

  socket.on('typing-start', ({ groupId, user }) => {
    socket.to(groupId).emit('user-typing', { user });
  });

  socket.on('typing-stop', ({ groupId, user }) => {
    socket.to(groupId).emit('user-typing-stop', { user });
  });

  socket.on('rename-user', ({ groupId, oldName, newName }) => {
    const group = getGroup(groupId);
    
    // Update messages
    group.messages.forEach(msg => {
      if (msg.user === oldName) msg.user = newName;
    });
    
    // Update admin if needed
    if (group.admin === oldName) group.admin = newName;
    
    // Update users set
    if (group.users.has(oldName)) {
      group.users.delete(oldName);
      group.users.add(newName);
    }
    
    io.to(groupId).emit('user-renamed', { oldName, newName });
    io.to(groupId).emit('online-users', Array.from(group.users));
  });

  socket.on('leave-group', ({ groupId, userId }) => {
    const group = getGroup(groupId);
    group.users.delete(userId);
    socket.leave(groupId);
    io.to(groupId).emit('online-users', Array.from(group.users));
    
    // If admin leaves, assign new admin
    if (group.admin === userId && group.users.size > 0) {
      const newAdmin = Array.from(group.users)[0];
      group.admin = newAdmin;
      io.to(groupId).emit('admin-status', false);
      io.to(groupId).emit('new-admin', newAdmin);
    }
    
    // Delete group if empty
    if (group.users.size === 0) {
      groups.delete(groupId);
    }
  });

  socket.on('close-group', ({ groupId }) => {
    const group = getGroup(groupId);
    if (group.admin === socket.data.userId) {
      io.to(groupId).emit('group-closed');
      groups.delete(groupId);
    }
  });

  socket.on('rejoin-group', ({ groupId, userId }) => {
    if (groups.has(groupId)) {
      const group = getGroup(groupId);
      group.users.add(userId);
      socket.join(groupId);
      socket.data.groupId = groupId;
      socket.data.userId = userId;
      socket.emit('rejoin-group', groupId);
      socket.emit('old-messages', group.messages);
      io.to(groupId).emit('online-users', Array.from(group.users));
      if (group.videoId) {
        socket.emit('sync-video', { videoId: group.videoId });
      }
    }
  });

  socket.on('disconnect', () => {
    const groupId = socket.data.groupId;
    const userId = socket.data.userId;
    if (groupId && userId && groups.has(groupId)) {
      const group = getGroup(groupId);
      group.users.delete(userId);
      io.to(groupId).emit('online-users', Array.from(group.users));
      
      if (group.users.size === 0) {
        groups.delete(groupId);
      }
    }
    console.log('User disconnected:', socket.id);
  });
});

function generateGroupId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
