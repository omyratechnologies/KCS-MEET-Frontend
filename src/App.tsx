import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
    setAuthToken, 
    getAuthToken, 
    testConnection, 
    createInstantMeeting, 
    joinMeeting as apiJoinMeeting,
    getMeetingById,
    initiateCall,
    answerCall,
    rejectCall,
    endCall,
    cancelCall,
    getActiveCall,
    checkAdmissionRequired,
    requestAdmission,
    getWaitingRoom,
    admitParticipant,
    rejectParticipant,
    type Meeting,
    type WaitingRoomEntry,
} from './api/meeting';
import { useWebRTC } from './hooks/useWebRTC';
import './App.css';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'https://devws.letscatchup-kcs.com';

interface IncomingCall {
    callId: string;
    meetingId: string;
    callerId: string;
    callerName: string;
    callType: 'audio' | 'video';
}

function App() {
    const [token, setToken] = useState(getAuthToken());
    const [isConnected, setIsConnected] = useState(false);
    const [currentMeeting, setCurrentMeeting] = useState<Meeting | null>(null);
    const [meetingCode, setMeetingCode] = useState('');
    const [logs, setLogs] = useState<string[]>([]);
    const [showJoinDialog, setShowJoinDialog] = useState(false);
    const [shouldAutoJoin, setShouldAutoJoin] = useState(false);
    
    // Call state
    const [calleeId, setCalleeId] = useState('');
    const [activeCallId, setActiveCallId] = useState<string | null>(null);
    const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
    const [isInCall, setIsInCall] = useState(false);
    const [callStatus, setCallStatus] = useState<string>('');
    
    // Waiting room state
    const [waitingRoom, setWaitingRoom] = useState<WaitingRoomEntry[]>([]);
    const [isWaiting, setIsWaiting] = useState(false);
    const [waitingPosition, setWaitingPosition] = useState<number | null>(null);
    const [enableWaitingRoom, setEnableWaitingRoom] = useState(false);
    
    // Socket ref for real-time events
    const socketRef = useRef<Socket | null>(null);

    const {
        localVideoRef,
        remoteParticipants,
        isAudioEnabled,
        isVideoEnabled,
        isScreenSharing,
        connectionStatus,
        error: webRTCError,
        // Dynamic optimization
        optimization,
        meetingTier,
        // Actions
        toggleVideo,
        toggleAudio,
        toggleScreenShare,
        joinMeeting: webRTCJoin,
        leaveMeeting: webRTCLeave,
    } = useWebRTC({ meeting: currentMeeting });

    const log = useCallback((message: string) => {
        const timestamp = new Date().toLocaleTimeString();
        setLogs(prev => [...prev.slice(-50), `[${timestamp}] ${message}`]);
        console.log(message);
    }, []);

    // Handle token changes
    useEffect(() => {
        if (token) {
            setAuthToken(token);
        }
    }, [token]);

    // Connect socket for real-time call and waiting room notifications
    useEffect(() => {
        if (!token) return;

        const socket = io(SOCKET_URL, {
            auth: { token },
            transports: ['polling', 'websocket'],
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            log('🔌 Socket connected for notifications');
        });

        // Incoming call notification
        socket.on('incoming-call', (data: IncomingCall) => {
            log(`📞 Incoming ${data.callType} call from ${data.callerName}`);
            setIncomingCall(data);
        });

        // Call was accepted (caller receives this when callee picks up)
        socket.on('call-accepted', (_data: { callId: string; meetingId: string }) => {
            log('✅ Call accepted by other party!');
            setCallStatus('In call');
            setIsInCall(true);
            // The meeting should already be set from handleInitiateCall
        });

        // Call was rejected (caller receives this when callee declines)
        socket.on('call-rejected', (data: { callId: string; reason?: string }) => {
            log(`❌ Call rejected: ${data.reason || 'Declined'}`);
            setCallStatus('Call declined');
            setActiveCallId(null);
            setIsInCall(false);
            setCurrentMeeting(null);
            // Clear status after 2 seconds
            setTimeout(() => setCallStatus(''), 2000);
        });

        // Call missed (timeout or user disconnected)
        socket.on('call-missed', (data: { callId: string; reason?: string }) => {
            log(`📵 Call missed: ${data.reason || 'No answer'}`);
            setCallStatus('Call missed');
            setActiveCallId(null);
            setIsInCall(false);
            setCurrentMeeting(null);
            setIncomingCall(null);
            // Clear status after 2 seconds
            setTimeout(() => setCallStatus(''), 2000);
        });

        // Call ended
        socket.on('call-ended', (_data: { callId: string; endedBy?: string }) => {
            log(`📴 Call ended by other party`);
            setCallStatus('Call ended');
            setActiveCallId(null);
            setIsInCall(false);
            // Note: Setting currentMeeting to null will trigger WebRTC cleanup via useEffect
            setCurrentMeeting(null);
            // Clear status after 2 seconds
            setTimeout(() => setCallStatus(''), 2000);
        });

        // Call cancelled by caller
        socket.on('call-cancelled', (_data: { callId: string }) => {
            log('❌ Call was cancelled');
            setIncomingCall(null);
        });

        // Admission granted (for waiting room)
        socket.on('admission-granted', (_data: { meetingId: string }) => {
            log('✅ You have been admitted to the meeting!');
            setIsWaiting(false);
            setWaitingPosition(null);
            // Now join WebRTC
            setShouldAutoJoin(true);
        });

        // Admission rejected
        socket.on('admission-rejected', (data: { meetingId: string; reason?: string }) => {
            log(`❌ Admission rejected: ${data.reason || 'No reason'}`);
            setIsWaiting(false);
            setWaitingPosition(null);
            setCurrentMeeting(null);
        });

        // Waiting room update (for hosts)
        socket.on('waiting-room-update', (data: { meetingId: string; waitingRoom: WaitingRoomEntry[] }) => {
            log(`🚪 Waiting room updated: ${data.waitingRoom.length} waiting`);
            setWaitingRoom(data.waitingRoom);
        });

        // New admission request (for hosts)
        socket.on('admission-requested', (data: { meetingId: string; userId: string; userName: string }) => {
            log(`🚪 ${data.userName} is waiting to join`);
        });

        socket.on('disconnect', () => {
            log('🔌 Socket disconnected');
        });

        return () => {
            socket.disconnect();
        };
    }, [token, log]);

    // Join socket room when meeting changes
    useEffect(() => {
        if (socketRef.current && currentMeeting) {
            log(`🔗 Joining socket room for meeting ${currentMeeting.id}`);
            socketRef.current.emit('join-meeting', { meetingId: currentMeeting.id });
        }
    }, [currentMeeting, log]);

    // Poll waiting room for hosts with waiting room enabled
    useEffect(() => {
        if (!currentMeeting || !enableWaitingRoom) return;
        
        // Initial fetch
        refreshWaitingRoom(currentMeeting.id);
        
        // Poll every 3 seconds
        const interval = setInterval(() => {
            refreshWaitingRoom(currentMeeting.id);
        }, 3000);
        
        return () => clearInterval(interval);
    }, [currentMeeting, enableWaitingRoom]);

    // Auto-join WebRTC when meeting is set and shouldAutoJoin is true
    useEffect(() => {
        if (currentMeeting && shouldAutoJoin && !isWaiting) {
            log('🔌 Auto-joining WebRTC...');
            webRTCJoin();
            setShouldAutoJoin(false);
        }
    }, [currentMeeting, shouldAutoJoin, isWaiting, webRTCJoin, log]);

    // Refresh waiting room for hosts
    const refreshWaitingRoom = async (meetingId: string) => {
        const result = await getWaitingRoom(meetingId);
        if (result.success && result.data) {
            setWaitingRoom(result.data);
        }
    };

    // Test API connection
    const handleTestConnection = async () => {
        log('🔌 Testing connection...');
        const result = await testConnection();
        if (result.success) {
            log('✅ Connected to API!');
            setIsConnected(true);
            
            // Check for active call (in case user refreshed during a call)
            const activeCallResult = await getActiveCall();
            if (activeCallResult.success && activeCallResult.data) {
                const call = activeCallResult.data;
                log(`📞 Found active call: ${call.callId} (status: ${call.status})`);
                setActiveCallId(call.callId);
                setIsInCall(true);
                setCallStatus(`In call - ${call.status}`);
                
                // Get the meeting for WebRTC
                const meetingResult = await getMeetingById(call.meetingId);
                if (meetingResult.success && meetingResult.data) {
                    setCurrentMeeting(meetingResult.data);
                    setShouldAutoJoin(true);
                }
            }
        } else {
            log(`❌ Connection failed: ${result.error}`);
            setIsConnected(false);
        }
    };

    // Create instant meeting
    const handleCreateMeeting = async () => {
        log(`📅 Creating meeting (Waiting Room: ${enableWaitingRoom ? 'ON' : 'OFF'})...`);
        const result = await createInstantMeeting(
            `Meeting - ${new Date().toLocaleTimeString()}`,
            { waiting_room_enabled: enableWaitingRoom, auto_admit: !enableWaitingRoom }
        );
        
        if (result.success && result.data) {
            log(`✅ Meeting created: ${result.data.meeting_code}`);
            setCurrentMeeting(result.data);
            setShouldAutoJoin(true);
            
            // If host with waiting room, start polling
            if (enableWaitingRoom) {
                refreshWaitingRoom(result.data.id);
            }
        } else {
            log(`❌ Failed to create meeting: ${result.error}`);
        }
    };

    // Join existing meeting
    const handleJoinMeeting = async () => {
        if (!meetingCode.trim()) {
            log('❌ Please enter a meeting code');
            return;
        }

        log(`📍 Joining meeting ${meetingCode}...`);
        const result = await apiJoinMeeting(meetingCode);
        
        if (result.success && result.data) {
            if (!result.data.canJoin) {
                log(`❌ Cannot join: ${result.data.joinError}`);
                return;
            }
            
            log(`✅ Joined meeting: ${result.data.meeting.meeting_code}`);
            setCurrentMeeting(result.data.meeting);
            setShowJoinDialog(false);
            
            // Check if waiting room is required
            const admissionCheck = await checkAdmissionRequired(result.data.meeting.id);
            if (admissionCheck.success && admissionCheck.data?.required) {
                log('🚪 Waiting room enabled - requesting admission...');
                const admissionResult = await requestAdmission(result.data.meeting.id, 'User');
                if (admissionResult.success) {
                    setIsWaiting(true);
                    setWaitingPosition(admissionResult.position || 1);
                    log(`⏳ In waiting room (Position: ${admissionResult.position})`);
                }
            } else {
                setShouldAutoJoin(true);
            }
        } else {
            log(`❌ Failed to join: ${result.error}`);
        }
    };

    // Leave meeting
    const handleLeaveMeeting = () => {
        webRTCLeave();
        setCurrentMeeting(null);
        setIsInCall(false);
        setWaitingRoom([]);
        log('👋 Left meeting');
    };

    // ============================================
    // CALL FUNCTIONS
    // ============================================

    const handleInitiateCall = async (type: 'audio' | 'video') => {
        if (!calleeId.trim()) {
            log('❌ Please enter a user ID to call');
            return;
        }

        log(`📞 Starting ${type} call to ${calleeId}...`);
        setCallStatus('Calling...');
        
        const result = await initiateCall(calleeId, type);
        if (result.success && result.data) {
            log(`📞 Call initiated (ID: ${result.data.callId})`);
            setActiveCallId(result.data.callId);
            setIsInCall(true);
            
            // Get the meeting by ID for WebRTC
            const meetingResult = await getMeetingById(result.data.meetingId);
            if (meetingResult.success && meetingResult.data) {
                setCurrentMeeting(meetingResult.data);
                setShouldAutoJoin(true);
            } else {
                log(`⚠️ Could not get meeting details: ${meetingResult.error}`);
            }
        } else {
            log(`❌ Failed to initiate call: ${result.error}`);
            setCallStatus('');
        }
    };

    const handleAnswerCall = async () => {
        if (!incomingCall) return;

        log('📞 Answering call...');
        const result = await answerCall(incomingCall.callId);
        if (result.success) {
            log('✅ Call answered!');
            setActiveCallId(incomingCall.callId);
            setIsInCall(true);
            setCallStatus('In call');
            
            // Get the meeting by ID for WebRTC
            const meetingResult = await getMeetingById(incomingCall.meetingId);
            if (meetingResult.success && meetingResult.data) {
                setCurrentMeeting(meetingResult.data);
                setShouldAutoJoin(true);
            } else {
                log(`⚠️ Could not get meeting details: ${meetingResult.error}`);
            }
            setIncomingCall(null);
        } else {
            log(`❌ Failed to answer: ${result.error}`);
            setIncomingCall(null);
        }
    };

    const handleRejectCall = async () => {
        if (!incomingCall) return;

        log('❌ Rejecting call...');
        await rejectCall(incomingCall.callId, 'Busy');
        setIncomingCall(null);
    };

    const handleEndCall = async () => {
        if (!activeCallId) return;

        log('📴 Ending call...');
        await endCall(activeCallId);
        handleLeaveMeeting();
    };

    const handleCancelCall = async () => {
        if (!activeCallId) return;

        log('❌ Cancelling call...');
        await cancelCall(activeCallId);
        setActiveCallId(null);
        setCallStatus('');
    };

    // ============================================
    // WAITING ROOM FUNCTIONS
    // ============================================

    const handleAdmitUser = async (userId: string) => {
        if (!currentMeeting) return;
        
        log(`✅ Admitting user ${userId}...`);
        const result = await admitParticipant(currentMeeting.id, userId);
        if (result.success) {
            log('✅ User admitted');
            refreshWaitingRoom(currentMeeting.id);
        } else {
            log(`❌ Failed to admit: ${result.error}`);
        }
    };

    const handleRejectUser = async (userId: string) => {
        if (!currentMeeting) return;
        
        log(`❌ Rejecting user ${userId}...`);
        const result = await rejectParticipant(currentMeeting.id, userId);
        if (result.success) {
            log('❌ User rejected');
            refreshWaitingRoom(currentMeeting.id);
        } else {
            log(`❌ Failed to reject: ${result.error}`);
        }
    };

    // Display WebRTC errors
    useEffect(() => {
        if (webRTCError) {
            log(`❌ WebRTC Error: ${webRTCError}`);
        }
    }, [webRTCError, log]);

    const getStatusColor = () => {
        switch (connectionStatus) {
            case 'connected': return '#22c55e';
            case 'connecting': return '#f59e0b';
            case 'fallback': return '#eab308';
            default: return '#ef4444';
        }
    };

    return (
        <div className="app">
            <header className="header">
                <h1>🎥 KCS Meeting Demo</h1>
                <p>Direct Calls + Waiting Room</p>
            </header>

            {/* Incoming Call Modal */}
            {incomingCall && (
                <div className="modal-overlay">
                    <div className="modal incoming-call-modal">
                        <h2>📞 Incoming {incomingCall.callType} Call</h2>
                        <p className="caller-name">{incomingCall.callerName}</p>
                        <div className="button-group">
                            <button onClick={handleAnswerCall} className="btn-success btn-large">
                                ✅ Answer
                            </button>
                            <button onClick={handleRejectCall} className="btn-danger btn-large">
                                ❌ Decline
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Waiting Room Modal */}
            {isWaiting && (
                <div className="modal-overlay">
                    <div className="modal waiting-modal">
                        <h2>🚪 Waiting Room</h2>
                        <div className="waiting-spinner"></div>
                        <p>Please wait for the host to admit you...</p>
                        <p className="waiting-position">Position: {waitingPosition}</p>
                        <button onClick={handleLeaveMeeting} className="btn-danger">
                            Leave
                        </button>
                    </div>
                </div>
            )}

            {/* Auth Section */}
            <section className="section">
                <h2>🔐 Authentication</h2>
                <div className="form-group">
                    <label>Auth Token:</label>
                    <input 
                        type="text" 
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder="Paste your JWT token here"
                    />
                </div>
                <button onClick={handleTestConnection} className="btn-primary">
                    Test Connection
                </button>
                <span className={`status-badge ${isConnected ? 'connected' : 'disconnected'}`}>
                    {isConnected ? '✅ Connected' : '❌ Not Connected'}
                </span>
            </section>

            {/* Direct Call Section */}
            <section className="section">
                <h2>📞 Direct 1:1 Call</h2>
                <div className="form-group">
                    <label>User ID to call:</label>
                    <input 
                        type="text" 
                        value={calleeId}
                        onChange={(e) => setCalleeId(e.target.value)}
                        placeholder="Enter user ID (e.g., cc921785-5fce-450e-899b-7988a15d6a49)"
                    />
                </div>
                <div className="button-group">
                    <button 
                        onClick={() => handleInitiateCall('video')} 
                        className="btn-success" 
                        disabled={!isConnected || isInCall}
                    >
                        📹 Video Call
                    </button>
                    <button 
                        onClick={() => handleInitiateCall('audio')} 
                        className="btn-primary" 
                        disabled={!isConnected || isInCall}
                    >
                        📞 Audio Call
                    </button>
                    {activeCallId && callStatus === 'Calling...' && (
                        <button onClick={handleCancelCall} className="btn-danger">
                            ❌ Cancel
                        </button>
                    )}
                    {isInCall && (
                        <button onClick={handleEndCall} className="btn-danger">
                            📴 End Call
                        </button>
                    )}
                </div>
                {callStatus && <p className="call-status">{callStatus}</p>}
            </section>

            {/* Meeting Controls */}
            <section className="section">
                <h2>🎬 Meeting Controls</h2>
                <div className="form-group checkbox-group">
                    <label>
                        <input 
                            type="checkbox" 
                            checked={enableWaitingRoom}
                            onChange={(e) => setEnableWaitingRoom(e.target.checked)}
                        />
                        Enable Waiting Room
                    </label>
                </div>
                <div className="button-group">
                    <button onClick={handleCreateMeeting} className="btn-success" disabled={!isConnected}>
                        Create Meeting
                    </button>
                    <button onClick={() => setShowJoinDialog(true)} className="btn-primary" disabled={!isConnected}>
                        Join Meeting
                    </button>
                </div>

                {showJoinDialog && (
                    <div className="join-dialog">
                        <input 
                            type="text"
                            value={meetingCode}
                            onChange={(e) => setMeetingCode(e.target.value)}
                            placeholder="XXX-XXXX-XXX"
                        />
                        <button onClick={handleJoinMeeting} className="btn-success">
                            Join
                        </button>
                        <button onClick={() => setShowJoinDialog(false)} className="btn-danger">
                            Cancel
                        </button>
                    </div>
                )}
            </section>

            {/* Waiting Room Management (for hosts) */}
            {currentMeeting && waitingRoom.length > 0 && (
                <section className="section waiting-room-section">
                    <h2>🚪 Waiting Room ({waitingRoom.length})</h2>
                    <div className="waiting-list">
                        {waitingRoom.map((entry) => (
                            <div key={entry.userId} className="waiting-entry">
                                <span className="waiting-name">{entry.userName}</span>
                                <div className="waiting-actions">
                                    <button 
                                        onClick={() => handleAdmitUser(entry.userId)} 
                                        className="btn-success btn-small"
                                    >
                                        ✅ Admit
                                    </button>
                                    <button 
                                        onClick={() => handleRejectUser(entry.userId)} 
                                        className="btn-danger btn-small"
                                    >
                                        ❌ Reject
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* Current Meeting Info */}
            {currentMeeting && !isWaiting && (
                <section className="section meeting-info">
                    <h2>📋 Current Meeting</h2>
                    <p><strong>Title:</strong> {currentMeeting.title}</p>
                    <p><strong>Code:</strong> <code>{currentMeeting.meeting_code}</code></p>
                    <p>
                        <strong>Status:</strong> 
                        <span style={{ color: getStatusColor(), marginLeft: 8 }}>
                            {connectionStatus === 'connected' && '🟢 Connected'}
                            {connectionStatus === 'connecting' && '🟡 Connecting...'}
                            {connectionStatus === 'fallback' && '🟡 Preview Mode'}
                            {connectionStatus === 'disconnected' && '🔴 Disconnected'}
                        </span>
                    </p>

                    {/* 🎚️ Dynamic Optimization Display */}
                    {meetingTier && optimization && (
                        <div className="optimization-info" style={{ 
                            marginTop: 12, 
                            padding: 12, 
                            backgroundColor: '#1a1a2e', 
                            borderRadius: 8,
                            border: '1px solid #333'
                        }}>
                            <p style={{ margin: '0 0 8px 0' }}>
                                <strong>🎚️ Meeting Tier:</strong>{' '}
                                <span style={{ 
                                    padding: '2px 8px', 
                                    borderRadius: 4,
                                    fontWeight: 'bold',
                                    backgroundColor: 
                                        meetingTier === 'SMALL' ? '#22c55e' :
                                        meetingTier === 'MEDIUM' ? '#3b82f6' :
                                        meetingTier === 'LARGE' ? '#f59e0b' : '#ef4444',
                                    color: 'white'
                                }}>
                                    {meetingTier}
                                </span>
                                <span style={{ marginLeft: 8, opacity: 0.7 }}>
                                    ({optimization.config.participantCount} participants)
                                </span>
                            </p>
                            <p style={{ margin: '4px 0', fontSize: 12, opacity: 0.8 }}>
                                📹 Video: {optimization.config.video.recommendedWidth}×{optimization.config.video.recommendedHeight}@{optimization.config.video.recommendedFps}fps, 
                                max {(optimization.config.video.maxBitrate / 1000).toFixed(0)}kbps
                            </p>
                            <p style={{ margin: '4px 0', fontSize: 12, opacity: 0.8 }}>
                                📊 Bandwidth: ↑{optimization.bandwidthEstimate.perParticipantUpload}kbps, 
                                ↓{optimization.bandwidthEstimate.perParticipantDownload}kbps
                            </p>
                            <p style={{ margin: '4px 0', fontSize: 12, opacity: 0.6 }}>
                                🎯 Features: Video default={optimization.config.features.enableVideoByDefault ? 'ON' : 'OFF'}, 
                                Audio default={optimization.config.features.enableAudioByDefault ? 'ON' : 'OFF'}
                            </p>
                        </div>
                    )}

                    <div className="button-group">
                        <button onClick={toggleVideo} className={isVideoEnabled ? 'btn-danger' : 'btn-primary'}>
                            {isVideoEnabled ? '📹 Stop Camera' : '📹 Start Camera'}
                        </button>
                        <button onClick={toggleAudio} className={isAudioEnabled ? 'btn-danger' : 'btn-primary'}>
                            {isAudioEnabled ? '🔇 Mute' : '🎤 Unmute'}
                        </button>
                        <button onClick={toggleScreenShare} className={isScreenSharing ? 'btn-danger' : 'btn-secondary'}>
                            {isScreenSharing ? '🖥️ Stop Sharing' : '🖥️ Share Screen'}
                        </button>
                        <button onClick={handleLeaveMeeting} className="btn-danger">
                            👋 Leave
                        </button>
                    </div>
                </section>
            )}

            {/* Video Grid */}
            <section className="video-grid">
                <div className="video-container">
                    <video ref={localVideoRef} autoPlay muted playsInline />
                    <div className="video-label">You (Local)</div>
                </div>

                {Array.from(remoteParticipants.entries()).map(([odId, participant]) => (
                    <React.Fragment key={odId}>
                        {participant.cameraStream && (
                            <div className="video-container">
                                <video 
                                    autoPlay 
                                    playsInline
                                    ref={(el) => {
                                        if (el && participant.cameraStream) {
                                            if (el.srcObject !== participant.cameraStream) {
                                                el.srcObject = participant.cameraStream;
                                            }
                                            if (el.paused) {
                                                el.muted = true;
                                                el.play().catch(() => {});
                                            }
                                        }
                                    }}
                                />
                                <div className="video-label">{participant.userName || 'Participant'}</div>
                            </div>
                        )}

                        {participant.screenStream && (
                            <div className="video-container screen-share">
                                <video 
                                    autoPlay 
                                    playsInline
                                    ref={(el) => {
                                        if (el && participant.screenStream) {
                                            if (el.srcObject !== participant.screenStream) {
                                                el.srcObject = participant.screenStream;
                                            }
                                            if (el.paused) {
                                                el.muted = true;
                                                el.play().catch(() => {});
                                            }
                                        }
                                    }}
                                />
                                <div className="video-label">🖥️ {participant.userName} - Screen</div>
                            </div>
                        )}

                        {participant.audioStream && (
                            <audio
                                autoPlay
                                ref={(el) => {
                                    if (el && participant.audioStream && el.srcObject !== participant.audioStream) {
                                        el.srcObject = participant.audioStream;
                                        el.play().catch(() => {});
                                    }
                                }}
                            />
                        )}
                    </React.Fragment>
                ))}
            </section>

            {/* Logs */}
            <section className="section">
                <h2>📝 Logs</h2>
                <div className="log-container">
                    {logs.map((log, i) => (
                        <div key={i} className="log-entry">{log}</div>
                    ))}
                </div>
            </section>
        </div>
    );
}

export default App;