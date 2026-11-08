// --- Application State ---
let peer;
let localStream;
let screenStream;
let activeCalls = {}; // Stores all ongoing call objects
let myPeerId = null;
let incomingCallObj = null;

// UI Elements
const uiLobby = document.getElementById('lobby-screen');
const uiCall = document.getElementById('call-screen');
const uiIncoming = document.getElementById('incoming-call-modal');
const videoGrid = document.getElementById('video-grid');
const localVideo = document.getElementById('local-video');

// --- Initialization ---
async function init() {
    // 1. Initialize PeerJS (Connects to free public WebRTC signaling server)
    peer = new Peer({
        config: {
            'iceServers': [
                { urls: 'stun:stun.l.google.com:19302' }, // Google's free STUN server
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        }
    });

    peer.on('open', (id) => {
        myPeerId = id;
        document.getElementById('my-id').innerText = id;
    });

    peer.on('error', (err) => {
        console.error(err);
        showToast("Network Error: " + err.type);
    });

    // 2. Request Hardware Permissions (Camera & Mic)
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (err) {
        showToast("Camera/Microphone access denied!");
        console.error("Failed to get local stream", err);
    }

    // 3. Listen for incoming calls
    peer.on('call', (call) => {
        incomingCallObj = call;
        document.getElementById('caller-id-display').innerText = `ID: ${call.peer}`;
        uiIncoming.classList.remove('hidden'); // Show incoming modal
    });
}

// --- Call Actions ---

// Start a 1-to-1 Call
function startPrivateCall() {
    const targetId = document.getElementById('target-id').value.trim();
    if (!targetId) return showToast("Enter a valid Peer ID");
    if (targetId === myPeerId) return showToast("You cannot call yourself!");

    const call = peer.call(targetId, localStream);
    handleCallEvents(call);
    switchToCallScreen();
}

// Group Call Architecture (Mesh Network Basis)
// In a true serverless app, users share a "Host" ID. 
// This function acts as joining the mesh.
function startGroupCall() {
    showToast("Group call mode activated. Share your ID for others to join!");
    switchToCallScreen();
}

// Answer incoming call
function answerCall() {
    if (!incomingCallObj) return;
    
    incomingCallObj.answer(localStream);
    handleCallEvents(incomingCallObj);
    
    uiIncoming.classList.add('hidden');
    switchToCallScreen();
}

// Reject incoming call
function rejectCall() {
    if (incomingCallObj) {
        incomingCallObj.close();
        incomingCallObj = null;
    }
    uiIncoming.classList.add('hidden');
}

// Handle media streams from remote peers
function handleCallEvents(call) {
    activeCalls[call.peer] = call;

    // When we receive the remote stream
    call.on('stream', (remoteStream) => {
        // Prevent duplicate video elements if stream triggers twice (WebRTC quirk)
        if (!document.getElementById(`vid-${call.peer}`)) {
            const videoWrapper = document.createElement('div');
            videoWrapper.id = `wrapper-${call.peer}`;
            videoWrapper.className = "relative w-full h-full rounded-3xl overflow-hidden bg-black/50 shadow-2xl border border-white/5 animate-fade-in";
            
            const remoteVid = document.createElement('video');
            remoteVid.id = `vid-${call.peer}`;
            remoteVid.srcObject = remoteStream;
            remoteVid.autoplay = true;
            remoteVid.playsInline = true;
            remoteVid.className = "w-full h-full object-cover";

            const label = document.createElement('div');
            label.className = "absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1 rounded-lg text-sm text-white flex items-center gap-2";
            label.innerHTML = `<div class="w-2 h-2 rounded-full bg-blue-500"></div> Peer`;

            videoWrapper.appendChild(remoteVid);
            videoWrapper.appendChild(label);
            videoGrid.appendChild(videoWrapper);
        }
    });

    call.on('close', () => {
        removeRemoteVideo(call.peer);
    });
    call.on('error', () => {
        removeRemoteVideo(call.peer);
    });
}

function removeRemoteVideo(peerId) {
    const wrapper = document.getElementById(`wrapper-${peerId}`);
    if (wrapper) wrapper.remove();
    delete activeCalls[peerId];
    
    // If no calls left, go back to lobby
    if (Object.keys(activeCalls).length === 0) {
        endCall();
    }
}

function endCall() {
    // Close all peer connections
    for (let peerId in activeCalls) {
        activeCalls[peerId].close();
        removeRemoteVideo(peerId);
    }
    activeCalls = {};
    
    // Reset UI
    uiCall.classList.add('hidden');
    uiCall.classList.remove('flex');
    uiLobby.classList.remove('hidden');
}

// --- Hardware Controls ---

let isAudioMuted = false;
let isVideoStopped = false;

function toggleMic() {
    isAudioMuted = !isAudioMuted;
    localStream.getAudioTracks()[0].enabled = !isAudioMuted;
    
    const btn = document.getElementById('btn-mic');
    btn.classList.toggle('muted', isAudioMuted);
    btn.innerHTML = isAudioMuted ? '<i class="ph-fill ph-microphone-slash text-2xl"></i>' : '<i class="ph-fill ph-microphone text-2xl"></i>';
}

function toggleCam() {
    isVideoStopped = !isVideoStopped;
    localStream.getVideoTracks()[0].enabled = !isVideoStopped;
    
    const btn = document.getElementById('btn-cam');
    btn.classList.toggle('muted', isVideoStopped);
    btn.innerHTML = isVideoStopped ? '<i class="ph-fill ph-video-camera-slash text-2xl"></i>' : '<i class="ph-fill ph-video-camera text-2xl"></i>';
}

async function toggleScreenShare() {
    const btn = document.getElementById('btn-screen');
    
    if (screenStream) {
        // Stop Screen Share
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
        
        // Revert to camera track
        const videoTrack = localStream.getVideoTracks()[0];
        replaceTrackInActiveCalls(videoTrack);
        localVideo.srcObject = localStream;
        localVideo.classList.add('mirror');
        
        btn.classList.remove('muted');
        showToast("Screen sharing stopped");
    } else {
        // Start Screen Share
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = screenStream.getVideoTracks()[0];
            
            // Listen for native browser "Stop Sharing" button
            screenTrack.onended = () => { toggleScreenShare(); };
            
            replaceTrackInActiveCalls(screenTrack);
            localVideo.srcObject = screenStream;
            localVideo.classList.remove('mirror'); // Don't mirror screen shares
            
            btn.classList.add('muted');
            showToast("Screen sharing active");
        } catch (err) {
            console.error("Screen share failed", err);
        }
    }
}

// Dynamic track replacement (Client-side superpower for vanilla WebRTC)
function replaceTrackInActiveCalls(newTrack) {
    for (let id in activeCalls) {
        const peerConnection = activeCalls[id].peerConnection;
        const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
            sender.replaceTrack(newTrack);
        }
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
