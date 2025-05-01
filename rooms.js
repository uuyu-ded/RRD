import mongoose from 'mongoose';
delete mongoose.connection.models['Room'];

const playerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    character: {
        id: { type: String, required: true },
        name: { type: String, required: true },
        image: { type: String, required: true }
    }
});

const roundSchema = new mongoose.Schema({
    prompts: { type: Map, of: String }, // playerName -> prompt
    drawings: { type: Map, of: String }, // playerName -> drawingDataURL
    guesses: { type: Map, of: String }   // playerName -> guess
});

const roomSchema = new mongoose.Schema({
    roomCode: { type: String, required: true, unique: true },
    players: [playerSchema],
    mode: { 
        type: String, 
        default: 'prompt',
        enum: ['prompt', 'copycat'] 
    },
    status: { 
        type: String,
        default: 'waiting',
        enum: ['waiting', 'writing', 'drawing', 'guessing', 'completed', 'prompt', 'viewing']
    },
    currentRound: { type: Number, default: 0 },
    maxRounds: { type: Number, default: 0 }, // Will be calculated based on players
    rounds: [roundSchema],
    currentPromptAssignments: { type: Map, of: String },
    currentDrawingAssignments: { type: Map, of: String }
}, { timestamps: true });

// Create and export the Room model
const Room = mongoose.model('Room', roomSchema);

export { Room };