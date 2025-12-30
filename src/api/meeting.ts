const API_URL = import.meta.env.VITE_BASE_URL || 'https://devapi.letscatchup-kcs.com/api';

// Store your auth token here - get it from login
let authToken = '';

export const setAuthToken = (token: string) => {
    authToken = token;
    localStorage.setItem('authToken', token);
};

export const getAuthToken = () => {
    if (!authToken) {
        authToken = localStorage.getItem('authToken') || '';
    }
    return authToken;
};

const getHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getAuthToken()}`,
});

// Types
export interface Meeting {
    id: string;
    title: string;
    meeting_code: string;
    meeting_link: string;
    meeting_type: string;
    meeting_status: string;
    creator_id: string;
    campus_id: string;
    max_participants: number;
    settings: {
        allow_screen_share: boolean;
        allow_chat: boolean;
        mute_on_entry: boolean;
        allow_anonymous_join: boolean;
        waiting_room_enabled?: boolean;
        auto_admit?: boolean;
    };
}

export interface WebRTCConfig {
    iceServers: RTCIceServer[];
    rtpCapabilities?: any;
    routerError?: string;
}

export interface JoinMeetingResponse {
    success: boolean;
    data?: {
        meeting: Meeting;
        canJoin: boolean;
        joinError?: string;
        webrtcConfig: WebRTCConfig;
    };
    error?: string;
}

// Call Types
export interface Call {
    callId: string;
    meetingId: string;
    callerId: string;
    calleeId: string;
    callerName: string;
    calleeName: string;
    callType: 'audio' | 'video';
    status: 'ringing' | 'accepted' | 'rejected' | 'missed' | 'ended';
    startedAt: Date;
    answeredAt?: Date;
    endedAt?: Date;
}

export interface WaitingRoomEntry {
    userId: string;
    userName: string;
    userAvatar?: string;
    requestedAt: Date;
    status: 'waiting' | 'admitted' | 'rejected';
}

// API Functions
export const testConnection = async (): Promise<{ success: boolean; error?: string }> => {
    try {
        await fetch(`${API_URL}/health`);
        return { success: true };
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const createInstantMeeting = async (
    title: string,
    options?: { waiting_room_enabled?: boolean; auto_admit?: boolean }
): Promise<{ success: boolean; data?: Meeting; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/instant`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
                title,
                settings: {
                    allow_screen_share: true,
                    allow_chat: true,
                    mute_on_entry: false,
                    allow_anonymous_join: true,
                    waiting_room_enabled: options?.waiting_room_enabled ?? false,
                    auto_admit: options?.auto_admit ?? true,
                },
            }),
        });

        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const joinMeeting = async (meetingCode: string): Promise<JoinMeetingResponse> => {
    try {
        const response = await fetch(`${API_URL}/meetings/join/${meetingCode}`, {
            method: 'GET',
            headers: getHeaders(),
        });

        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const getWebRTCConfig = async (meetingId: string): Promise<{ success: boolean; data?: WebRTCConfig; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}/webrtc-config`, {
            method: 'GET',
            headers: getHeaders(),
        });

        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const getMyMeetings = async (): Promise<{ success: boolean; data?: Meeting[]; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings`, {
            method: 'GET',
            headers: getHeaders(),
        });

        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const getMeetingById = async (meetingId: string): Promise<{ success: boolean; data?: Meeting; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}`, {
            method: 'GET',
            headers: getHeaders(),
        });

        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

// ============================================
// CALL API FUNCTIONS
// ============================================

export const initiateCall = async (
    calleeId: string,
    callType: 'audio' | 'video'
): Promise<{ success: boolean; data?: { callId: string; meetingId: string }; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/call/initiate`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ calleeId, callType }),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const answerCall = async (
    callId: string
): Promise<{ success: boolean; data?: { meetingId: string }; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/call/${callId}/answer`, {
            method: 'POST',
            headers: getHeaders(),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const rejectCall = async (
    callId: string,
    reason?: string
): Promise<{ success: boolean; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/call/${callId}/reject`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ reason }),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const endCall = async (callId: string): Promise<{ success: boolean; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/call/${callId}/end`, {
            method: 'POST',
            headers: getHeaders(),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const cancelCall = async (callId: string): Promise<{ success: boolean; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/call/${callId}/cancel`, {
            method: 'POST',
            headers: getHeaders(),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const getActiveCall = async (): Promise<{ success: boolean; data?: Call; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/call/active`, {
            method: 'GET',
            headers: getHeaders(),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const getCallHistory = async (): Promise<{ success: boolean; data?: Call[]; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/call/history`, {
            method: 'GET',
            headers: getHeaders(),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

// ============================================
// ADMISSION / WAITING ROOM API FUNCTIONS
// ============================================

export const checkAdmissionRequired = async (
    meetingId: string
): Promise<{ success: boolean; data?: { required: boolean }; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}/admission/check`, {
            method: 'GET',
            headers: getHeaders(),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const requestAdmission = async (
    meetingId: string,
    userName?: string
): Promise<{ success: boolean; position?: number; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}/admission/request`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ userName }),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const getWaitingRoom = async (
    meetingId: string
): Promise<{ success: boolean; data?: WaitingRoomEntry[]; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}/waiting-room`, {
            method: 'GET',
            headers: getHeaders(),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const admitParticipant = async (
    meetingId: string,
    userId: string
): Promise<{ success: boolean; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}/admit/${userId}`, {
            method: 'POST',
            headers: getHeaders(),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const rejectParticipant = async (
    meetingId: string,
    userId: string,
    reason?: string
): Promise<{ success: boolean; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}/reject/${userId}`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ reason }),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const updateDirectJoinList = async (
    meetingId: string,
    userIds: string[]
): Promise<{ success: boolean; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}/direct-join`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify({ user_ids: userIds }),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

// ============================================
// SCHEDULED MEETING API FUNCTIONS
// ============================================

export interface ScheduledMeetingRequest {
    title: string;
    description?: string;
    scheduled_start: string; // ISO date string
    scheduled_end?: string;
    timezone?: string;
    invited_user_ids?: string[];
    invited_class_ids?: string[];
    invited_subject_ids?: string[];
    recurrence?: {
        pattern: 'daily' | 'weekly' | 'monthly';
        interval: number;
        daysOfWeek?: number[];
        endDate?: string;
        occurrences?: number;
    };
    settings?: {
        waiting_room_enabled?: boolean;
        auto_admit?: boolean;
        allow_screen_share?: boolean;
        allow_chat?: boolean;
        mute_on_entry?: boolean;
    };
}

export const createScheduledMeeting = async (
    request: ScheduledMeetingRequest
): Promise<{ success: boolean; data?: Meeting; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/schedule`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(request),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const startMeeting = async (meetingId: string): Promise<{ success: boolean; data?: Meeting; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}/start`, {
            method: 'POST',
            headers: getHeaders(),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const endMeeting = async (meetingId: string): Promise<{ success: boolean; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}/end`, {
            method: 'POST',
            headers: getHeaders(),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const cancelMeeting = async (meetingId: string, reason?: string): Promise<{ success: boolean; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}/cancel`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ reason }),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

// ============================================
// CO-HOST MANAGEMENT API FUNCTIONS
// ============================================

export const addCoHost = async (
    meetingId: string,
    coHostUserId: string
): Promise<{ success: boolean; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}/co-hosts`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ co_host_user_id: coHostUserId }),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const removeCoHost = async (
    meetingId: string,
    coHostUserId: string
): Promise<{ success: boolean; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}/co-hosts/${coHostUserId}`, {
            method: 'DELETE',
            headers: getHeaders(),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

// ============================================
// MUTE ALL PARTICIPANTS API
// ============================================

export const muteAllParticipants = async (
    meetingId: string,
    mute: boolean = true
): Promise<{ success: boolean; data?: { affectedCount: number }; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}/mute-all`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ mute }),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

// ============================================
// PARTICIPANT MANAGEMENT API FUNCTIONS
// ============================================

export interface Participant {
    id: string;
    user_id: string;
    participant_name: string;
    connection_status: string;
    is_muted: boolean;
    is_video_off: boolean;
    is_screen_sharing: boolean;
    joined_at: string;
    permissions: {
        is_host: boolean;
        is_co_host: boolean;
        is_moderator: boolean;
        can_share_screen: boolean;
        can_use_chat: boolean;
    };
}

export const getParticipants = async (
    meetingId: string
): Promise<{ success: boolean; data?: Participant[]; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}/participants`, {
            method: 'GET',
            headers: getHeaders(),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const removeParticipant = async (
    meetingId: string,
    participantUserId: string
): Promise<{ success: boolean; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}/participants/${participantUserId}`, {
            method: 'DELETE',
            headers: getHeaders(),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const updateParticipantPermissions = async (
    meetingId: string,
    participantUserId: string,
    permissions: {
        can_share_screen?: boolean;
        can_use_chat?: boolean;
        can_use_whiteboard?: boolean;
        can_record?: boolean;
    }
): Promise<{ success: boolean; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}/participants/${participantUserId}/permissions`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify(permissions),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

// ============================================
// RECORDING MANAGEMENT API FUNCTIONS
// ============================================

export interface Recording {
    id: string;
    meeting_id: string;
    file_url: string;
    file_size: number;
    duration_seconds: number;
    recorded_by: string;
    created_at: string;
}

export const getRecordings = async (
    meetingId: string
): Promise<{ success: boolean; data?: Recording[]; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}/recordings`, {
            method: 'GET',
            headers: getHeaders(),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

export const deleteRecording = async (
    meetingId: string,
    recordingId: string
): Promise<{ success: boolean; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}/recordings/${recordingId}`, {
            method: 'DELETE',
            headers: getHeaders(),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

// ============================================
// CHAT MESSAGES API FUNCTIONS
// ============================================

export interface ChatMessage {
    id: string;
    meeting_id: string;
    sender_id: string;
    sender_name: string;
    message: string;
    message_type: 'text' | 'file' | 'system';
    recipient_type: 'all' | 'private' | 'host';
    recipient_id?: string;
    timestamp: string;
}

export const getChatMessages = async (
    meetingId: string,
    limit: number = 100
): Promise<{ success: boolean; data?: ChatMessage[]; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}/messages?limit=${limit}`, {
            method: 'GET',
            headers: getHeaders(),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};

// ============================================
// MEETING STATS API FUNCTIONS
// ============================================

export interface MeetingStats {
    peak_participants: number;
    total_participants: number;
    total_duration_seconds: number;
    chat_messages_count: number;
    screen_shares_count: number;
    recordings_count: number;
}

export const getMeetingStats = async (
    meetingId: string
): Promise<{ success: boolean; data?: MeetingStats; error?: string }> => {
    try {
        const response = await fetch(`${API_URL}/meetings/${meetingId}/stats`, {
            method: 'GET',
            headers: getHeaders(),
        });
        const data = await response.json();
        return data;
    } catch (error) {
        return { success: false, error: String(error) };
    }
};
