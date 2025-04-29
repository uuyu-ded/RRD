
const socket = io();

function createRoom() {
    try {
        const playerName = document.getElementById('playerName').value;
        const roomCode = generateRoomCode();
        const selectedCharacter = characters[selectedCharacterIndex];
        
        console.log('Creating room with:', { playerName, roomCode, selectedCharacter });
        
        if (!playerName || !selectedCharacter) {
            alert('Please enter your name and select a character.');
            return;
        }

        socket.emit('createRoom', { 
            playerName, 
            roomCode, 
            character: {
                id: selectedCharacter.id,
                name: selectedCharacter.name,
                image: selectedCharacter.image
            }
        });
    } catch (error) {
        console.error('Error in createRoom:', error);
        alert('Error creating room: ' + error.message);
    }
}

function joinRoom() {
    const roomCode = document.getElementById('roomCode').value;
    const playerName = document.getElementById('playerName').value;
    const selectedCharacter = characters[selectedCharacterIndex];
    
    if (!roomCode || !playerName || !selectedCharacter) {
        alert('Please enter a room code, your name, and select a character.');
        return;
    }

    // Emits the joinRoom event to the server
    socket.emit('joinRoom', { 
        roomCode, 
        playerName, 
        selectedCharacter: {
            id: selectedCharacter.id,
            name: selectedCharacter.name,
            image: selectedCharacter.image
        },
        selectedCharacterImage: selectedCharacter.image // Use the full image path from characters array
    }, (response) => {
        if (response.success) {
            window.location.href = `draw.html?room=${roomCode}`;
        } else {
            alert(response.error || 'Failed to join room');
        }
    });
    
    closeJoinRoomModal();
}

socket.on('roomJoined', (room) => {
    // Updates the player list for everyone in the room
    updatePlayerList(room.players);
});

socket.on('playerJoined', (player) => {
    // Adds the new player to the list
    const playersList = document.getElementById('playersList');
    const playerElement = document.createElement('div');
    playerElement.innerHTML = `
        <img src="${player.characterImage}" alt="${player.character}" style="width:50px;height:50px;margin-right:10px;">
        <p>${player.name}</p>
    `;
    playerElement.style.display = 'flex';
    playerElement.style.alignItems = 'center';
    playerElement.style.marginBottom = '10px';
    playersList.appendChild(playerElement);
});


// Listens for room creation success
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
    //alert("Memory game completed!");
    window.location.href = `draw.html?room=${roomCode}`;
});

// Utility function to generate room code
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}
