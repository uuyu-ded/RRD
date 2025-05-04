import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import connectDB from './db.js'; // MongoDB connection
import { Room } from './rooms.js'; // Room model 
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
connectDB();

const server = http.createServer(app);
const io = new Server(server); // Initialize socket.io on the server

// Middleware to parse JSON
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    // Don't exit the process, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit the process, just log the error
});

async function rotateDrawings(roomCode) {
    const room = await Room.findOne({ roomCode });
    if (!room || !room.drawings) return;

    const playerNames = room.players.map(p => p.name);
    if (playerNames.length < 2) return;

    // Rotate drawings so each player gets the previous player's drawing
    const newDrawings = new Map();
    for (let i = 0; i < playerNames.length; i++) {
        const prevPlayer = playerNames[(i - 1 + playerNames.length) % playerNames.length];
        newDrawings.set(playerNames[i], room.drawings.get(prevPlayer) || '');
    }

    room.drawings = newDrawings;
    await room.save();
    return room;
}

async function checkAllDrawingsSubmitted(roomCode) {
    const room = await Room.findOne({ roomCode });
    if (!room) return false;

    return room.players.every(player => {
        return room.drawings && room.drawings.has(player.name);
    });
}

// Route to fetch room details
app.get('/getRoomDetails', async (req, res) => {
    const { room } = req.query; // Get room code from query parameters

    if (!room) {
        return res.status(400).json({ success: false, error: 'Room code is required' });
    }

    try {
        const roomDetails = await Room.findOne({ roomCode: room }); // Find room in the database
        if (!roomDetails) {
            return res.status(404).json({ success: false, error: 'Room not found' });
        }

        // Return room details
        res.status(200).json({
            success: true,
            roomCode: roomDetails.roomCode,
            players: roomDetails.players, // Array of players with names and characters
        });
    } catch (error) {
        console.error('Error fetching room details:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Route to start the game
app.post('/startGame', async (req, res) => {
    const { room, mode } = req.body;

    if (!room || !mode) {
        return res.status(400).json({ success: false, error: 'Room code and mode are required' });
    }

    // Validate mode
    if (!['prompt', 'copycat'].includes(mode)) {
        return res.status(400).json({ success: false, error: 'Invalid game mode' });
    }

    try {
        const roomDetails = await Room.findOne({ roomCode: room });
        if (!roomDetails) {
            return res.status(404).json({ success: false, error: 'Room not found' });
        }

        roomDetails.mode = mode;
        
        if (mode === 'copycat') {
            // Initialize memory game specific fields
            roomDetails.status = 'drawing';
            roomDetails.currentRound = 1;
            roomDetails.drawings = new Map();
            await roomDetails.save();
            
            // Notify players to start memory game
            io.to(room).emit('memoryGameStarted', { 
                round: 1,
                maxRounds: roomDetails.maxRounds || 3 // Default to 3 rounds if not set
            });
        } else {
            // Regular prompt mode
            roomDetails.status = 'prompt';
            await roomDetails.save();
            io.to(room).emit('startGame', { mode });
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Detailed error starting game:', {
            error: error.message,
            stack: error.stack,
            room,
            mode
        });
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            details: error.message 
        });
    }
});

// Route to submit a prompt
app.post('/submitPrompt', async (req, res) => {
    const { room, prompt } = req.body;

    if (!room || !prompt) {
        return res.status(400).json({ 
            success: false, 
            error: 'Room code and prompt are required' 
        });
    }

    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
        return res.status(400).json({ 
            success: false, 
            error: 'Prompt must be a non-empty string' 
        });
    }

    try {
        const roomDetails = await Room.findOne({ roomCode: room });
        if (!roomDetails) {
            return res.status(404).json({ 
                success: false, 
                error: 'Room not found' 
            });
        }

        if (!roomDetails.prompts) {
            roomDetails.prompts = [];
        }

        // Add the prompt to the room
        roomDetails.prompts.push(prompt.trim());
        await roomDetails.save();

        // Notify all clients in the room
        io.to(room).emit('promptSubmitted', { 
            count: roomDetails.prompts.length,
            totalPlayers: roomDetails.players.length 
        });

        if (roomDetails.prompts.length >= roomDetails.players.length) {
            // Update room status
            roomDetails.status = 'drawing';
            await roomDetails.save();
            
            // Notify all players to move to canvas
            io.to(room).emit('allPromptsSubmitted');
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Detailed error submitting prompt:', {
            error: error.message,
            stack: error.stack,
            room,
            prompt
        });
        return res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            details: error.message 
        });
    }
});

// Route to get a random prompt
app.get('/getRandomPrompt', async (req, res) => {
    const { room } = req.query;

    if (!room) {
        return res.status(400).json({ success: false, error: 'Room code is required' });
    }

    try {
        const roomDetails = await Room.findOne({ roomCode: room });
        if (!roomDetails) {
            return res.status(404).json({ success: false, error: 'Room not found' });
        }

        // Get a random prompt from the list
        const prompts = roomDetails.prompts || [];
        if (prompts.length === 0) {
            return res.status(404).json({ success: false, error: 'No prompts available' });
        }

        const randomPrompt = prompts[Math.floor(Math.random() * prompts.length)];

        // Update the current prompt and set status to 'drawing'
        roomDetails.currentPrompt = randomPrompt;
        roomDetails.status = 'drawing';
        await roomDetails.save();

        res.status(200).json({ success: true, prompt: randomPrompt });
    } catch (error) {
        console.error('Error fetching prompt:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.post('/submitDescription', async (req, res) => {
    const { room, description, playerName } = req.body;

    if (!room || !description || !playerName) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    try {
        const roomDetails = await Room.findOne({ roomCode: room });
        if (!roomDetails) {
            return res.status(404).json({ success: false, error: 'Room not found' });
        }

        // Store the description
        if (!roomDetails.descriptions) {
            roomDetails.descriptions = new Map();
        }
        roomDetails.descriptions.set(playerName, description);
        await roomDetails.save();

        // Check if all players have submitted descriptions
        if (roomDetails.players.every(p => roomDetails.descriptions.has(p.name))) {
            // All descriptions submitted, rotate prompts
            const playerNames = roomDetails.players.map(p => p.name);
            
            // Create a rotation where:
            // - You don't get your own prompt
            // - You don't get the prompt from someone who described your drawing
            const rotatedPrompts = new Map();
            // Implementation depends on your specific rotation rules
            
            roomDetails.rotatedPrompts = rotatedPrompts;
            roomDetails.status = 'guessing';
            await roomDetails.save();
            
            io.to(room).emit('startGuessing', {
                prompts: Object.fromEntries(rotatedPrompts)
            });
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error submitting description:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.post('/submitMemoryDrawing', async (req, res) => {
    const { room, round, drawing, playerName } = req.body;

    if (!room || !drawing || !playerName) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    try {
        const roomDetails = await Room.findOne({ roomCode: room });
        if (!roomDetails) {
            return res.status(404).json({ success: false, error: 'Room not found' });
        }

        // Update player's current drawing
        const player = roomDetails.players.find(p => p.name === playerName);
        if (player) {
            player.currentDrawing = drawing;
        }

        // Store drawing in the drawings map
        if (!roomDetails.drawings) {
            roomDetails.drawings = new Map();
        }
        roomDetails.drawings.set(playerName, drawing);

        await roomDetails.save();

        // Check if all players have submitted drawings
        if (roomDetails.players.every(p => p.currentDrawing)) {
            // All drawings submitted, start viewing phase
            roomDetails.status = 'viewing';
            await roomDetails.save();
            
            // Notify all players to start viewing
            io.to(room).emit('startViewing', { 
                round: roomDetails.currentRound,
                drawings: Object.fromEntries(roomDetails.drawings)
            });
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error submitting memory drawing:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Route to get drawings for viewing phase
app.get('/getDrawings', async (req, res) => {
    const { room } = req.query;

    if (!room) {
        return res.status(400).json({ success: false, error: 'Room code is required' });
    }

    try {
        const roomDetails = await Room.findOne({ roomCode: room });
        if (!roomDetails) {
            return res.status(404).json({ success: false, error: 'Room not found' });
        }

        res.status(200).json({ 
            success: true, 
            drawings: roomDetails.drawings ? Object.fromEntries(roomDetails.drawings) : {} 
        });
    } catch (error) {
        console.error('Error fetching drawings:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

//for album
app.get('/getAlbumData', async (req, res) => {
    const { room } = req.query;
    
    if (!room) {
        return res.status(400).json({ success: false, error: 'Room code is required' });
    }

    try {
        const roomDetails = await Room.findOne({ roomCode: room });
        if (!roomDetails) {
            return res.status(404).json({ success: false, error: 'Room not found' });
        }

        // Prepare album data
        const albumData = {
            mode: roomDetails.mode,
            players: roomDetails.players.map(p => p.name),
            rounds: []
        };

        if (roomDetails.mode === 'prompt') {
            // For prompt mode, show each player's prompt and the resulting drawings
            for (let i = 0; i < roomDetails.rounds.length; i++) {
                const round = roomDetails.rounds[i];
                albumData.rounds.push({
                    roundNumber: i + 1,
                    prompts: round.prompts ? Object.fromEntries(round.prompts) : {},
                    drawings: round.drawings ? Object.fromEntries(round.drawings) : {},
                    guesses: round.guesses ? Object.fromEntries(round.guesses) : {}
                });
            }
        } else {
            // For memory mode, show all drawings for each round
            for (let i = 0; i < roomDetails.rounds.length; i++) {
                const round = roomDetails.rounds[i];
                albumData.rounds.push({
                    roundNumber: i + 1,
                    drawings: round.drawings ? Object.fromEntries(round.drawings) : {}
                });
            }
        }

        res.status(200).json({ success: true, albumData });
    } catch (error) {
        console.error('Error fetching album data:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Set up socket.io event listeners
io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('startGame', async ({ roomCode, mode }, callback) => {
        try {
            console.log(`Starting game in room ${roomCode} with mode ${mode}`);
            
            const room = await Room.findOne({ roomCode });
            if (!room) {
                callback({ success: false, error: 'Room not found' });
                return;
            }
    
            // Calculate rounds based on player count
            const playerCount = room.players.length;
            const maxRounds = calculateRounds(playerCount); // Helper function defined below
    
            // Update room state
            room.mode = mode;
            room.status = mode === 'copycat' ? 'drawing' : 'prompt';
            room.currentRound = 1;
            room.maxRounds = maxRounds;
            room.drawings = new Map();
            room.prompts = [];
            
            await room.save();
    
            // Notify all players
            io.to(roomCode).emit('gameStarted', { 
                mode,
                currentRound: 1,
                maxRounds,
                playerCount
            });
    
            // Redirect players based on mode
            if (mode === 'copycat') {
                io.to(roomCode).emit('memoryGameStarted', {
                    round: 1,
                    maxRounds
                });
            } else {
                io.to(roomCode).emit('promptPhaseStarted');
            }
    
            callback({ success: true });
        } catch (error) {
            console.error('Error starting game:', error);
            callback({ 
                success: false, 
                error: 'Failed to start game',
                details: error.message
            });
        }
    });

    socket.on('createRoom', async (data) => {
        const { playerName, roomCode, character } = data;
    
        const existingRoom = await Room.findOne({ roomCode });
        if (existingRoom) {
            socket.emit('roomError', 'Room code already exists!');
            return;
        }
    
        const newRoom = new Room({
            roomCode,
            players: [{ 
                name: playerName, 
                character: {
                    id: character.id,
                    name: character.name,
                    image: character.image
                }
            }],
        });
    
        try {
            await newRoom.save();
            socket.emit('roomCreated', newRoom);
            socket.join(roomCode); 
        } catch (error) {
            console.error('Error creating room:', error);
            socket.emit('roomError', 'Error creating room!');
        }
    });

    function calculateRounds(playerCount) {
        if (playerCount <= 3) return 3;
        if (playerCount <= 5) return 2;
        return 1; // For larger groups, do just 1 round to keep game length reasonable
    }

    socket.on('joinRoom', async ({ roomCode, playerName, selectedCharacter }, callback) => {
        try {
            if (!roomCode || !playerName || !selectedCharacter) {
                callback({ success: false, error: 'All fields are required!' });
                return;
            }
    
            const room = await Room.findOne({ roomCode });
            if (!room) {
                callback({ success: false, error: 'Room does not exist!' });
                return;
            }
    
            if (room.players.some(player => player.name === playerName)) {
                callback({ success: false, error: 'Player already in room!' });
                return;
            }
    
            // Adds the player to the room
            const newPlayer = { 
                name: playerName, 
                character: {
                    id: selectedCharacter.id,
                    name: selectedCharacter.name,
                    image: selectedCharacter.image
                }
            };
            room.players.push(newPlayer);
            await room.save();
            // Joins the socket.io room
            socket.join(roomCode);
            socket.playerName = playerName;
            socket.roomCode = roomCode;
            
            // Updates the player list for everyone
            io.to(roomCode).emit('roomUpdated', room);
            callback({ success: true, room });
    
        } catch (error) {
            console.error('Error joining room:', error);
            callback({ success: false, error: 'Error joining room' });
        }
    });

    socket.on('joinSocketRoom', async (roomCode) => {
        console.log(`Player joined socket room: ${roomCode}`);
        socket.join(roomCode);

        // Send current room state to the newly joined client
        const room = await Room.findOne({ roomCode });
        if (room) {
            socket.emit('roomUpdated', room);
        }
    });

    socket.on('disconnect', async () => {
        console.log('A user disconnected');
        
        if (!socket.playerName) return;
        
        try {
            const rooms = await Room.find({ 'players.name': socket.playerName });
            
            for (const room of rooms) {
                // Check if this was the room creator (first player)
                const wasCreator = room.players.length > 0 && room.players[0].name === socket.playerName;
                
                // Remove the player
                room.players = room.players.filter(p => p.name !== socket.playerName);
                
                if (room.players.length === 0 || wasCreator) {
                    // Delete the entire room if empty or if creator left
                    await Room.deleteOne({ roomCode: room.roomCode });
                    console.log(`Room ${room.roomCode} deleted (creator left or room empty)`);
                    
                    // Notify all players in the room that it's being deleted
                    io.to(room.roomCode).emit('roomDeleted', { 
                        reason: wasCreator ? 'creator_left' : 'last_player_left'
                    });
                } else {
                    // Otherwise just save the updated player list
                    await room.save();
                    
                    // Notify remaining players
                    io.to(room.roomCode).emit('playerLeft', { 
                        playerName: socket.playerName,
                        players: room.players 
                    });
                }
            }
        } catch (error) {
            console.error('Error handling disconnect:', error);
        }
    });


socket.on('leaveRoom', async ({ roomCode, playerName }, callback) => {
    try {
        const room = await Room.findOne({ roomCode });
        if (!room) {
            if (callback) callback({ success: false, error: 'Room not found' });
            return;
        }

        // Remove player from room
        room.players = room.players.filter(p => p.name !== playerName);
        
        // Check if room should be deleted
        const wasCreator = room.players.length > 0 && room.players[0].name === playerName;
        let shouldDeleteRoom = wasCreator || room.players.length === 0;

        if (shouldDeleteRoom) {
            await Room.deleteOne({ roomCode });
            io.to(roomCode).emit('roomDeleted', { 
                reason: wasCreator ? 'creator_left' : 'last_player_left'
            });
        } else {
            await room.save();
            io.to(roomCode).emit('playerLeft', {
                playerName,
                players: room.players
            });
        }

        // Leave socket.io room
        socket.leave(roomCode);
        
        if (callback) callback({ success: true });
    } catch (error) {
        console.error('Error leaving room:', error);
        if (callback) callback({ success: false, error: 'Error leaving room' });
    }
});

    socket.on('submitGuess', async ({ roomCode, guess, playerName }, callback) => {
        try {
            const room = await Room.findOne({ roomCode });
            if (!room) {
                callback({ success: false, error: 'Room not found' });
                return;
            }

            // Store the guess
            if (!room.guesses) {
                room.guesses = new Map();
            }
            room.guesses.set(playerName, guess);
            await room.save();

            // Check if all players have submitted guesses
            if (room.players.every(p => room.guesses.has(p.name))) {
                // All guesses submitted, show results
                io.to(roomCode).emit('showResults', {
                    results: collectResults(room) // Implement this function
                });
            }

            callback({ success: true });
        } catch (error) {
            console.error('Error submitting guess:', error);
            callback({ success: false, error: 'Error submitting guess' });
        }
    });

    socket.on('startMemoryGame', async ({ roomCode }) => {
        try {
            const room = await Room.findOne({ roomCode });
            if (!room) {
                socket.emit('error', 'Room not found');
                return;
            }
    
            // Initialize memory game state
            room.status = 'drawing';
            room.currentRound = 1;
            room.drawings = new Map();
            await room.save();
    
            io.to(roomCode).emit('memoryGameStarted', { 
                round: 1,
                maxRounds: room.maxRounds 
            });
        } catch (error) {
            console.error('Error starting memory game:', error);
            socket.emit('error', 'Failed to start memory game');
        }
    });
    
    socket.on('nextMemoryRound', async ({ roomCode }) => {
    try {
        const room = await Room.findOne({ roomCode });
        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }

        // Check if game is complete
        if (room.currentRound >= room.maxRounds) {
            room.status = 'completed';
            await room.save();
            io.to(roomCode).emit('memoryGameCompleted');
            return;
        }

        // Prepare for next round
        room.currentRound += 1;
        room.status = 'drawing';
        room.drawings = new Map();
        await room.save();

        // Determine player order for this round
        const playerNames = room.players.map(p => p.name);
        const rotatedNames = [...playerNames.slice(room.currentRound), ...playerNames.slice(0, room.currentRound)];
        
        io.to(roomCode).emit('nextMemoryRound', { 
            round: room.currentRound,
            playerOrder: rotatedNames,
            totalRounds: room.maxRounds
        });
    } catch (error) {
        console.error('Error advancing memory round:', error);
        socket.emit('error', 'Failed to advance round');
    }
});
    
socket.on('showResults', ({ results }) => {
    // After showing results, redirect to album
    setTimeout(() => {
        io.to(roomCode).emit('redirectToAlbum');
    }, 10000); // 10 seconds delay before redirect
});

// Add this event listener in app.js:
socket.on('redirectToAlbum', () => {
    const roomCode = localStorage.getItem('roomCode');
    window.location.href = `album.html?room=${roomCode}`;
});

socket.on('memoryGameCompleted', () => {
    const roomCode = localStorage.getItem('roomCode');
    window.location.href = `album.html?room=${roomCode}`;
});

});

// Serve static files if you're using Express to serve them
app.use(express.static('public')); // Assuming you have your HTML files in the 'public' folder


// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});