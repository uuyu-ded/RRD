const socket = io();

function createRoom() {
    const playerName = document.getElementById('playerName').value;
    const roomCode = generateRoomCode(); //unique room code
    const selectedCharacter = characters[selectedCharacterIndex]; 
    const selectedCharacterImage = `/images/${selectedCharacter}.png`; //character image path

    if (!playerName || !selectedCharacter) {
        alert('Please enter your name and select a character.');
        return;
    }

    // Emit the createRoom event to the server
    socket.emit('createRoom', { playerName, roomCode, selectedCharacter, selectedCharacterImage });
}

function joinRoom() {
    const roomCode = document.getElementById('roomCode').value;
    const playerName = document.getElementById('playerName').value;
    const selectedCharacter = characters[selectedCharacterIndex];
    const selectedCharacterImage = `/images/${selectedCharacter}.png`;

    if (!roomCode || !playerName || !selectedCharacter) {
        alert('Please enter a room code, your name, and select a character.');
        return;
    }

    // Emit the joinRoom event to the server
    socket.emit('joinRoom', { roomCode, playerName, selectedCharacter, selectedCharacterImage });
    closeJoinRoomModal(); // Close the modal after joining the room
}

// Listen for room creation success
socket.on('roomCreated', (room) => {
    //alert('Room created with code: ' + room.roomCode);
    // Redirect to the room page with the room code in the URL
    window.location.href = `draw.html?room=${room.roomCode}`;
});

// Listen for room errors
socket.on('roomError', (error) => {
    alert(error);
});

socket.on('memoryGameStarted', ({ round, maxRounds }) => {
    console.log(`Memory game started - Round ${round} of ${maxRounds}`);
    // You might want to show a notification or update UI
});

socket.on('startViewing', ({ round, drawings }) => {
    console.log(`Viewing phase started for round ${round}`);
    // Handle viewing phase (show drawings to memorize)
});

socket.on('nextMemoryRound', ({ round, playerOrder }) => {
    console.log(`Starting round ${round}`);
    // Update UI or show notification
});

socket.on('memoryGameCompleted', () => {
    alert("Memory game completed!");
    window.location.href = `draw.html?room=${roomCode}`;
});

// Utility function to generate room code
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}