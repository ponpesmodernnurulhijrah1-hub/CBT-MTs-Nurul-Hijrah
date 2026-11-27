import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../config/firebase';
import type { LiveStreamSession } from '../types/cbt';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

/**
 * Publisher WebRTC di Portal Siswa:
 * Mengalirkan kamera + mikrofon secara live ke koleksi Firestore `live_streams/{sessionId}`
 * dan menerima perintah peringatan/alarm dari guru/admin.
 */
export function useStudentWebRTCPublisher(params: {
  enabled: boolean;
  sessionId: string;
  localStream: MediaStream | null;
  onRemoteWarning?: (message: string, triggerAt: number) => void;
}) {
  const { enabled, sessionId, localStream, onRemoteWarning } = params;
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const lastAlarmHandledRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled || !sessionId || !localStream) return;

    let closed = false;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });

    const streamDocRef = doc(db, 'live_streams', sessionId);

    pc.onicecandidate = (event) => {
      if (event.candidate && !closed) {
        updateDoc(streamDocRef, {
          studentIceCandidates: arrayUnion(JSON.stringify(event.candidate.toJSON())),
        }).catch(() => {});
      }
    };

    const startSignaling = async () => {
      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: false,
          offerToReceiveVideo: false,
        });
        await pc.setLocalDescription(offer);
        if (!closed) {
          await setDoc(
            streamDocRef,
            {
              offerSdp: JSON.stringify(offer),
              studentIceCandidates: [],
              proctorIceCandidates: [],
            },
            { merge: true }
          ).catch(() => {});
        }
      } catch {
        // Ignore signaling errors in headless environments
      }
    };

    startSignaling();

    const addedProctorCandidates = new Set<string>();
    const unsub = onSnapshot(
      streamDocRef,
      async (snap) => {
        if (closed || !snap.exists()) return;
        const data = snap.data() as Partial<LiveStreamSession>;

        if (
          data.answerSdp &&
          !pc.currentRemoteDescription &&
          pc.signalingState === 'have-local-offer'
        ) {
          try {
            const answer = JSON.parse(data.answerSdp) as RTCSessionDescriptionInit;
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
          } catch {
            // Ignore malformed SDP
          }
        }

        if (Array.isArray(data.proctorIceCandidates)) {
          for (const rawCand of data.proctorIceCandidates) {
            if (!addedProctorCandidates.has(rawCand)) {
              addedProctorCandidates.add(rawCand);
              try {
                const cand = JSON.parse(rawCand) as RTCIceCandidateInit;
                await pc.addIceCandidate(new RTCIceCandidate(cand));
              } catch {
                // Ignore
              }
            }
          }
        }

        if (
          data.proctorAlarmTriggerAt &&
          data.proctorAlarmTriggerAt > lastAlarmHandledRef.current
        ) {
          lastAlarmHandledRef.current = data.proctorAlarmTriggerAt;
          onRemoteWarning?.(
            data.proctorWarningMessage || 'Peringatan Pengawas: Harap fokus menghadap kamera dan layar ujian!',
            data.proctorAlarmTriggerAt
          );
        }
      },
      () => {}
    );

    return () => {
      closed = true;
      unsub();
      pc.onicecandidate = null;
      pc.close();
      pcRef.current = null;
    };
  }, [enabled, sessionId, localStream, onRemoteWarning]);
}

/**
 * Viewer WebRTC di Dashboard Guru & Admin:
 * Menerima Offer dari siswa, mengirim Answer, dan memutar <video> & <audio> live.
 * Parameter `enabled` membatasi jumlah PeerConnection serentak agar browser pengawas tetap ringan saat >100 siswa aktif.
 */
export function useProctorWebRTCViewer(session: LiveStreamSession, enabled: boolean = true) {
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const addedStudentCandidatesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !session.offerSdp) {
      setRemoteStream(null);
      return;
    }
    let closed = false;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;
    addedStudentCandidatesRef.current = new Set();

    const inboundStream = new MediaStream();
    pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((t) => inboundStream.addTrack(t));
      if (!event.streams[0]) inboundStream.addTrack(event.track);
      if (!closed) {
        setRemoteStream(inboundStream);
      }
    };

    pc.onconnectionstatechange = () => {
      if (closed) return;
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        setRemoteStream(null);
      }
    };

    const streamDocRef = doc(db, 'live_streams', session.sessionId);

    pc.onicecandidate = (event) => {
      if (event.candidate && !closed) {
        updateDoc(streamDocRef, {
          proctorIceCandidates: arrayUnion(JSON.stringify(event.candidate.toJSON())),
        }).catch(() => {});
      }
    };

    const answerOffer = async () => {
      try {
        const offer = JSON.parse(session.offerSdp!) as RTCSessionDescriptionInit;
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        if (closed) return;
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (!closed) {
          await setDoc(
            streamDocRef,
            { answerSdp: JSON.stringify(answer) },
            { merge: true }
          ).catch(() => {});
        }

        if (!closed && Array.isArray(session.studentIceCandidates)) {
          for (const rawCand of session.studentIceCandidates) {
            if (addedStudentCandidatesRef.current.has(rawCand)) continue;
            addedStudentCandidatesRef.current.add(rawCand);
            try {
              await pc.addIceCandidate(
                new RTCIceCandidate(JSON.parse(rawCand) as RTCIceCandidateInit)
              );
            } catch {
              // Ignore malformed/stale candidate
            }
          }
        }
      } catch {
        // Ignore WebRTC setup issues when fallback snapshot is active
      }
    };

    answerOffer();

    return () => {
      closed = true;
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      pcRef.current = null;
      addedStudentCandidatesRef.current.clear();
      setRemoteStream(null);
    };
  }, [enabled, session.sessionId, session.offerSdp]);

  // Apply late-arriving student ICE candidates appended to Firestore after initial Answer
  useEffect(() => {
    if (!enabled) return;
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription || !Array.isArray(session.studentIceCandidates)) return;
    for (const rawCand of session.studentIceCandidates) {
      if (addedStudentCandidatesRef.current.has(rawCand)) continue;
      addedStudentCandidatesRef.current.add(rawCand);
      try {
        pc.addIceCandidate(
          new RTCIceCandidate(JSON.parse(rawCand) as RTCIceCandidateInit)
        ).catch(() => {});
      } catch {
        // Ignore
      }
    }
  }, [enabled, session.sessionId, session.studentIceCandidates]);

  return { remoteStream };
}
