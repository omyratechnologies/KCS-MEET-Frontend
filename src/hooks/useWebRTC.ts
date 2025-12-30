import { useRef, useEffect, useState, useCallback } from 'react';
import { Device, types as mediasoupTypes } from 'mediasoup-client';
import { io, Socket } from 'socket.io-client';
import { getAuthToken, getWebRTCConfig, type Meeting } from '../api/meeting';

// Socket.IO server is on a separate subdomain
const SOCKET_URL = 'https://devws.letscatchup-kcs.com';

// ============================================
// DYNAMIC OPTIMIZATION TYPES (from backend)
// ============================================

// Meeting tier type (compatible with erasableSyntaxOnly)
export type MeetingTier = "SMALL" | "MEDIUM" | "LARGE" | "MASSIVE";

// Meeting tier constants for reference
export const MeetingTiers = {
    SMALL: "SMALL" as const,       // 1-5 participants
    MEDIUM: "MEDIUM" as const,     // 6-15 participants
    LARGE: "LARGE" as const,       // 16-30 participants
    MASSIVE: "MASSIVE" as const,   // 31+ participants
} as const;

export interface DynamicMeetingConfig {
    tier: MeetingTier;
    participantCount: number;

    video: {
        maxBitrate: number;
        recommendedWidth: number;
        recommendedHeight: number;
        recommendedFps: number;
        preferredLayer: number;
        enableSimulcast: boolean;
    };

    audio: {
        maxBitrate: number;
        echoCancellation: boolean;
        noiseSuppression: boolean;
        autoGainControl: boolean;
    };

    screenShare: {
        maxBitrate: number;
        maxFps: number;
    };

    transport: {
        initialBitrate: number;
    };

    features: {
        enableVideoByDefault: boolean;
        enableAudioByDefault: boolean;
        showAllThumbnails: boolean;
        maxVisibleThumbnails: number;
        enableActiveSpeakerMode: boolean;
    };
}

export interface BandwidthEstimate {
    perParticipantUpload: number;
    perParticipantDownload: number;
    totalServerBandwidth: number;
}

export interface SimulcastEncoding {
    rid: string;
    maxBitrate: number;
    scaleResolutionDownBy: number;
    scalabilityMode?: string;
}

export interface OptimizationData {
    config: DynamicMeetingConfig;
    simulcastEncodings: SimulcastEncoding[];
    bandwidthEstimate: BandwidthEstimate;
}

interface RemoteParticipant {
    odId: string;
    userName: string;
    cameraStream: MediaStream | null;
    screenStream: MediaStream | null;
    audioStream: MediaStream | null; // Separate audio stream
    _updateTs?: number; // Timestamp to force React re-renders
}

interface UseWebRTCReturn {
    localVideoRef: React.RefObject<HTMLVideoElement | null>;
    remoteParticipants: Map<string, RemoteParticipant>;
    isConnected: boolean;
    isAudioEnabled: boolean;
    isVideoEnabled: boolean;
    isScreenSharing: boolean;
    connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'fallback';
    error: string | null;
    // Dynamic optimization data
    optimization: OptimizationData | null;
    meetingTier: MeetingTier | null;
    // Actions
    startCamera: () => Promise<void>;
    startMicrophone: () => Promise<void>;
    stopCamera: () => void;
    stopMicrophone: () => void;
    toggleVideo: () => void;
    toggleAudio: () => void;
    startScreenShare: () => Promise<void>;
    stopScreenShare: () => void;
    toggleScreenShare: () => void;
    joinMeeting: () => Promise<void>;
    leaveMeeting: () => void;
}

export const useWebRTC = ({ meeting }: { meeting: Meeting | null }): UseWebRTCReturn => {
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const [remoteParticipants, setRemoteParticipants] = useState<Map<string, RemoteParticipant>>(new Map());
    const [isConnected, setIsConnected] = useState(false);
    const [isAudioEnabled, setIsAudioEnabled] = useState(false);
    const [isVideoEnabled, setIsVideoEnabled] = useState(false);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'fallback'>('disconnected');

    // Dynamic optimization state
    const [optimization, setOptimization] = useState<OptimizationData | null>(null);
    const [meetingTier, setMeetingTier] = useState<MeetingTier | null>(null);
    const [error, setError] = useState<string | null>(null);

    const socketRef = useRef<Socket | null>(null);
    const deviceRef = useRef<Device | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const screenStreamRef = useRef<MediaStream | null>(null);
    const sendTransportRef = useRef<mediasoupTypes.Transport | null>(null);
    const recvTransportRef = useRef<mediasoupTypes.Transport | null>(null);
    const producersRef = useRef<Map<string, mediasoupTypes.Producer>>(new Map());
    const consumersRef = useRef<Map<string, mediasoupTypes.Consumer>>(new Map());
    const consumedProducersRef = useRef<Set<string>>(new Set()); // Track already consumed producers
    // Store appData per producerId to identify screen shares (even if server doesn't echo it back)
    const producerAppDataRef = useRef<Map<string, { type?: string }>>(new Map());
    // Persistent streams per participant - now separated by type
    const remoteStreamsRef = useRef<Map<string, {
        camera: MediaStream | null;
        screen: MediaStream | null;
        audio: MediaStream | null;
    }>>(new Map());

    // Start camera
    const startCamera = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false,
            });

            if (localStreamRef.current) {
                const videoTrack = stream.getVideoTracks()[0];
                localStreamRef.current.addTrack(videoTrack);
            } else {
                localStreamRef.current = stream;
            }

            if (localVideoRef.current) {
                localVideoRef.current.srcObject = localStreamRef.current;
            }

            setIsVideoEnabled(true);
            console.log('✅ Camera started');

            // Produce video if transport is ready
            if (sendTransportRef.current && meeting) {
                const track = localStreamRef.current.getVideoTracks()[0];
                if (track) {
                    try {
                        const producer = await sendTransportRef.current.produce({ track });
                        producersRef.current.set('video', producer);
                        console.log('✅ Video producer created:', producer.id);
                    } catch (err) {
                        console.error('Failed to produce video:', err);
                    }
                }
            }
        } catch (err) {
            setError(`Camera error: ${err}`);
            console.error('Camera error:', err);
        }
    }, [meeting]);

    // Start microphone
    const startMicrophone = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                video: false,
            });

            if (localStreamRef.current) {
                const audioTrack = stream.getAudioTracks()[0];
                localStreamRef.current.addTrack(audioTrack);
            } else {
                localStreamRef.current = stream;
            }

            setIsAudioEnabled(true);
            console.log('✅ Microphone started');

            // Produce audio if transport is ready
            if (sendTransportRef.current && meeting) {
                const track = localStreamRef.current.getAudioTracks()[0];
                if (track) {
                    try {
                        const producer = await sendTransportRef.current.produce({ track });
                        producersRef.current.set('audio', producer);
                        console.log('✅ Audio producer created:', producer.id);
                    } catch (err) {
                        console.error('Failed to produce audio:', err);
                    }
                }
            }
        } catch (err) {
            setError(`Microphone error: ${err}`);
            console.error('Microphone error:', err);
        }
    }, [meeting]);

    // Stop camera
    const stopCamera = useCallback(() => {
        if (localStreamRef.current) {
            localStreamRef.current.getVideoTracks().forEach(track => {
                track.stop();
                localStreamRef.current?.removeTrack(track);
            });
            setIsVideoEnabled(false);
        }
        const videoProducer = producersRef.current.get('video');
        if (videoProducer && socketRef.current && meeting) {
            // Notify server to close producer and tell other participants
            socketRef.current.emit('close-producer', {
                meetingId: meeting.id,
                producerId: videoProducer.id,
                kind: 'video',
            });
            videoProducer.close();
            producersRef.current.delete('video');
        }
        console.log('📹 Camera stopped');
    }, [meeting]);

    // Stop microphone
    const stopMicrophone = useCallback(() => {
        if (localStreamRef.current) {
            localStreamRef.current.getAudioTracks().forEach(track => {
                track.stop();
                localStreamRef.current?.removeTrack(track);
            });
            setIsAudioEnabled(false);
        }
        const audioProducer = producersRef.current.get('audio');
        if (audioProducer && socketRef.current && meeting) {
            // Notify server to close producer and tell other participants
            socketRef.current.emit('close-producer', {
                meetingId: meeting.id,
                producerId: audioProducer.id,
                kind: 'audio',
            });
            audioProducer.close();
            producersRef.current.delete('audio');
        }
        console.log('🎤 Microphone stopped');
    }, [meeting]);

    const toggleVideo = useCallback(() => {
        if (isVideoEnabled) stopCamera();
        else startCamera();
    }, [isVideoEnabled, startCamera, stopCamera]);

    const toggleAudio = useCallback(() => {
        if (isAudioEnabled) stopMicrophone();
        else startMicrophone();
    }, [isAudioEnabled, startMicrophone, stopMicrophone]);

    // Start screen sharing
    const startScreenShare = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                    frameRate: { ideal: 30 },
                },
                audio: true, // Enable system audio (works on Chrome, shares tab/system audio)
            });

            screenStreamRef.current = stream;
            setIsScreenSharing(true);
            console.log('✅ Screen share started with tracks:', stream.getTracks().map(t => t.kind).join(', '));

            // Handle when user stops sharing via browser UI
            stream.getVideoTracks()[0].onended = () => {
                console.log('🛑 Screen share ended by user');
                stopScreenShare();
            };

            // Produce screen share video if transport is ready
            if (sendTransportRef.current && meeting) {
                const videoTrack = stream.getVideoTracks()[0];
                if (videoTrack) {
                    try {
                        const producer = await sendTransportRef.current.produce({
                            track: videoTrack,
                            appData: { type: 'screen' }, // Mark as screen share
                        });
                        producersRef.current.set('screen', producer);
                        console.log('✅ Screen share video producer created:', producer.id);
                    } catch (err) {
                        console.error('Failed to produce screen share video:', err);
                    }
                }

                // Also produce screen share audio if available
                const audioTrack = stream.getAudioTracks()[0];
                if (audioTrack) {
                    try {
                        const audioProducer = await sendTransportRef.current.produce({
                            track: audioTrack,
                            appData: { type: 'screenAudio' }, // Mark as screen share audio
                        });
                        producersRef.current.set('screenAudio', audioProducer);
                        console.log('✅ Screen share audio producer created:', audioProducer.id);
                    } catch (err) {
                        console.error('Failed to produce screen share audio:', err);
                    }
                } else {
                    console.log('ℹ️ No audio track from screen share (browser may not support it or user declined)');
                }
            }
        } catch (err) {
            // User cancelled or error
            if ((err as Error).name === 'NotAllowedError') {
                console.log('📺 Screen share cancelled by user');
            } else {
                setError(`Screen share error: ${err}`);
                console.error('Screen share error:', err);
            }
        }
    }, [meeting]);

    // Stop screen sharing
    const stopScreenShare = useCallback(() => {
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(track => {
                track.stop();
            });
            screenStreamRef.current = null;
            setIsScreenSharing(false);
        }

        // Close screen video producer
        const screenProducer = producersRef.current.get('screen');
        if (screenProducer && socketRef.current && meeting) {
            socketRef.current.emit('close-producer', {
                meetingId: meeting.id,
                producerId: screenProducer.id,
                kind: 'video',
                appData: { type: 'screen' },
            });
            screenProducer.close();
            producersRef.current.delete('screen');
        }

        // Close screen audio producer
        const screenAudioProducer = producersRef.current.get('screenAudio');
        if (screenAudioProducer && socketRef.current && meeting) {
            socketRef.current.emit('close-producer', {
                meetingId: meeting.id,
                producerId: screenAudioProducer.id,
                kind: 'audio',
                appData: { type: 'screenAudio' },
            });
            screenAudioProducer.close();
            producersRef.current.delete('screenAudio');
        }

        console.log('🖥️ Screen share stopped');
    }, [meeting]);

    const toggleScreenShare = useCallback(() => {
        if (isScreenSharing) stopScreenShare();
        else startScreenShare();
    }, [isScreenSharing, startScreenShare, stopScreenShare]);

    // Join meeting
    const joinMeeting = useCallback(async () => {
        if (!meeting) {
            setError('No meeting selected');
            return;
        }

        console.log('🚀 Starting WebRTC join for meeting:', meeting.id);
        setConnectionStatus('connecting');
        setError(null);

        try {
            // Get WebRTC config
            console.log('📡 Fetching WebRTC config...');
            const configResponse = await getWebRTCConfig(meeting.id);
            console.log('📡 WebRTC config response:', configResponse);

            if (!configResponse.success || !configResponse.data) {
                throw new Error(configResponse.error || 'Failed to get WebRTC config');
            }

            const config = configResponse.data;

            if (config.routerError || !config.rtpCapabilities) {
                console.warn('⚠️ Router issue - fallback mode');
                setConnectionStatus('fallback');
                return;
            }

            // Initialize mediasoup device
            console.log('📱 Loading MediaSoup device...');
            const device = new Device();
            await device.load({ routerRtpCapabilities: config.rtpCapabilities });
            deviceRef.current = device;
            console.log('✅ MediaSoup device loaded');

            // Connect to Socket.IO
            console.log('🔌 Connecting to Socket.IO at:', SOCKET_URL);
            const token = getAuthToken();
            const socket = io(SOCKET_URL, {
                auth: { token },
                transports: ['polling', 'websocket'],
                upgrade: true,
                timeout: 20000,
            });

            socketRef.current = socket;

            socket.on('connect', () => {
                console.log('✅ Socket connected, socket.id:', socket.id);
                socket.emit('join-meeting', { meetingId: meeting.id });
            });

            socket.on('connect_error', (err: Error) => {
                console.error('❌ Socket connect_error:', err.message);
                setError(`Socket connection failed: ${err.message}`);
                setConnectionStatus('fallback');
            });

            // Store pending producers to consume after transport is ready
            let pendingProducers: Array<{ participantId: string; producerId: string; kind: 'audio' | 'video' }> = [];

            // Meeting joined - create transports
            socket.on('meeting-joined', async (data: any) => {
                console.log('✅ Joined meeting:', data);
                setIsConnected(true);
                setConnectionStatus('connected');

                // 🎚️ Capture dynamic optimization config from server
                if (data.optimization) {
                    console.log('🎚️ Meeting optimization config:', data.optimization);
                    setOptimization(data.optimization);
                    setMeetingTier(data.optimization.config?.tier || null);
                    
                    // Log the tier and recommended settings
                    const config = data.optimization.config;
                    if (config) {
                        console.log(`📊 Meeting tier: ${config.tier} (${config.participantCount} participants)`);
                        console.log(`📹 Video: ${config.video.recommendedWidth}x${config.video.recommendedHeight}@${config.video.recommendedFps}fps, max ${config.video.maxBitrate/1000}kbps`);
                        console.log(`🎙️ Audio: max ${config.audio.maxBitrate/1000}kbps`);
                        console.log(`🎯 Features: video by default=${config.features.enableVideoByDefault}, audio by default=${config.features.enableAudioByDefault}`);
                    }
                }

                // Store existing producers to consume after transport is ready
                if (data.existingProducers && data.existingProducers.length > 0) {
                    console.log('📋 Existing producers to consume:', data.existingProducers);
                    pendingProducers = data.existingProducers;
                }

                // Create send and receive transports
                socket.emit('create-transport', { meetingId: meeting.id, direction: 'send' });
                socket.emit('create-transport', { meetingId: meeting.id, direction: 'recv' });
            });

            // Transport created
            socket.on('transport-created', async (data: { direction: string; params: any }) => {
                console.log(`✅ Transport created (${data.direction}):`, data.params.id);

                const transportOptions = {
                    id: data.params.id,
                    iceParameters: data.params.iceParameters,
                    iceCandidates: data.params.iceCandidates,
                    dtlsParameters: data.params.dtlsParameters,
                };

                if (data.direction === 'send') {
                    const transport = device.createSendTransport(transportOptions);
                    sendTransportRef.current = transport;

                    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                        try {
                            console.log('🔗 Send transport connecting...');
                            socket.emit('connect-transport', { transportId: transport.id, dtlsParameters });

                            // Listen for THIS specific transport's connection confirmation
                            const handler = (response: { transportId: string }) => {
                                if (response.transportId === transport.id) {
                                    console.log('🔗 Send transport connected!');
                                    socket.off('transport-connected', handler);
                                    callback();
                                }
                            };
                            socket.on('transport-connected', handler);
                        } catch (err) {
                            errback(err as Error);
                        }
                    });

                    transport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
                        try {
                            // Generate unique request ID to match response
                            const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                            console.log(`📤 Producing ${kind}, requestId: ${requestId}`);

                            socket.emit('produce', {
                                meetingId: meeting.id,
                                kind,
                                rtpParameters,
                                requestId,
                                appData, // Pass appData to identify screen share
                            });

                            // Listen for the specific response
                            const handler = (response: { producerId: string; requestId?: string }) => {
                                // Match by requestId if available, otherwise accept any
                                if (!response.requestId || response.requestId === requestId) {
                                    console.log(`📥 Producer created: ${response.producerId}`);
                                    socket.off('produced', handler);
                                    callback({ id: response.producerId });
                                }
                            };
                            socket.on('produced', handler);

                            // Timeout fallback
                            setTimeout(() => {
                                socket.off('produced', handler);
                            }, 10000);
                        } catch (err) {
                            errback(err as Error);
                        }
                    });

                    console.log('✅ Send transport ready');
                } else {
                    const transport = device.createRecvTransport(transportOptions);
                    recvTransportRef.current = transport;

                    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                        try {
                            console.log('🔗 Recv transport connecting...');
                            socket.emit('connect-transport', { transportId: transport.id, dtlsParameters });

                            // Listen for THIS specific transport's connection confirmation
                            const handler = (response: { transportId: string }) => {
                                if (response.transportId === transport.id) {
                                    console.log('🔗 Recv transport connected!');
                                    socket.off('transport-connected', handler);
                                    callback();
                                }
                            };
                            socket.on('transport-connected', handler);
                        } catch (err) {
                            errback(err as Error);
                        }
                    });

                    console.log('✅ Receive transport ready');

                    // Now consume any pending producers
                    if (pendingProducers.length > 0 && deviceRef.current) {
                        console.log('🎬 Consuming pending producers:', pendingProducers.length);
                        for (const producer of pendingProducers) {
                            socket.emit('consume', {
                                meetingId: meeting.id,
                                producerParticipantId: producer.participantId,
                                producerId: producer.producerId,
                                kind: producer.kind,
                                rtpCapabilities: deviceRef.current.rtpCapabilities,
                            });
                        }
                        pendingProducers = [];
                    }
                }
            });

            // New producer from another participant
            socket.on('new-producer', async (data: {
                participantId: string;
                producerId: string;
                kind: 'audio' | 'video';
                appData?: { type?: string };
            }) => {
                console.log('🎬 New producer from participant:', data);

                // Skip if already consumed this producer
                if (consumedProducersRef.current.has(data.producerId)) {
                    console.log('⏭️ Already consumed this producer, skipping:', data.producerId);
                    return;
                }

                if (!recvTransportRef.current || !deviceRef.current) {
                    console.log('No receive transport yet');
                    return;
                }

                // Store appData for this producer so we can identify it later
                // (in case server doesn't echo appData back in consumed response)
                if (data.appData) {
                    producerAppDataRef.current.set(data.producerId, data.appData);
                }

                // Mark as consumed before emitting to prevent race conditions
                consumedProducersRef.current.add(data.producerId);

                socket.emit('consume', {
                    meetingId: meeting.id,
                    producerParticipantId: data.participantId,
                    producerId: data.producerId,
                    kind: data.kind,
                    rtpCapabilities: deviceRef.current.rtpCapabilities,
                    appData: data.appData, // Pass appData to identify screen share
                });
            });

            // Consumed media - add to remote participants
            socket.on('consumed', async (data: any) => {
                console.log('📺 Consumed media:', data);

                if (!recvTransportRef.current) return;

                try {
                    const consumer = await recvTransportRef.current.consume({
                        id: data.id,
                        producerId: data.producerId,
                        kind: data.kind,
                        rtpParameters: data.rtpParameters,
                    });

                    consumersRef.current.set(data.id, consumer);

                    // IMPORTANT: Resume the consumer on BOTH server and client side!
                    // The consumer starts paused and must be resumed for media to flow
                    socket.emit('resume-consumer', { consumerId: data.id });
                    await consumer.resume();
                    console.log(`▶️ Consumer resumed:`, data.id, 'paused:', consumer.paused);

                    const participantId = data.producerParticipantId;
                    const track = consumer.track;

                    // Get appData from stored map (from new-producer) or from response
                    const storedAppData = producerAppDataRef.current.get(data.producerId);
                    const appData = data.appData || storedAppData;
                    const isScreen = appData?.type === 'screen';
                    const isScreenAudio = appData?.type === 'screenAudio';

                    console.log(`🎬 Got ${data.kind} track (${isScreen ? 'screen' : isScreenAudio ? 'screenAudio' : 'camera/mic'}):`,
                        track.id, 'enabled:', track.enabled, 'readyState:', track.readyState, 'muted:', track.muted, 'appData:', appData);

                    // Add event listeners to track RTP flow
                    track.onunmute = () => {
                        console.log('📡 Track UNMUTED - receiving RTP data!', track.id);
                    };
                    track.onmute = () => {
                        console.log('🔇 Track MUTED - no RTP data', track.id);
                    };
                    track.onended = () => {
                        console.log('⏹️ Track ENDED', track.id);
                    };

                    // Get or create persistent streams structure for this participant
                    let streams = remoteStreamsRef.current.get(participantId);
                    if (!streams) {
                        streams = { camera: null, screen: null, audio: null };
                        remoteStreamsRef.current.set(participantId, streams);
                    }

                    // Determine which stream to use based on track type
                    if (data.kind === 'video') {
                        if (isScreen) {
                            // Screen share video
                            if (!streams.screen) {
                                streams.screen = new MediaStream();
                            }
                            streams.screen.addTrack(track);
                            console.log(`✅ Added screen video track for:`, participantId);
                        } else {
                            // Camera video
                            if (!streams.camera) {
                                streams.camera = new MediaStream();
                            }
                            streams.camera.addTrack(track);
                            console.log(`✅ Added camera video track for:`, participantId);
                        }
                    } else if (data.kind === 'audio') {
                        // Audio (mic or screen audio) - add to audio stream
                        if (!streams.audio) {
                            streams.audio = new MediaStream();
                        }
                        streams.audio.addTrack(track);
                        console.log(`✅ Added audio track (${isScreenAudio ? 'screen' : 'mic'}) for:`, participantId);
                    }

                    // Force React to re-render by creating a new participant object
                    setRemoteParticipants(prev => {
                        const newMap = new Map(prev);
                        const existing = newMap.get(participantId);

                        // Always create a new object to force React re-render
                        newMap.set(participantId, {
                            odId: participantId,
                            userName: existing?.userName || 'Participant',
                            cameraStream: streams!.camera,
                            screenStream: streams!.screen,
                            audioStream: streams!.audio,
                            _updateTs: Date.now(),
                        });

                        return newMap;
                    });
                } catch (err) {
                    console.error('Failed to consume:', err);
                }
            });

            socket.on('participant-joined', (data: any) => {
                console.log('👤 Participant joined:', data);
            });

            socket.on('participant-left', (data: any) => {
                console.log('👋 Participant left:', data);
                setRemoteParticipants(prev => {
                    const newMap = new Map(prev);
                    newMap.delete(data.participantId);
                    return newMap;
                });
                // Clean up the stream ref
                remoteStreamsRef.current.delete(data.participantId);
            });

            // Handle producer closed (when someone turns off camera/mic)
            socket.on('producer-closed', (data: {
                participantId: string;
                producerId: string;
                kind: 'audio' | 'video';
                appData?: { type?: string };
            }) => {
                console.log('❌ Producer closed:', data);

                // Remove from consumed set so we can consume again if they turn it back on
                consumedProducersRef.current.delete(data.producerId);

                // Get stored appData to determine if this is a screen share
                const storedAppData = producerAppDataRef.current.get(data.producerId);
                const appData = data.appData || storedAppData;
                const isScreen = appData?.type === 'screen';

                // Clean up the stored appData
                producerAppDataRef.current.delete(data.producerId);

                console.log(`📋 Producer closed - kind: ${data.kind}, isScreen: ${isScreen}, appData:`, appData);

                // Find and close the consumer for this producer
                for (const [consumerId, consumer] of consumersRef.current) {
                    if (consumer.producerId === data.producerId) {
                        consumer.close();
                        consumersRef.current.delete(consumerId);
                        console.log(`🗑️ Consumer ${consumerId} closed for producer ${data.producerId}`);
                        break;
                    }
                }

                // Remove the track from the participant's stream
                const streams = remoteStreamsRef.current.get(data.participantId);
                if (streams) {
                    if (data.kind === 'video') {
                        if (isScreen && streams.screen) {
                            streams.screen.getTracks().forEach((track: MediaStreamTrack) => {
                                streams.screen?.removeTrack(track);
                                track.stop();
                            });
                            streams.screen = null;
                            console.log(`🗑️ Removed screen video for ${data.participantId}`);
                        } else if (!isScreen && streams.camera) {
                            // Only remove camera if this is NOT a screen share
                            streams.camera.getTracks().forEach((track: MediaStreamTrack) => {
                                streams.camera?.removeTrack(track);
                                track.stop();
                            });
                            streams.camera = null;
                            console.log(`🗑️ Removed camera video for ${data.participantId}`);
                        }
                    } else if (data.kind === 'audio' && streams.audio) {
                        // For now, clear all audio when any audio producer closes
                        // Could be improved to track individual audio producers
                        streams.audio.getTracks().forEach((track: MediaStreamTrack) => {
                            streams.audio?.removeTrack(track);
                            track.stop();
                        });
                        streams.audio = null;
                        console.log(`🗑️ Removed audio for ${data.participantId}`);
                    }

                    // Force React update
                    setRemoteParticipants(prev => {
                        const newMap = new Map(prev);
                        const existing = newMap.get(data.participantId);
                        if (existing) {
                            newMap.set(data.participantId, {
                                ...existing,
                                cameraStream: streams.camera,
                                screenStream: streams.screen,
                                audioStream: streams.audio,
                                _updateTs: Date.now(),
                            });
                        }
                        return newMap;
                    });
                }
            });

            // 🎚️ Handle dynamic config updates when participants join/leave
            socket.on('meeting:config-updated', (data: {
                meetingId: string;
                config: DynamicMeetingConfig;
                simulcastEncodings: SimulcastEncoding[];
                bandwidthEstimate: BandwidthEstimate;
                reason: 'participant_joined' | 'participant_left';
                timestamp: string;
            }) => {
                console.log(`🎚️ Meeting config updated (${data.reason}):`, data.config.tier);
                console.log(`📊 New tier: ${data.config.tier} (${data.config.participantCount} participants)`);
                console.log(`📹 Video: ${data.config.video.recommendedWidth}x${data.config.video.recommendedHeight}@${data.config.video.recommendedFps}fps`);
                console.log(`📊 Bandwidth: ${data.bandwidthEstimate.perParticipantUpload}kbps up, ${data.bandwidthEstimate.perParticipantDownload}kbps down`);
                
                // Update optimization state
                setOptimization({
                    config: data.config,
                    simulcastEncodings: data.simulcastEncodings,
                    bandwidthEstimate: data.bandwidthEstimate,
                });
                setMeetingTier(data.config.tier);

                // TODO: Frontend can use this to:
                // 1. Adjust getUserMedia constraints (resolution, fps)
                // 2. Update producer encodings
                // 3. Show/hide UI elements based on features
                // 4. Display tier badge to user
            });

            socket.on('error', (error: any) => {
                console.error('❌ Socket error:', error);
                setError(error.message || 'Socket error');
            });

            socket.on('disconnect', (reason: string) => {
                console.log('🔌 Socket disconnected:', reason);
                setIsConnected(false);
                setConnectionStatus('disconnected');
            });

        } catch (err) {
            console.error('❌ WebRTC join error:', err);
            setError(String(err));
            setConnectionStatus('fallback');
        }
    }, [meeting]);

    // Leave meeting
    const leaveMeeting = useCallback(() => {
        consumersRef.current.forEach(c => c.close());
        consumersRef.current.clear();
        producersRef.current.forEach(p => p.close());
        producersRef.current.clear();

        // Clear these refs to prevent stale data in new meetings
        consumedProducersRef.current.clear();
        remoteStreamsRef.current.clear();

        sendTransportRef.current?.close();
        sendTransportRef.current = null;
        recvTransportRef.current?.close();
        recvTransportRef.current = null;

        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(t => t.stop());
            localStreamRef.current = null;
        }

        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(t => t.stop());
            screenStreamRef.current = null;
        }

        socketRef.current?.disconnect();
        socketRef.current = null;
        deviceRef.current = null;

        setIsConnected(false);
        setIsVideoEnabled(false);
        setIsAudioEnabled(false);
        setIsScreenSharing(false);
        setConnectionStatus('disconnected');
        setRemoteParticipants(new Map());

        console.log('👋 Left meeting');
    }, []);

    useEffect(() => {
        return () => { leaveMeeting(); };
    }, [leaveMeeting]);

    return {
        localVideoRef,
        remoteParticipants,
        isConnected,
        isAudioEnabled,
        isVideoEnabled,
        isScreenSharing,
        connectionStatus,
        error,
        // Dynamic optimization
        optimization,
        meetingTier,
        // Actions
        startCamera,
        startMicrophone,
        stopCamera,
        stopMicrophone,
        toggleVideo,
        toggleAudio,
        startScreenShare,
        stopScreenShare,
        toggleScreenShare,
        joinMeeting,
        leaveMeeting,
    };
};
