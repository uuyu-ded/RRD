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
        enum: ['prompt', 'telephone'] 
    },
    status: { 
        type: String,
        default: 'waiting',
        enum: ['waiting', 'writing', 'drawing', 'guessing', 'completed']
    },
    currentRound: { type: Number, default: 0 },
    maxRounds: { type: Number, default: 3 },
    rounds: [roundSchema], // Stores data for each round
    currentPromptAssignments: { type: Map, of: String }, // playerName -> prompt
    currentDrawingAssignments: { type: Map, of: String } // playerName -> drawingDataURL
}, { timestamps: true });