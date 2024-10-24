const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

// Create Express app
const app = express();

// Create HTTP server
const server = http.createServer(app);

// Setup Socket.io with fallback for long polling
const io = socketIo(server, {
  transports: ['websocket', 'polling'] // Support WebSockets and fallback to long polling
});

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Handle socket connection
io.on('connection', (socket) => {
  console.log('A user connected');

  // Emit a "hello" event to the client
  socket.emit('hello', 'Hello World from the server!');

  // Listen for disconnects
  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
