const app = require('express')();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origins: ['http://localhost:4200']
    }
});

app.get('/', (req, res) => {
    res.send('<span> Hello world </span>');
});

const DEFAULT_GAME_PORT = 3000;
const users = new Map();
let userId = 1; // MUST start at 1

// --== SETTINGS ==--

const settings = {
    initialBudget: 10000
};

// --== GAME ==--

const questions = [

];

let questionIndex = 0;
let hintIndex = 0;

const game = {

    stage: 0,
    players: []

};

// === Object Factories ===

function newQuestion(question, hint0, hint1, solution) {
    return { question, hint0, hint1, solution };
}

function newPlayer(id, name, moderator) {
    return {
        id: id,
        username: name,
        moderator: moderator,

        money: settings.initialBudget,
        currentBid: null,
        guess: null
    };
}

function log(fmt, ...args) {

}

// -----------

class GameProperty {

    static PLAYER_MONEY = "player_money";

}

class GameState {

    static IDLE = "IDLE";
    static STARTING = "STARTING";
    static RUNNING = "RUNNING";

}

class PacketId {

    static COLLECT_GUESSES = "collect-guesses";
    static SUBMIT_GUESS = "submit-guess";

    static GAME_OVERVIEW = 'game-overview';

    // -- MODERATOR & STATE

    static SET_GAME_STAGE = 'set-game-stage';
    static LOAD_QUESTION = 'load-question';
    static RELOAD_QUESTION = 'reload-question'; // @SendOnly
    static NEXT_HINT = 'next-hint';

    // -- PLAYER ACTIONS

    static PLAYER_CONNECTION = 'player-connection';
    static PLAYER_DISCONNECTION = 'player-disconnection'; // iskick: boolean, reason: string

    static SET_GUESS = 'set-guess'; // guess: string // Validity should be checked on client
    static SET_BID = 'set-bid'; // bid: number // Validity should be checked on client

}

/*****************************************************
 * Handlers
 *****************************************************/

class Exception {

    _message = null;

    constructor(message) {
        this._message = message;
    }

}

const Game = {

    config: {},

    state: GameState.IDLE,
    players: [],

    question: {},

    /***********************************
     * State
     ***********************************/

    start: function () {
        if (this.state !== GameState.IDLE) {
            throw new Exception("Game is not in idle state.");
        }

        this.reset();
    },

    reset: function () {
        this.players.forEach(p => {
            p.money = this.config[GameProperty.PLAYER_MONEY];
            p.currentBid = 0;
            p.guess = null;
        });

        this.question = {};
    },

    /***********************************
     * Player
     ***********************************/

    playerBySocket: function (id) {
        return this.players.find(p => p.socket.id === id);
    },

    playerByName: function (name) {
        return this.players.find(p => p.username === name);
    },

    join: function(player) {
        if (this.playerByName(player.username)) {
            throw new Exception(`Player ${ player.username } is already connected.`);
        }

        // Game is running -> spectator
        if (this.state !== GameState.IDLE) {
            player.spectator = true;
        }

        this.players.push(player);
    },

    disconnect: function (socketId) {
        const user = Game.playerBySocket(socketId);

        if (user) {
            this.players = this.players.filter(x => x.socket.id === socketId);

            // TODO: money ?
            // TODO: stop game?
            // TODO: reconnectable?

            log(`User ${ user.username } disconnected.`);
        } else {
            log(`Socket ${ socketId } disconnected. No players was assigned to that.`);
        }
    },

    setMoney: function (player, amount) {
        this.playerByName(player)?.money = amount;
    }

};

class UserSession {

    socket = null;

    constructor(socket) {
        this.socket = socket;
        this.handlePackets();
    }

    handlePackets() {
        this.socket.on('disconnect', () => Game.disconnect(this.socket.id));
    }

}

const Network = {

    sessions: [],

    init: async function () {
        return new Promise((res, rej) => {
            io.on('connection', (socket) => {
                this.sessions.push(new UserSession(socket));
                this.socket.on('disconnect', () => {
                    this.sessions = this.sessions.filter(s => s.socket.id !== socket.id);
                });

                res();
            });
        });
    },

    sync: function () {
        this.socket.emit();
    }

};

async function init() {
    await Network.init();

    console.log("[Net] Running system for game interaction.");
}

function main() {
    const args = process.argv.slice(2); // 0 - node, 1 - server.js

    if (args.length === 0) {
        console.log("Error: enter port as argument!");
    } else {
        const port = args[0];

        console.log("Welcome to Quizpoker!");

        readInQuestions('questions.txt');
        startServer(port);
    }
}

function nextQuestion() {
    questionIndex++;
}

function startServer(port) {
    io.on('connection', (socket) => {
        console.log('A user connected from socket', socket.handshake.address);

        function sendGameState() {
            socket.emit('game-overview', game);
        }

        socket.onAny((event, ...args) => {
            const user = users.get(socket.id);

            console.log(`<${ user ? user.username : socket.handshake.address }> => ${event}`, args);
        });

        if (!users.has(socket.id)) {
            const id = userId++;
            const username = socket.handshake.headers['username'];
            const forcemod = socket.handshake.headers['moderator'];
            const user = { id: id, username: username, moderator: (forcemod !== undefined && forcemod === true) || id === 1 };

            users.set(socket.id, user);
            game.players.push(user);

            console.log("<" + socket.handshake.address + "> Connected client", user);

            io.emit('player-connection', newPlayer(user.id, user.username, user.moderator));
            socket.emit('connection-success', user);
            sendGameState();
        } else {
            console.log("Connection refused: already connected");

            socket.emit('connection-refused', 'already connected');
        }

        let handleTransaction = (token, id, data) => {
            if (id === 'test') {
                socket.emit('transaction', { token: token, id: id, data: 'Hello' + data });
            }
        };

        // <> =========================== <>

        socket.on('reset', () => {
            game.stage = 0;

        });

        socket.on('set-game-stage', stage => {
            console.log('[Game] Stage =', stage);

            game.stage = stage;

            io.emit('set-game-stage', stage);
        });

        socket.on('load-question', () => {
            if (questions.length === questionIndex) {
                io.emit('load-question', null);
            } else {
                io.emit('load-question', questions[questionIndex++]);
            }

            hintIndex = 0;
        });

        socket.on('reload-question', () => {
            if (questionIndex > 0) {
                hintIndex = 0;
                io.emit('next-hint', hintIndex);
                io.emit('load-question', questions[questionIndex - 1]);
            } else {
                io.emit('load-question', null);
            }
        });

        socket.on('next-hint', () => {
            return io.emit('next-hint', hintIndex++);
        });

        // ---

        socket.on('transaction', data => {
            const token = data.token;
            const id = data.id;
            const body = data.body;

            console.log(`Transaction [${token}] '${id}' ->`, body);

            handleTransaction(token, id, body);
        });

        socket.on('disconnect', () => {
            const user = users.get(socket.id);

            if (user) {
                console.log(`User ${ user.username } disconnected!`);

                game.players = game.players.reduce(u => u.id === user.id);
            } else {
                console.log('A user disconnected!');
            }

            users.delete(socket.id);
        });
    });

    http.listen(port, () => {
        console.log('Listening on ' + port);
    });
}

// -- Game functions

function readInQuestions(filename) {
    // File Format:
    // CSV: question; hint 0; hint 1; answer

    questions.push(newQuestion(
        'Wie viele Chromosomenpaare hat der Mensch?',
        'Mehr als Planeten in unserem Sonnensystem.',
        'Weniger als Rückenwirbel des Menschen.',
        '23'
    ));
}

main();
