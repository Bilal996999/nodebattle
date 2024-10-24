var express = require('express');
var app = express();
var fs = require('fs');
var path = require('path');
var Entities = require('html-entities').AllHtmlEntities;
var entities = new Entities();
var BattleshipGame = require('./app/game.js');
var GameStatus = require('./app/gameStatus.js');

var http;
if (process.env.NODE_ENV === 'production') {
  // Use HTTP in production, Vercel will handle SSL
  http = require('http').Server(app);
} else {
  // Use HTTPS locally for development
  var privateKey = fs.readFileSync('key.pem', 'utf8');
  var certificate = fs.readFileSync('cert.pem', 'utf8');
  var credentials = { key: privateKey, cert: certificate };
  http = require('https').createServer(credentials, app);
}

var io = require('socket.io')(http, {
  transports: ['websocket', 'polling'], // Ensure fallback to long-polling in production
});

var port = process.env.PORT || 3000;
var users = {};
var gameIdCounter = 1;

app.use(express.static(path.join(__dirname, 'public')));

// Start the server
http.listen(port, function(){
  console.log('Server listening on *:' + port);
});

// Handle new socket connections
io.on('connection', function(socket) {
  console.log((new Date().toISOString()) + ' ID ' + socket.id + ' connected.');

  // Create user object for additional data
  users[socket.id] = {
    inGame: null,
    player: null
  };

  // Join waiting room until there are enough players to start a new game
  socket.join('waiting room');

  /**
   * Handle chat messages
   */
  socket.on('chat', function(msg) {
    if(users[socket.id].inGame !== null && msg) {
      console.log((new Date().toISOString()) + ' Chat message from ' + socket.id + ': ' + msg);

      // Send message to opponent
      socket.broadcast.to('game' + users[socket.id].inGame.id).emit('chat', {
        name: 'Opponent',
        message: entities.encode(msg),
      });

      // Send message to self
      io.to(socket.id).emit('chat', {
        name: 'Me',
        message: entities.encode(msg),
      });
    }
  });

  /**
   * Handle shot from client
   */
  socket.on('shot', function(position) {
    var game = users[socket.id].inGame, opponent;

    if (game !== null) {
      // Check if it's the current player's turn
      if (game.currentPlayer === users[socket.id].player) {
        opponent = game.currentPlayer === 0 ? 1 : 0;

        if (game.shoot(position)) {
          // Valid shot
          checkGameOver(game);

          // Update game state on both clients
          io.to(socket.id).emit('update', game.getGameState(users[socket.id].player, opponent));
          io.to(game.getPlayerId(opponent)).emit('update', game.getGameState(opponent, opponent));
        }
      }
    }
  });

  /**
   * Handle leave game request
   */
  socket.on('leave', function() {
    if (users[socket.id].inGame !== null) {
      leaveGame(socket);

      socket.join('waiting room');
      joinWaitingPlayers();
    }
  });

  /**
   * Handle client disconnect
   */
  socket.on('disconnect', function() {
    console.log((new Date().toISOString()) + ' ID ' + socket.id + ' disconnected.');

    leaveGame(socket);
    delete users[socket.id];
  });

  joinWaitingPlayers();
});

/**
 * Create games for players in the waiting room
 */
function joinWaitingPlayers() {
  var players = getClientsInRoom('waiting room');

  if (players.length >= 2) {
    // 2 players waiting. Create a new game!
    var game = new BattleshipGame(gameIdCounter++, players[0].id, players[1].id);

    // Create a new room for this game
    players[0].leave('waiting room');
    players[1].leave('waiting room');
    players[0].join('game' + game.id);
    players[1].join('game' + game.id);

    users[players[0].id].player = 0;
    users[players[1].id].player = 1;
    users[players[0].id].inGame = game;
    users[players[1].id].inGame = game;

    io.to('game' + game.id).emit('join', game.id);

    // Send initial ship placements
    io.to(players[0].id).emit('update', game.getGameState(0, 0));
    io.to(players[1].id).emit('update', game.getGameState(1, 1));

    console.log((new Date().toISOString()) + " " + players[0].id + " and " + players[1].id + " have joined game ID " + game.id);
  }
}

/**
 * Leave user's game
 * @param {type} socket
 */
function leaveGame(socket) {
  if (users[socket.id].inGame !== null) {
    console.log((new Date().toISOString()) + ' ID ' + socket.id + ' left game ID ' + users[socket.id].inGame.id);

    // Notify opponent
    socket.broadcast.to('game' + users[socket.id].inGame.id).emit('notification', {
      message: 'Opponent has left the game'
    });

    if (users[socket.id].inGame.gameStatus !== GameStatus.gameOver) {
      // Abort unfinished game
      users[socket.id].inGame.abortGame(users[socket.id].player);
      checkGameOver(users[socket.id].inGame);
    }

    socket.leave('game' + users[socket.id].inGame.id);
    users[socket.id].inGame = null;
    users[socket.id].player = null;

    io.to(socket.id).emit('leave');
  }
}

/**
 * Notify players if game is over
 * @param {type} game
 */
function checkGameOver(game) {
  if (game.gameStatus === GameStatus.gameOver) {
    console.log((new Date().toISOString()) + ' Game ID ' + game.id + ' ended.');
    io.to(game.getWinnerId()).emit('gameover', true);
    io.to(game.getLoserId()).emit('gameover', false);
  }
}

/**
 * Find all sockets in a room
 * @param {type} room
 * @returns {Array}
 */
function getClientsInRoom(room) {
  var roomObj = io.sockets.adapter.rooms[room];
  var clients = [];

  if (roomObj) {
    for (var id of Object.keys(roomObj.sockets)) {
      clients.push(io.sockets.sockets.get(id));
    }
  }
  return clients;
}
