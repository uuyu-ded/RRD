import mongoose from 'mongoose';

const playerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    character: { type: String, required: true }, // Character name (e.g., character1)
    characterImage: { type: String, required: true }, // Character image path (e.g., images/character1.png)
    currentDrawing: { type: String }, // Base64 encoded drawing
});

const roomSchema = new mongoose.Schema({
    roomCode: { type: String, required: true, unique: true },
    players: [playerSchema], // Array of players with their names, characters, and character images
    mode: { type: String, default: 'prompt' }, // Default game mode
    prompts: { type: [String], default: [] }, // Array of prompts submitted by players
    status: { type: String,
            default: 'waiting',
            enum: ['waiting', 'prompt', 'drawing', 'viewing', 'completed']}, // Current status of the room (waiting, prompt, drawing, completed)
            
    currentPrompt: { type: String, default: '' }, // Current prompt being used in the drawing phase
    currentRound: { type: Number, default: 1 },
    maxRounds: { type: Number, default: 3 }, // Default to 3 rounds
    drawings: { type: Map, of: String }, // Store drawings by player name for swapping
},{ timestamps: true });

export default mongoose.model('Room', roomSchema);