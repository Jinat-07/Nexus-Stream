// --- Application State ---
let peer;
let localStream;
let screenStream;
let activeCalls = {};       // Store video call objects
let dataConnections = {};   // Store chat data connections
let myPeerId = null;
let incomingCallObj = null;

// UI Elements
const uiLobby = document.getElementById('lobby-screen');
const uiCall = document.getElementById('call-screen');
const uiIncoming = document.getElementById('incoming-call-modal');
const videoGrid = document.getElementById('video-grid');
const localVideo = document.getElementById('local-video');
const chatSidebar = document.getElementById('chat-sidebar');
const chatMessages = document.getElementById('chat-messages');
const chatBadge = document.getElementById('chat-badge');

// --- ID Management ---
// Generates a persistent professional ID (e.g., IN26802)
function getOrCreateId() {
    let id = localStorage.getItem('nexus_peer_id');
    if (!id) {
        id = 'IN' + Math.floor(10000 + Math.random() * 90000);
        localStorage.setItem('nexus_peer_id', id);
    }
    return id;
}

// --- Initialization ---
async function init() {
    myPeerId = getOrCreateId();
    initializePeer(myPeerId);

    // Request Hardware Permissions
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (err) {
        showToast("Camera/Microphone access required!");
    }
}

function initializePeer(id) {
    peer = new Peer(id, {
        config: { 'iceServers': [{ urls: 'stun:stun.l.google.com:19302' }] }
    });

    peer.on('open', (assignedId) => {
        document.getElementById('my-id').innerText = assignedId;
    });

    peer.on('error', (err) => {
        // If our saved ID is somehow taken, generate a new one
        if (err.type === 'unavailable-id') {
            localStorage.removeItem('nexus_peer_id');
            myPeerId = getOrCreateId();
            initializePeer(myPeerId);
        } else {
            showToast("Network Error: " + err.type);
        }
    });

    // Listen for incoming Video Calls
    peer.on('call', (call) => {
        incomingCallObj = call;
        document.getElementById('caller-id-display').innerText = call.peer;
        uiIncoming.classList.remove('hidden');
    });

    // Listen for incoming Chat Data Connections
    peer.on('connection', (conn) => {
        setupDataConnection(conn);
    });
}

// --- Video Call Logic ---

function startCallFromLobby() {
    const targetId = document.getElementById('target-id').value.trim().toUpperCase();
    switchToCallScreen(); // Enter room immediately
    
    if (targetId && targetId !== myPeerId) {
        initiateConnectionToPeer(targetId);
    } else if (targetId === myPeerId) {
        showToast("You cannot call yourself!");
    }
}

// Group Call functionality: Add a new peer while already inside a call
function addPeerToCall() {
    const targetId = document.getElementById('add-peer-id').value.trim().toUpperCase();
    if (!targetId) return showToast("Enter a valid ID");
    if (targetId === myPeerId) return showToast("You cannot call yourself");
    if (activeCalls[targetId]) return showToast("Already connected to this person");
    
    initiateConnectionToPeer(targetId);
    document.getElementById('add-peer-id').value = '';
}

function initiateConnectionToPeer(targetId) {
    // 1. Start Video Call
    const call = peer.call(targetId, localStream);
    handleCallEvents(call);
    
    // 2. Start Chat Data Connection
    const conn = peer.connect(targetId);
    setupDataConnection(conn);
    
    showToast(`Calling ${targetId}...`);
}

function answerCall() {
    if (!incomingCallObj) return;
    
    incomingCallObj.answer(localStream);
    handleCallEvents(incomingCallObj);
    
    uiIncoming.classList.add('hidden');
    switchToCallScreen();
}

function rejectCall() {
    if (incomingCallObj) {
        incomingCallObj.close();
        incomingCallObj = null;
    }
    uiIncoming.classList.add('hidden');
}

function handleCallEvents(call) {
    activeCalls[call.peer] = call;

    call.on('stream', (remoteStream) => {
        if (!document.getElementById(`vid-${call.peer}`)) {
            const videoWrapper = document.createElement('div');
            videoWrapper.id = `wrapper-${call.peer}`;
            videoWrapper.className = "relative w-full h-full rounded-3xl overflow-hidden bg-black/50 shadow-2xl border border-white/5";
            
            const remoteVid = document.createElement('video');
            remoteVid.id = `vid-${call.peer}`;
            remoteVid.srcObject = remoteStream;
            remoteVid.autoplay = true;
            remoteVid.playsInline = true;
            remoteVid.className = "w-full h-full object-cover";

            const label = document.createElement('div');
            label.className = "absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1 rounded-lg text-sm text-white font-mono flex items-center gap-2";
            label.innerHTML = `<div class="w-2 h-2 rounded-full bg-blue-500"></div> ${call.peer}`;

            videoWrapper.appendChild(remoteVid);
            videoWrapper.appendChild(label);
            videoGrid.appendChild(videoWrapper);
            showToast(`${call.peer} joined`);
        }
    });

    call.on('close', () => removeRemotePeer(call.peer));
    call.on('error', () => removeRemotePeer(call.peer));
}

function removeRemotePeer(peerId) {
    const wrapper = document.getElementById(`wrapper-${peerId}`);
    if (wrapper) wrapper.remove();
    delete activeCalls[peerId];
    delete dataConnections[peerId];
    showToast(`${peerId} left`);
    
    // If no one is left, you stay in your own room. You can click 'End Call' to exit completely.
}

function endCall() {
    for (let peerId in activeCalls) {
        activeCalls[peerId].close();
        if(dataConnections[peerId]) dataConnections[peerId].close();
        removeRemotePeer(peerId);
    }
    
    uiCall.classList.add('hidden');
    uiCall.classList.remove('flex');
    uiLobby.classList.remove('hidden');
    chatMessages.innerHTML = '<div class="text-center text-xs text-gray-500 mb-2">End-to-End Encrypted Chat</div>';
}

// --- Text Chat Logic ---

function setupDataConnection(conn) {
    conn.on('open', () => {
        dataConnections[conn.peer] = conn;
    });

    conn.on('data', (data) => {
        displayChatMessage(conn.peer, data, false);
        
        // Show notification dot if chat is closed
        if(chatSidebar.classList.contains('translate-x-[120%]')) {
            chatBadge.classList.remove('hidden');
        }
    });

    conn.on('close', () => {
        delete dataConnections[conn.peer];
    });
}

function sendChatMessage(e) {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;

    // Display locally
    displayChatMessage('You', msg, true);
    
    // Broadcast to all connected peers
    Object.values(dataConnections).forEach(conn => {
        if (conn.open) conn.send(msg);
    });
    
    input.value = '';
}

function displayChatMessage(sender, text, isMe) {
    const wrapper = document.createElement('div');
    wrapper.className = "flex flex-col mb-2";
    
    const nameLabel = document.createElement('span');
    nameLabel.className = `text-[10px] text-gray-400 mb-1 ${isMe ? 'self-end mr-1' : 'ml-1'}`;
    nameLabel.innerText = sender;

    const bubble = document.createElement('div');
    bubble.className = isMe ? 'chat-bubble-me' : 'chat-bubble-peer';
    bubble.innerText = text;

    wrapper.appendChild(nameLabel);
    wrapper.appendChild(bubble);
    chatMessages.appendChild(wrapper);
    
    // Auto scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

let isChatOpen = false;
function toggleChat() {
    isChatOpen = !isChatOpen;
    chatBadge.classList.add('hidden'); // Clear unread dot
    if (isChatOpen) {
        chatSidebar.classList.remove('translate-x-[120%]');
    } else {
        chatSidebar.classList.add('translate-x-[120%]');
    }
}

// --- Hardware Controls ---

let isAudioMuted = false;
let isVideoStopped = false;

function toggleMic() {
    isAudioMuted = !isAudioMuted;
    localStream.getAudioTracks()[0].enabled = !isAudioMuted;
    const btn = document.getElementById('btn-mic');
    btn.classList.toggle('muted', isAudioMuted);
    btn.innerHTML = isAudioMuted ? '<i class="ph-fill ph-microphone-slash text-xl sm:text-2xl"></i>' : '<i class="ph-fill ph-microphone text-xl sm:text-2xl"></i>';
}

function toggleCam() {
    isVideoStopped = !isVideoStopped;
    localStream.getVideoTracks()[0].enabled = !isVideoStopped;
    const btn = document.getElementById('btn-cam');
    btn.classList.toggle('muted', isVideoStopped);
    btn.innerHTML = isVideoStopped ? '<i class="ph-fill ph-video-camera-slash text-xl sm:text-2xl"></i>' : '<i class="ph-fill ph-video-camera text-xl sm:text-2xl"></i>';
}

async function toggleScreenShare() {
    const btn = document.getElementById('btn-screen');
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
        const videoTrack = localStream.getVideoTracks()[0];
        replaceTrackInActiveCalls(videoTrack);
        localVideo.srcObject = localStream;
        localVideo.classList.add('mirror');
        btn.classList.remove('muted');
    } else {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = screenStream.getVideoTracks()[0];
            screenTrack.onended = () => { toggleScreenShare(); };
            replaceTrackInActiveCalls(screenTrack);
            localVideo.srcObject = screenStream;
            localVideo.classList.remove('mirror');
            btn.classList.add('muted');
        } catch (err) {
            console.error("Screen share failed", err);
        }
    }
}

function replaceTrackInActiveCalls(newTrack) {
    for (let id in activeCalls) {
        const peerConnection = activeCalls[id].peerConnection;
        const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(newTrack);
    }
}

// --- Utilities ---
function switchToCallScreen() {
    uiLobby.classList.add('hidden');
    uiCall.classList.remove('hidden');
    uiCall.classList.add('flex');
}

function copyMyId() {
    if(!myPeerId) return;
    navigator.clipboard.writeText(myPeerId);
    showToast("ID Copied to clipboard!");
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-msg').innerText = msg;
    toast.classList.remove('translate-x-full');
    setTimeout(() => {
        toast.classList.add('translate-x-full');
    }, 3000);
}

// Start app
window.onload = init;
