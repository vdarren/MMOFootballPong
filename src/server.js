/**
 * The Server namespace
 */
var Server = (function(){

    var PORT = 8080,

        START_MSG = "GAME_START",
        CREATE_ROOM = "CREATE_ROOM",
        JOIN_ROOM = "JOIN_ROOM",
        LEAVE_ROOM = "LEAVE_ROOM",
        POSITION = "POSITION",
        SCORE = "SCORE",

        express = require('express'),
        app = express(),
        http = require('http').Server(app),
        io = require('socket.io')(http),

        /* keep all connected players */
        players = [],

        /* Keep all running games */
        games = {},

        nicknames=[],

        /**
         * Connection server answer
         */
        serverAnswer = function(req, res) {

            // Send HTML headers and message
            res.header("Access-Control-Allow-Origin", "*")
            res.sendFile(__dirname + '/index.html');
        },


        /**
         * Callback of messages sent by players
         */
        msgFromPlayer = function(message, player) {

            if (message.hasOwnProperty("type")) {

                switch (message.type) {

                    case START_MSG:
                        if(message.hasOwnProperty("room")) {
                            startGameAtRoom(message);
                        }
                        break;

                    case CREATE_ROOM:
                        if(message.hasOwnProperty("room")) {
                            createRoom(message.room, this);
                        }
                        break;

                    case JOIN_ROOM:
                        if(message.hasOwnProperty("room")) {
                            joinRoom(message.room, this);
                        }
                        break;

                    case POSITION:
                        if(message.hasOwnProperty("position")) {
                            sendPosition(message, this);
                        }
                        break;

                    case SCORE:
                        if(message.hasOwnProperty("me")) {
                            playerScore(message, this);
                        }
                        break;

                    default:
                        console.error("Unrecognized message: " + message);
                        break;
                }
            }
        },

        /**
         * Starts the game at room sending the start message to all players
         */
        startGameAtRoom = function (message) {

            if(roomHasPlayers(message.room)) {
                sendAll(message);
                console.log("Started game room: " + message.room);
            }
        },

        /**
         * Create a new game room
         */
        createRoom = function (room, player) {

            var responseData = {
                type: CREATE_ROOM,
                ack: false,
            };

            if(!games.hasOwnProperty(room) && knownClient(player)) {
                games[room] = {
                    player1: player,
                    player2: null,
                    scoreTransaction: {
                        onGoing: false,
                        playerID: null,
                    },
                };

                responseData.ack = true;
                player.nodePongRoom = room;
                player.nodePongScore = 0;
            }

            if(responseData.ack) {
                console.log("Created game room: " + room);
            }
            player.send(responseData);
        },

        /**
         * Join an existing room
         */
        joinRoom = function (room, player) {

            var responseData = {
                type: JOIN_ROOM,
                ack: false,
            }

            if(games.hasOwnProperty(room) && knownClient(player)) {

                games[room].player2 = player;
                responseData.ack = true;
                player.nodePongRoom = room;
                player.nodePongScore = 0;
            }

            if(responseData.ack) {
                console.log("Player " + player.id + " joined room " + room);
            }
            player.send(responseData);
        },

        /**
         * Checks if room has all users to continue a game
         */
        roomHasPlayers = function (room) {

            if(typeof room !== "string") {
                console.error("Wrong type for parameter room. Must be string");
            }

            if(games.hasOwnProperty(room)) {
                if(games[room].player1 && games[room].player2) {
                    return true;
                }
            }
            return false;
        },

        /**
         * Notifies opponent with message
         */
        notifyOpponent = function (room, player, message) {

            var opponent = games[room].player2;
            if(games[room].player2 == player) {
                opponent = games[room].player1;
            }

            opponent.send(message);
        },

        /**
         * Sends positions of one player to another
         */
        sendPosition = function (message, player) {

            var room = player.nodePongRoom;
            if(games.hasOwnProperty(room)) {

                if(roomHasPlayers(room)) {
                    notifyOpponent(room, player, message);
                }
            }
        },

        /**
         * Set or update player score using a transaction
         */
        playerScore = function (msg, player) {

            var room = player.nodePongRoom;
            if(games.hasOwnProperty(room)) {

                if(roomHasPlayers(room)) {

                    var opponent = games[room].player2;
                    if(games[room].player2 == player) {
                        opponent = games[room].player1;
                    }

                    var transaction = games[room].scoreTransaction;
                    if(transaction.onGoing) {
                        if(msg.me) {
                            if(player.id == transaction.playerID) {
                                player.nodePongScore++;
                            }
                        } else {
                            if(opponent.id == transaction.playerID) {
                                opponent.nodePongScore++;
                            }
                        }

                        player.send({
                            type: SCORE,
                            mine: player.nodePongScore,
                            opponent: opponent.nodePongScore,
                        });

                        opponent.send({
                            type: SCORE,
                            mine: opponent.nodePongScore,
                            opponent: player.nodePongScore,
                        });

                        transaction.onGoing = false;
                        transaction.playerID = null;

                    } else {
                        transaction.onGoing = true;
                        if(msg.me) {
                            transaction.playerID = player.id;
                        } else {
                            transaction.playerID = opponent.id;
                        }

                        /**
                         * We just have started a transaction. 1.5 seconds
                         * counting from now, if the transaction do not end
                         * we stop it.
                         */
                        setTimeout(function () {

                            if(transaction.onGoing) {
                                transaction.onGoing = false;
                                transaction.playerID = null;
                            }
                        }, 1500);
                    }
                }
            }
        },

        /*
         * Broadcast message to all clients
         */
        sendAll = function (msg){

            console.log(
                "Multicasting message: " + msg.type + " to users [" +
                games[msg.room].player1.id + ", " +
                games[msg.room].player2.id + "]"
            );

            games[msg.room].player1.send(msg);
            games[msg.room].player2.send(msg);
        },

        /**
         * Checks if the client is already in the players list
         */
        knownClient = function (client) {

            for(var i=0; i < players.length; i++) {

                if(players[i].id === client.id) {
                    return true;
                }
            }

            return false;
        },

        /**
         * Remove player from room
         */
        leaveRoom = function (room) {

            if(games.hasOwnProperty(room)) {

                if(games[room].player1 == this) {

                    games[room].player1 = null;
                    if(games[room].player2) {
                        games[room].player2.send({
                            type: LEAVE_ROOM,
                        });
                    }

                } else if(games[room].player2 == this) {

                    games[room].player2 = null;
                    if(games[room].player1) {
                        games[room].player1.send({
                            type: LEAVE_ROOM,
                        });
                    }
                }
            }
        },

        /**
         * Remove player from players list
         */
        removePlayerSocket = function (player) {

            var playerIndex = players.indexOf(player);

            if(playerIndex) {
                console.log("Removing player " + player.id + " socket");
                players.splice(playerIndex, 1);
            } else {
                console.log("Player not found in players list");
            }
        },




        /**
         * Client connection callback
         */
        onConnectionCallback = function (client) {

            if(!knownClient(client)) {

                client.on('message', msgFromPlayer);
                client.on('disconnect', onDisconnect);

                players.push(client);
                console.log("Player " + client.id + " connected");
            }
        },

        /**
         * When user disconnects, it sends a notification
         */
        onDisconnect = function () {

            removePlayerSocket(this);
            console.log("Player " + this.id + " disconnected");
            leaveRoom(this.nodePongRoom);
            console.log("Stopped game room " + this.nodePongRoom);
        };

    /**
     * Initialization method. Bind the server and socket events
     */
    (function() {

        app.get("/", serverAnswer);
        app.use(express.static(__dirname + "/"));

        http.listen(PORT, function () {
            console.log([
                "MMO Football Headers on Port: ", PORT,
                "\nPlay with 2 tabs open on: ",
                "localhost:", PORT, " and use connect to join",
                "\n\n "
            ].join(""));
        });

        io.on('connection', onConnectionCallback);
        console.log("New user connected")

    })();

    io.sockets.on('connection', function(socket){

        socket.on('send message', function(data){
            io.sockets.emit('new message', {msg: data, nick: socket.nickname});
        });

        socket.on('disconnect', function(data){
            if(!socket.nickname) return;
            nicknames.splice(nicknames.indexOf(socket.nickname),1);
            io.sockets.emit('usernames', nicknames);
        });
    });


    /* NameSpace Public Methods */
    return {
        server: http
    }
})();