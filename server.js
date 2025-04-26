import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import connectDB from './db.js'; // MongoDB connection
import Room from './rooms.js'; // Room model
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

    try {
        const roomDetails = await Room.findOne({ roomCode: room });
        if (!roomDetails) {
            return res.status(404).json({ success: false, error: 'Room not found' });
        }

        roomDetails.mode = mode;
        
        if (mode === 'memory') {
            // Initialize memory game specific fields
            roomDetails.status = 'drawing';
            roomDetails.currentRound = 1;
            roomDetails.drawings = new Map();
            await roomDetails.save();
            
            // Notify players to start memory game
            io.to(room).emit('memoryGameStarted', { 
                round: 1,
                maxRounds: roomDetails.maxRounds 
            });
        } else {
            // Regular prompt mode
            roomDetails.status = 'prompt';
            await roomDetails.save();
            io.to(room).emit('startGame', { mode });
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error starting game:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Route to submit a prompt
app.post('/submitPrompt', async (req, res) => {
    const { room, prompt } = req.body;

    if (!room || !prompt) {
        return res.status(400).json({ success: false, error: 'Room code and prompt are required' });
    }

    try {
        const roomDetails = await Room.findOne({ roomCode: room });
        if (!roomDetails) {
            return res.status(404).json({ success: false, error: 'Room not found' });
        }

        // Add the prompt to the room
        roomDetails.prompts.push(prompt);
        await roomDetails.save();

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error submitting prompt:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
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

// Set up socket.io event listeners
io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('createRoom', async (data) => {
        const { playerName, roomCode, selectedCharacter, selectedCharacterImage } = data;

        // Check if the room already exists
        const existingRoom = await Room.findOne({ roomCode });
        if (existingRoom) {
            socket.emit('roomError', 'Room code already exists!');
            return;
        }

        // Create a new room
        const newRoom = new Room({
            roomCode,
            players: [{ name: playerName, character: selectedCharacter, characterImage: selectedCharacterImage }],
        });

        try {
            await newRoom.save();
            // Emit the roomCreated event with the room details
            socket.emit('roomCreated', newRoom);
            socket.join(roomCode); 
        } catch (error) {
            console.error('Error creating room:', error);
            socket.emit('roomError', 'Error creating room!');
        }
    });

    socket.on('joinRoom', async ({ roomCode, playerName, selectedCharacter, selectedCharacterImage }, callback) => {
        try {
            if (!roomCode || !playerName || !selectedCharacter || !selectedCharacterImage) {
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
                character: selectedCharacter, 
                characterImage: selectedCharacterImage 
            };
            room.players.push(newPlayer);
            await room.save();
    
            // Joins the socket.io room
            socket.join(roomCode);
            socket.playerName = playerName;
            
            // Notifies the joining player
            callback({ success: true, room });
            
            // Notifies all other players in the room
            io.to(roomCode).emit('playerJoined', newPlayer);
            
            // Updates the player list for everyone
            io.to(roomCode).emit('roomUpdated', room);
    
        } catch (error) {
            console.error('Error joining room:', error);
            callback({ success: false, error: 'Error joining room' });
        }
    });
    
    socket.on('joinSocketRoom', (roomCode) => {
        socket.join(roomCode);
        console.log(`Player joined socket room: ${roomCode}`);
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
            room.drawings = new Map(); // Clear previous drawings
            await room.save();
    
            // Rotate drawings between players
            const playerNames = room.players.map(p => p.name);
            const rotatedNames = [...playerNames.slice(1), playerNames[0]];
            
            io.to(roomCode).emit('nextMemoryRound', { 
                round: room.currentRound,
                playerOrder: rotatedNames 
            });
        } catch (error) {
            console.error('Error advancing memory round:', error);
            socket.emit('error', 'Failed to advance round');
        }
    });
    

    // Handle player disconnection
    socket.on('disconnect', async () => {
        console.log('A user disconnected');

        // Find the room the player was in
        const rooms = await Room.find({});
        for (const room of rooms) {
            const playerIndex = room.players.findIndex(player => player.name === socket.playerName);
            if (playerIndex !== -1) {
                // Remove the player from the room
                room.players.splice(playerIndex, 1);
                await room.save();

                // Notify other players in the room that a player has left
                io.to(room.roomCode).emit('playerLeft', { playerName: socket.playerName });

                // If the room is empty, delete it
                if (room.players.length === 0) {
                    await Room.deleteOne({ roomCode: room.roomCode });
                    console.log(`Room ${room.roomCode} deleted because it is empty.`);
                }

                break;
            }
        }
    });
});

// Serve static files if you're using Express to serve them
app.use(express.static('public')); // Assuming you have your HTML files in the 'public' folder


// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});