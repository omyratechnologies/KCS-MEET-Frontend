import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
    setAuthToken, 
    getAuthToken, 
    testConnection, 
    createInstantMeeting,
    createScheduledMeeting,
    joinMeeting as apiJoinMeeting,
    getMeetingById,
    getMyMeetings,
    startMeeting,
    endMeeting as apiEndMeeting,
    // Call APIs
    initiateCall,
    answerCall,
    rejectCall,
    endCall,
    cancelCall,
    getActiveCall,
    // Waiting Room APIs
    checkAdmissionRequired,
    requestAdmission,
    getWaitingRoom,
    admitParticipant,
    rejectParticipant,
    // Host Controls
    addCoHost,
    removeCoHost,
    muteAllParticipants,
    // Participants
    getParticipants,
    removeParticipant,
    // Chat
    getChatMessages,
    // Types
    type Meeting,
    type WaitingRoomEntry,
    type Participant,
    type ChatMessage,
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

interface Reaction {
    id: string;
    participantId: string;
    userName: string;
    reaction: string;
    timestamp: Date;
}

interface HandRaise {
    participantId: string;
    userName: string;
    raised: boolean;
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
    
    // Host controls state
    const [isHost, setIsHost] = useState(false);
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [coHostUserId, setCoHostUserId] = useState('');
    const [, setIsAllMuted] = useState(false);
    
    // Chat state
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [showChat, setShowChat] = useState(false);
    const [typingUsers, setTypingUsers] = useState<string[]>([]);
    
    // Reactions & Hand Raise
    const [reactions, setReactions] = useState<Reaction[]>([]);
    const [raisedHands, setRaisedHands] = useState<HandRaise[]>([]);
    const [isHandRaised, setIsHandRaised] = useState(false);
    
    // Recordings
    const [isRecording, setIsRecording] = useState(false);
    
    // Scheduled meetings
    const [myMeetings, setMyMeetings] = useState<Meeting[]>([]);
    const [showScheduleDialog, setShowScheduleDialog] = useState(false);
    const [scheduleForm, setScheduleForm] = useState({
        title: '',
        description: '',
        scheduledStart: '',
        scheduledEnd: '',
        invitedUserIds: '',
    });
    
    // Active tab
    const [activeTab, setActiveTab] = useState<'meeting' | 'call' | 'schedule'>('meeting');
    
    // Socket ref for real-time events
    const socketRef = useRef<Socket | null>(null);
    
    // Ref to access current meeting in socket handlers without stale closures
    const currentMeetingRef = useRef<Meeting | null>(null);
    useEffect(() => {
        currentMeetingRef.current = currentMeeting;
    }, [currentMeeting]);

    const {
        localVideoRef,
        remoteParticipants,
        isAudioEnabled,
        isVideoEnabled,
        isScreenSharing,
        connectionStatus,
        error: webRTCError,
        optimization,
        meetingTier,
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

    // Connect socket for real-time events
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

        // ============================================
        // CALL EVENTS
        // ============================================
        socket.on('incoming-call', (data: IncomingCall) => {
            log(`📞 Incoming ${data.callType} call from ${data.callerName}`);
            setIncomingCall(data);
        });

        socket.on('call-accepted', async (data: { callId: string; meetingId: string }) => {
            log('✅ Call accepted by other party!');
            setCallStatus('In call');
            setIsInCall(true);
            
            // NOW join WebRTC after call is accepted
            if (data.meetingId) {
                const meetingResult = await getMeetingById(data.meetingId);
                if (meetingResult.success && meetingResult.data) {
                    setCurrentMeeting(meetingResult.data);
                    setShouldAutoJoin(true);
                }
            }
        });

        socket.on('call-rejected', (data: { callId: string; reason?: string }) => {
            log(`❌ Call rejected: ${data.reason || 'Declined'}`);
            setCallStatus('Call declined');
            setActiveCallId(null);
            setIsInCall(false);
            setCurrentMeeting(null);
            setTimeout(() => setCallStatus(''), 2000);
        });

        socket.on('call-missed', () => {
            log(`📵 Call missed`);
            setCallStatus('Call missed');
            setActiveCallId(null);
            setIsInCall(false);
            setCurrentMeeting(null);
            setIncomingCall(null);
            setTimeout(() => setCallStatus(''), 2000);
        });

        socket.on('call-ended', () => {
            log(`📴 Call ended by other party`);
            setCallStatus('Call ended');
            setActiveCallId(null);
            setIsInCall(false);
            setCurrentMeeting(null);
            setTimeout(() => setCallStatus(''), 2000);
        });

        socket.on('call-cancelled', () => {
            log('❌ Call was cancelled');
            setIncomingCall(null);
        });

        // ============================================
        // WAITING ROOM EVENTS
        // ============================================
        socket.on('admission-granted', () => {
            log('✅ You have been admitted to the meeting!');
            setIsWaiting(false);
            setWaitingPosition(null);
            setShouldAutoJoin(true);
        });

        socket.on('admission-rejected', (data: { reason?: string }) => {
            log(`❌ Admission rejected: ${data.reason || 'No reason'}`);
            setIsWaiting(false);
            setWaitingPosition(null);
            setCurrentMeeting(null);
        });

        socket.on('waiting-room-update', (data: { waitingRoom?: WaitingRoomEntry[] }) => {
            const waitingList = data?.waitingRoom || [];
            log(`🚪 Waiting room updated: ${waitingList.length} waiting`);
            setWaitingRoom(waitingList);
        });

        socket.on('admission-requested', (data: { userName: string }) => {
            log(`🚪 ${data.userName} is waiting to join`);
        });

        // ============================================
        // MEETING CHAT EVENTS
        // ============================================
        socket.on('new-message', (message: ChatMessage) => {
            log(`💬 ${message.sender_name}: ${message.message}`);
            setChatMessages(prev => [...prev, message]);
        });

        socket.on('user-typing', (data: { userName: string; typing: boolean }) => {
            if (data.typing) {
                setTypingUsers(prev => [...new Set([...prev, data.userName])]);
            } else {
                setTypingUsers(prev => prev.filter(u => u !== data.userName));
            }
        });

        // ============================================
        // REACTIONS & HAND RAISE EVENTS
        // ============================================
        socket.on('participant-reaction', (data: { participantId: string; userName: string; reaction: string }) => {
            log(`${data.reaction} from ${data.userName}`);
            const newReaction: Reaction = {
                id: `${Date.now()}-${data.participantId}`,
                ...data,
                timestamp: new Date(),
            };
            setReactions(prev => [...prev.slice(-10), newReaction]);
            // Auto-remove after 3s
            setTimeout(() => {
                setReactions(prev => prev.filter(r => r.id !== newReaction.id));
            }, 3000);
        });

        socket.on('hand-raised', (data: HandRaise) => {
            log(`${data.raised ? '✋' : '👇'} ${data.userName} ${data.raised ? 'raised' : 'lowered'} hand`);
            if (data.raised) {
                setRaisedHands(prev => [...prev.filter(h => h.participantId !== data.participantId), data]);
            } else {
                setRaisedHands(prev => prev.filter(h => h.participantId !== data.participantId));
            }
        });

        // ============================================
        // HOST CONTROL EVENTS
        // ============================================
        socket.on('all-muted', () => {
            log(`🔇 All participants muted by host`);
            setIsAllMuted(true);
        });

        socket.on('all-unmuted', () => {
            log(`🔊 All participants unmuted`);
            setIsAllMuted(false);
        });

        socket.on('muted-by-host', (data: { muted: boolean }) => {
            log(`${data.muted ? '🔇 You were muted' : '🔊 You were unmuted'} by host`);
        });

        socket.on('participant-joined', (data: { userName: string }) => {
            log(`👋 ${data.userName} joined the meeting`);
            // Use ref to get latest meeting value (avoid stale closure)
            if (currentMeetingRef.current) {
                refreshParticipants(currentMeetingRef.current.id);
            }
        });

        socket.on('participant-left', (data: { userName: string }) => {
            log(`👋 ${data.userName} left the meeting`);
            // Use ref to get latest meeting value (avoid stale closure)
            if (currentMeetingRef.current) {
                refreshParticipants(currentMeetingRef.current.id);
            }
        });

        // ============================================
        // RECORDING EVENTS
        // ============================================
        socket.on('recording-status-changed', (data: { recording: boolean }) => {
            log(`🎥 Recording ${data.recording ? 'started' : 'stopped'}`);
            setIsRecording(data.recording);
        });

        socket.on('disconnect', () => {
            log('🔌 Socket disconnected');
        });

        return () => {
            socket.disconnect();
        };
    // IMPORTANT: Only depend on token, NOT on currentMeeting!
    // The socket should stay connected as long as we have a token.
    // If we depend on currentMeeting, the socket reconnects every time it changes,
    // which breaks call-ended notifications since the socket disconnects before receiving them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, log]);

    // Handle meeting changes (load chat, participants, set host)
    // NOTE: Do NOT emit join-meeting here - the WebRTC hook handles that
    // Emitting from both sockets causes duplicate participant entries
    useEffect(() => {
        if (currentMeeting) {
            // Set host status
            setIsHost(currentMeeting.creator_id === getCurrentUserId());
            
            // Load chat history
            loadChatHistory(currentMeeting.id);
            
            // Load participants
            refreshParticipants(currentMeeting.id);
        }
    }, [currentMeeting]);

    // Poll waiting room for hosts
    useEffect(() => {
        if (!currentMeeting || !enableWaitingRoom) return;
        
        refreshWaitingRoom(currentMeeting.id);
        const interval = setInterval(() => {
            refreshWaitingRoom(currentMeeting.id);
        }, 3000);
        
        return () => clearInterval(interval);
    }, [currentMeeting, enableWaitingRoom]);

    // Auto-join WebRTC when meeting is set
    useEffect(() => {
        if (currentMeeting && shouldAutoJoin && !isWaiting) {
            log('🔌 Auto-joining WebRTC...');
            webRTCJoin();
            setShouldAutoJoin(false);
        }
    }, [currentMeeting, shouldAutoJoin, isWaiting, webRTCJoin, log]);

    // Display WebRTC errors
    useEffect(() => {
        if (webRTCError) {
            log(`❌ WebRTC Error: ${webRTCError}`);
        }
    }, [webRTCError, log]);

    // Helper functions
    const getCurrentUserId = () => {
        // Extract user ID from JWT token (simplified)
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            return payload.user_id || payload.sub;
        } catch {
            return '';
        }
    };

    const refreshWaitingRoom = async (meetingId: string) => {
        const result = await getWaitingRoom(meetingId);
        if (result.success && result.data) {
            setWaitingRoom(result.data);
        }
    };

    const refreshParticipants = async (meetingId: string) => {
        console.log('🔄 Refreshing participants for meeting:', meetingId);
        const result = await getParticipants(meetingId);
        console.log('📊 Participants API response:', result);
        if (result.success && result.data) {
            console.log('✅ Setting participants:', result.data.length, 'participants');
            setParticipants(result.data);
        } else {
            console.error('❌ Failed to load participants:', result.error);
        }
    };

    const loadChatHistory = async (meetingId: string) => {
        console.log('💬 Loading chat history for meeting:', meetingId);
        const result = await getChatMessages(meetingId);
        console.log('📊 Chat API response:', result);
        if (result.success && result.data) {
            console.log('✅ Setting chat messages:', result.data.length, 'messages');
            setChatMessages(result.data);
        } else {
            console.error('❌ Failed to load chat:', result.error);
        }
    };

    // Test API connection
    const handleTestConnection = async () => {
        log('🔌 Testing connection...');
        const result = await testConnection();
        if (result.success) {
            log('✅ Connected to API!');
            setIsConnected(true);
            
            // Load my meetings
            const meetingsResult = await getMyMeetings();
            if (meetingsResult.success && meetingsResult.data) {
                setMyMeetings(meetingsResult.data);
            }
            
            // Check for active call
            const activeCallResult = await getActiveCall();
            if (activeCallResult.success && activeCallResult.data) {
                const call = activeCallResult.data;
                log(`📞 Found active call: ${call.callId} (status: ${call.status})`);
                setActiveCallId(call.callId);
                setIsInCall(true);
                setCallStatus(`In call - ${call.status}`);
                
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
            setIsHost(true);
            
            if (enableWaitingRoom) {
                refreshWaitingRoom(result.data.id);
            }
        } else {
            log(`❌ Failed to create meeting: ${result.error}`);
        }
    };

    // Create scheduled meeting
    const handleCreateScheduledMeeting = async () => {
        if (!scheduleForm.title || !scheduleForm.scheduledStart) {
            log('❌ Title and start time are required');
            return;
        }

        log('📅 Creating scheduled meeting...');
        const result = await createScheduledMeeting({
            title: scheduleForm.title,
            description: scheduleForm.description,
            scheduled_start: new Date(scheduleForm.scheduledStart).toISOString(),
            scheduled_end: scheduleForm.scheduledEnd ? new Date(scheduleForm.scheduledEnd).toISOString() : undefined,
            invited_user_ids: scheduleForm.invitedUserIds.split(',').map(s => s.trim()).filter(Boolean),
            settings: {
                waiting_room_enabled: enableWaitingRoom,
                auto_admit: !enableWaitingRoom,
            },
        });

        if (result.success && result.data) {
            log(`✅ Meeting scheduled: ${result.data.meeting_code}`);
            setShowScheduleDialog(false);
            setScheduleForm({ title: '', description: '', scheduledStart: '', scheduledEnd: '', invitedUserIds: '' });
            
            // Refresh meetings list
            const meetingsResult = await getMyMeetings();
            if (meetingsResult.success && meetingsResult.data) {
                setMyMeetings(meetingsResult.data);
            }
        } else {
            log(`❌ Failed to schedule: ${result.error}`);
        }
    };

    // Start a scheduled meeting
    const handleStartScheduledMeeting = async (meetingId: string) => {
        log('▶️ Starting meeting...');
        const result = await startMeeting(meetingId);
        if (result.success && result.data) {
            setCurrentMeeting(result.data);
            setShouldAutoJoin(true);
            setIsHost(true);
        } else {
            log(`❌ Failed to start: ${result.error}`);
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
            
            const admissionCheck = await checkAdmissionRequired(result.data.meeting.id);
            if (admissionCheck.success && admissionCheck.data?.required) {
                log('🚪 Waiting room enabled - requesting admission...');
                const admissionResult = await requestAdmission(result.data.meeting.id);
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
        setParticipants([]);
        setChatMessages([]);
        setIsHost(false);
        setRaisedHands([]);
        setReactions([]);
        log('👋 Left meeting');
    };

    // End meeting (host only)
    const handleEndMeeting = async () => {
        if (!currentMeeting) return;
        
        log('🛑 Ending meeting...');
        const result = await apiEndMeeting(currentMeeting.id);
        if (result.success) {
            handleLeaveMeeting();
        } else {
            log(`❌ Failed to end: ${result.error}`);
        }
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
            // DON'T set isInCall or join WebRTC yet!
            // Wait for call-accepted event before joining
            log('⏳ Waiting for callee to answer...');
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
            
            const meetingResult = await getMeetingById(incomingCall.meetingId);
            if (meetingResult.success && meetingResult.data) {
                setCurrentMeeting(meetingResult.data);
                setShouldAutoJoin(true);
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
    // HOST CONTROL FUNCTIONS
    // ============================================

    const handleMuteAll = async (mute: boolean) => {
        if (!currentMeeting) return;
        
        log(`${mute ? '🔇 Muting' : '🔊 Unmuting'} all participants...`);
        const result = await muteAllParticipants(currentMeeting.id, mute);
        if (result.success) {
            log(`✅ ${mute ? 'Muted' : 'Unmuted'} ${result.data?.affectedCount || 0} participants`);
            setIsAllMuted(mute);
        } else {
            log(`❌ Failed: ${result.error}`);
        }
    };

    const handleAddCoHost = async () => {
        if (!currentMeeting || !coHostUserId.trim()) return;
        
        log(`👑 Adding co-host: ${coHostUserId}...`);
        const result = await addCoHost(currentMeeting.id, coHostUserId);
        if (result.success) {
            log('✅ Co-host added');
            setCoHostUserId('');
            refreshParticipants(currentMeeting.id);
        } else {
            log(`❌ Failed: ${result.error}`);
        }
    };

    const handleRemoveCoHost = async (userId: string) => {
        if (!currentMeeting) return;
        
        log(`👑 Removing co-host: ${userId}...`);
        const result = await removeCoHost(currentMeeting.id, userId);
        if (result.success) {
            log('✅ Co-host removed');
            refreshParticipants(currentMeeting.id);
        } else {
            log(`❌ Failed: ${result.error}`);
        }
    };

    const handleRemoveParticipant = async (userId: string) => {
        if (!currentMeeting) return;
        
        log(`🚫 Removing participant: ${userId}...`);
        const result = await removeParticipant(currentMeeting.id, userId);
        if (result.success) {
            log('✅ Participant removed');
            refreshParticipants(currentMeeting.id);
        } else {
            log(`❌ Failed: ${result.error}`);
        }
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

    // ============================================
    // CHAT FUNCTIONS
    // ============================================

    const handleSendMessage = () => {
        if (!chatInput.trim() || !currentMeeting || !socketRef.current) return;
        
        socketRef.current.emit('send-message', {
            meetingId: currentMeeting.id,
            message: chatInput,
            recipientType: 'all',
        });
        
        setChatInput('');
    };

    const handleTyping = (typing: boolean) => {
        if (!currentMeeting || !socketRef.current) return;
        socketRef.current.emit('typing', { meetingId: currentMeeting.id, typing });
    };

    // ============================================
    // REACTIONS & HAND RAISE
    // ============================================

    const sendReaction = (emoji: string) => {
        if (!currentMeeting || !socketRef.current) return;
        socketRef.current.emit('send-reaction', { meetingId: currentMeeting.id, reaction: emoji });
    };

    const toggleHandRaise = () => {
        if (!currentMeeting || !socketRef.current) return;
        const newState = !isHandRaised;
        socketRef.current.emit('raise-hand', { meetingId: currentMeeting.id, raised: newState });
        setIsHandRaised(newState);
    };

    // ============================================
    // RECORDING
    // ============================================

    const toggleRecording = () => {
        if (!currentMeeting || !socketRef.current) return;
        socketRef.current.emit('toggle-recording', { meetingId: currentMeeting.id, start: !isRecording });
    };

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
                <p>Complete Meeting Features</p>
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

            {/* Schedule Meeting Dialog */}
            {showScheduleDialog && (
                <div className="modal-overlay">
                    <div className="modal schedule-modal">
                        <h2>📅 Schedule Meeting</h2>
                        <div className="form-group">
                            <label>Title:</label>
                            <input 
                                type="text"
                                value={scheduleForm.title}
                                onChange={e => setScheduleForm({...scheduleForm, title: e.target.value})}
                                placeholder="Meeting title"
                            />
                        </div>
                        <div className="form-group">
                            <label>Description:</label>
                            <textarea 
                                value={scheduleForm.description}
                                onChange={e => setScheduleForm({...scheduleForm, description: e.target.value})}
                                placeholder="Optional description"
                            />
                        </div>
                        <div className="form-group">
                            <label>Start Time:</label>
                            <input 
                                type="datetime-local"
                                value={scheduleForm.scheduledStart}
                                onChange={e => setScheduleForm({...scheduleForm, scheduledStart: e.target.value})}
                            />
                        </div>
                        <div className="form-group">
                            <label>End Time (optional):</label>
                            <input 
                                type="datetime-local"
                                value={scheduleForm.scheduledEnd}
                                onChange={e => setScheduleForm({...scheduleForm, scheduledEnd: e.target.value})}
                            />
                        </div>
                        <div className="form-group">
                            <label>Invite User IDs (comma-separated):</label>
                            <input 
                                type="text"
                                value={scheduleForm.invitedUserIds}
                                onChange={e => setScheduleForm({...scheduleForm, invitedUserIds: e.target.value})}
                                placeholder="user-id-1, user-id-2"
                            />
                        </div>
                        <div className="button-group">
                            <button onClick={handleCreateScheduledMeeting} className="btn-success">
                                Schedule
                            </button>
                            <button onClick={() => setShowScheduleDialog(false)} className="btn-danger">
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Floating Reactions */}
            <div className="reactions-container">
                {reactions.map(r => (
                    <div key={r.id} className="floating-reaction">
                        {r.reaction}
                    </div>
                ))}
            </div>

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

            {/* Tab Navigation */}
            {isConnected && !currentMeeting && (
                <div className="tabs">
                    <button 
                        className={`tab ${activeTab === 'meeting' ? 'active' : ''}`}
                        onClick={() => setActiveTab('meeting')}
                    >
                        🎬 Instant Meeting
                    </button>
                    <button 
                        className={`tab ${activeTab === 'call' ? 'active' : ''}`}
                        onClick={() => setActiveTab('call')}
                    >
                        📞 Direct Call
                    </button>
                    <button 
                        className={`tab ${activeTab === 'schedule' ? 'active' : ''}`}
                        onClick={() => setActiveTab('schedule')}
                    >
                        📅 Scheduled
                    </button>
                </div>
            )}

            {/* Instant Meeting Tab */}
            {activeTab === 'meeting' && !currentMeeting && (
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
            )}

            {/* Direct Call Tab */}
            {activeTab === 'call' && !currentMeeting && (
                <section className="section">
                    <h2>📞 Direct 1:1 Call</h2>
                    <div className="form-group">
                        <label>User ID to call:</label>
                        <input 
                            type="text" 
                            value={calleeId}
                            onChange={(e) => setCalleeId(e.target.value)}
                            placeholder="Enter user ID"
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
                    </div>
                    {callStatus && <p className="call-status">{callStatus}</p>}
                </section>
            )}

            {/* Scheduled Meetings Tab */}
            {activeTab === 'schedule' && !currentMeeting && (
                <section className="section">
                    <h2>📅 Scheduled Meetings</h2>
                    <button onClick={() => setShowScheduleDialog(true)} className="btn-success">
                        + New Scheduled Meeting
                    </button>
                    
                    <div className="meetings-list">
                        {myMeetings.filter(m => m.meeting_status === 'scheduled').map(meeting => (
                            <div key={meeting.id} className="meeting-card">
                                <h3>{meeting.title}</h3>
                                <p>Code: <code>{meeting.meeting_code}</code></p>
                                <p>Status: {meeting.meeting_status}</p>
                                <div className="button-group">
                                    <button 
                                        onClick={() => handleStartScheduledMeeting(meeting.id)}
                                        className="btn-success"
                                    >
                                        ▶️ Start
                                    </button>
                                </div>
                            </div>
                        ))}
                        {myMeetings.filter(m => m.meeting_status === 'scheduled').length === 0 && (
                            <p className="no-meetings">No scheduled meetings</p>
                        )}
                    </div>
                </section>
            )}

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
                <>
                    <section className="section meeting-info">
                        <h2>📋 Current Meeting {isHost && <span className="host-badge">👑 HOST</span>}</h2>
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

                        {/* Dynamic Optimization Display */}
                        {meetingTier && optimization && (
                            <div className="optimization-info">
                                <p>
                                    <strong>🎚️ Meeting Tier:</strong>{' '}
                                    <span className={`tier-badge tier-${meetingTier.toLowerCase()}`}>
                                        {meetingTier}
                                    </span>
                                    <span style={{ marginLeft: 8, opacity: 0.7 }}>
                                        ({optimization.config.participantCount} participants)
                                    </span>
                                </p>
                            </div>
                        )}

                        {/* Raised Hands */}
                        {raisedHands.length > 0 && (
                            <div className="raised-hands">
                                <strong>✋ Raised Hands:</strong>
                                {raisedHands.map(h => (
                                    <span key={h.participantId} className="hand-badge">{h.userName}</span>
                                ))}
                            </div>
                        )}

                        {/* Media Controls */}
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
                        </div>

                        {/* Reactions */}
                        <div className="reactions-bar">
                            <button onClick={() => sendReaction('👍')}>👍</button>
                            <button onClick={() => sendReaction('👏')}>👏</button>
                            <button onClick={() => sendReaction('❤️')}>❤️</button>
                            <button onClick={() => sendReaction('😂')}>😂</button>
                            <button onClick={() => sendReaction('🎉')}>🎉</button>
                            <button onClick={toggleHandRaise} className={isHandRaised ? 'btn-active' : ''}>
                                ✋ {isHandRaised ? 'Lower' : 'Raise'}
                            </button>
                        </div>

                        {/* Leave/End */}
                        <div className="button-group">
                            <button onClick={() => setShowChat(!showChat)} className="btn-secondary">
                                💬 Chat
                            </button>
                            {isHost && (
                                <>
                                    <button onClick={toggleRecording} className={isRecording ? 'btn-danger' : 'btn-secondary'}>
                                        {isRecording ? '⏹️ Stop Recording' : '🎥 Record'}
                                    </button>
                                    <button onClick={handleEndMeeting} className="btn-danger">
                                        🛑 End Meeting
                                    </button>
                                </>
                            )}
                            <button onClick={handleLeaveMeeting} className="btn-danger">
                                👋 Leave
                            </button>
                            {isInCall && (
                                <button onClick={handleEndCall} className="btn-danger">
                                    📴 End Call
                                </button>
                            )}
                        </div>
                    </section>

                    {/* Host Controls */}
                    {isHost && (
                        <section className="section host-controls">
                            <h2>👑 Host Controls</h2>
                            
                            {/* Mute All */}
                            <div className="button-group">
                                <button onClick={() => handleMuteAll(true)} className="btn-secondary">
                                    🔇 Mute All
                                </button>
                                <button onClick={() => handleMuteAll(false)} className="btn-secondary">
                                    🔊 Unmute All
                                </button>
                            </div>

                            {/* Co-Host Management */}
                            <div className="form-group">
                                <label>Add Co-Host:</label>
                                <div className="input-group">
                                    <input 
                                        type="text"
                                        value={coHostUserId}
                                        onChange={e => setCoHostUserId(e.target.value)}
                                        placeholder="User ID"
                                    />
                                    <button onClick={handleAddCoHost} className="btn-success">
                                        Add
                                    </button>
                                </div>
                            </div>

                            {/* Participants List */}
                            <h3>Participants ({participants.length})</h3>
                            <div className="participants-list">
                                {participants.map(p => (
                                    <div key={p.id} className="participant-item">
                                        <span>
                                            {p.participant_name} 
                                            {p.permissions.is_host && ' 👑'}
                                            {p.permissions.is_co_host && ' 🎖️'}
                                        </span>
                                        <div className="participant-actions">
                                            {p.permissions.is_co_host && (
                                                <button 
                                                    onClick={() => handleRemoveCoHost(p.user_id)}
                                                    className="btn-small btn-secondary"
                                                >
                                                    Remove Co-Host
                                                </button>
                                            )}
                                            {!p.permissions.is_host && (
                                                <button 
                                                    onClick={() => handleRemoveParticipant(p.user_id)}
                                                    className="btn-small btn-danger"
                                                >
                                                    Remove
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Chat Panel */}
                    {showChat && (
                        <section className="section chat-section">
                            <h2>💬 Chat</h2>
                            <div className="chat-messages">
                                {chatMessages.map((msg, i) => (
                                    <div key={msg.id || i} className="chat-message">
                                        <strong>{msg.sender_name}:</strong> {msg.message}
                                    </div>
                                ))}
                            </div>
                            {typingUsers.length > 0 && (
                                <p className="typing-indicator">{typingUsers.join(', ')} typing...</p>
                            )}
                            <div className="chat-input">
                                <input 
                                    type="text"
                                    value={chatInput}
                                    onChange={e => setChatInput(e.target.value)}
                                    onFocus={() => handleTyping(true)}
                                    onBlur={() => handleTyping(false)}
                                    onKeyPress={e => e.key === 'Enter' && handleSendMessage()}
                                    placeholder="Type a message..."
                                />
                                <button onClick={handleSendMessage} className="btn-primary">
                                    Send
                                </button>
                            </div>
                        </section>
                    )}
                </>
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
                                {/* Stable key - do NOT use _updateTs as it causes element recreation */}
                                <video 
                                    key={`video-${odId}`}
                                    autoPlay 
                                    playsInline
                                    muted
                                    ref={(el) => {
                                        if (el && participant.cameraStream) {
                                            if (el.srcObject !== participant.cameraStream) {
                                                console.log('📹 Setting video srcObject for', odId, 'tracks:', participant.cameraStream.getTracks().length);
                                                el.srcObject = participant.cameraStream;
                                                // Don't call play() here - autoPlay handles it
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
                                    key={`screen-${odId}`}
                                    autoPlay 
                                    playsInline
                                    muted
                                    ref={(el) => {
                                        if (el && participant.screenStream) {
                                            if (el.srcObject !== participant.screenStream) {
                                                el.srcObject = participant.screenStream;
                                            }
                                        }
                                    }}
                                />
                                <div className="video-label">🖥️ {participant.userName} - Screen</div>
                            </div>
                        )}

                        {participant.audioStream && (
                            <audio
                                key={`audio-${odId}`}
                                autoPlay
                                ref={(el) => {
                                    if (el && participant.audioStream) {
                                        if (el.srcObject !== participant.audioStream) {
                                            console.log('🔊 Setting audio srcObject for', odId, 'tracks:', participant.audioStream.getAudioTracks().length);
                                            el.srcObject = participant.audioStream;
                                            // Ensure not muted for audio
                                            el.muted = false;
                                            el.volume = 1.0;
                                        }
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