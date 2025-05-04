const socket = io({
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    autoConnect: true
});
let isConnected = false;
let connectionState = 'disconnected';
socket.on('connect', () => {
    console.log('Connected to server');
    isConnected = true;
    
    // Join room if we have a room code
    const roomCode = localStorage.getItem('roomCode');
    if (roomCode) {
        socket.emit('joinSocketRoom', roomCode);
    }
});
socket.on('connect_error', (error) => {
    console.error('Connection Error:', error);
    alert('Failed to connect to server. Please refresh the page.');
});

socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
    isConnected = false;
    if (reason === 'io server disconnect') {
        // Server intentionally disconnected, try to reconnect
        console.log('Server initiated disconnect - attempting to reconnect');
        socket.connect();
    }
});

socket.on('reconnect_attempt', (attempt) => {
    connectionState = 'reconnecting';
    console.log(`Reconnection attempt ${attempt}`);
});

socket.on('reconnect_failed', () => {
    connectionState = 'failed';
    alert('Failed to reconnect to server. Please refresh the page.');
});

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

    socket.emit('joinRoom', { 
        roomCode, 
        playerName, 
        selectedCharacter: {
            id: selectedCharacter.id,
            name: selectedCharacter.name,
            image: selectedCharacter.image
        }
    }, (response) => {
        if (response.success) {
            localStorage.setItem('playerName', playerName); // Store name
            localStorage.setItem('roomCode', roomCode); // Also store room code
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

// Change the playerJoined handler to:
socket.on('playerJoined', (player) => {
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
    
    const emptyMessage = playersList.querySelector('.empty-message');
    if (emptyMessage) {
        playersList.removeChild(emptyMessage);
    }
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