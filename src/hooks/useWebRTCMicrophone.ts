import { useState, useRef, useCallback, useEffect } from 'react';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.services.mozilla.com:3478' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
  iceCandidatePoolSize: 10,
};

/**
 * Optimizes WebRTC SDP for ultra-low latency audio (10ms packetization, mono, CBR, zero FEC lookahead).
 * Eliminates transmission and buffering lag between HP microphone and music playback.
 */
export function optimizeSdpForUltraLowLatency(sdp: string): string {
  let newSdp = sdp;
  const opusMatch = newSdp.match(/a=rtpmap:(\d+)\s+opus\/48000/i);
  if (opusMatch) {
    const pt = opusMatch[1];
    const fmtpRegex = new RegExp(`a=fmtp:${pt}\\s+(.*)`, 'i');
    // useinbandfec=0 removes the Opus decoder lookahead buffer, eliminating 15-20ms of algorithmic delay
    const ultraLowLatencyOpts =
      'minptime=10;ptime=10;stereo=0;sprop-stereo=0;maxaveragebitrate=128000;cbr=1;useinbandfec=0;maxplaybackrate=48000;sprop-maxcapturerate=48000';

    if (fmtpRegex.test(newSdp)) {
      newSdp = newSdp.replace(fmtpRegex, (_m, existing) => {
        return `a=fmtp:${pt} ${existing};${ultraLowLatencyOpts}`;
      });
    } else {
      newSdp = newSdp.replace(
        new RegExp(`(a=rtpmap:${pt}\\s+opus\\/48000[^\r\n]*[\r\n]+)`, 'i'),
        `$1a=fmtp:${pt} ${ultraLowLatencyOpts}\r\n`
      );
    }
  }

  // Force strict 10ms packet duration (cuts packet wait time in half)
  if (/a=ptime:/i.test(newSdp)) {
    newSdp = newSdp.replace(/a=ptime:\d+/i, 'a=ptime:10');
  } else {
    newSdp = newSdp.replace(/(m=audio[^\r\n]*[\r\n]+)/i, '$1a=ptime:10\r\na=minptime:10\r\n');
  }

  return newSdp;
}

export interface UseWebRTCMicrophoneOptions {
  socketRef: React.MutableRefObject<WebSocket | null>;
  roomId: string;
  singerName: string;
  onToast?: (msg: string) => void;
}

export function useWebRTCMicrophone({
  socketRef,
  roomId,
  singerName,
  onToast,
}: UseWebRTCMicrophoneOptions) {
  const senderName = singerName;
  const [isStreaming, setIsStreaming] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Volume (0 - 150%) and Echo (0 - 100%) states (Echo defaults to 0% for pure zero-delay voice)
  const [micVolume, setMicVolume] = useState<number>(100);
  const [micEcho, setMicEcho] = useState<number>(0);

  // Anti-gema hardware toggle and zero-delay capture mode
  const [isEchoCancellationEnabled, setIsEchoCancellationEnabled] = useState(false);
  const [isZeroDelayBypass, setIsZeroDelayBypass] = useState(true);

  const [audioLevel, setAudioLevel] = useState(0); // 0 - 100 volume meter
  const [micError, setMicError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const isMutedRef = useRef(false);
  const isStreamingRef = useRef(false);
  const lastLevelSentRef = useRef<number>(0);

  // Keep ref synchronized
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Send volume & echo changes to Master in real-time
  const broadcastMicParams = useCallback(
    (volume: number, echo: number) => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        try {
          socketRef.current.send(
            JSON.stringify({
              type: 'RTC_MIC_PARAMS',
              roomId,
              payload: {
                volume,
                echo,
                senderName,
              },
              timestamp: Date.now(),
            })
          );
        } catch {}
      }
    },
    [roomId, senderName, socketRef]
  );

  // Interactive (+ and -) Volume controls
  const increaseVolume = useCallback(() => {
    setMicVolume((prev) => {
      const next = Math.min(150, prev + 5);
      broadcastMicParams(next, micEcho);
      if (onToast) onToast(`Vol Mic: ${next}%`);
      return next;
    });
  }, [broadcastMicParams, micEcho, onToast]);

  const decreaseVolume = useCallback(() => {
    setMicVolume((prev) => {
      const next = Math.max(0, prev - 5);
      broadcastMicParams(next, micEcho);
      if (onToast) onToast(`Vol Mic: ${next}%`);
      return next;
    });
  }, [broadcastMicParams, micEcho, onToast]);

  const setVolumeDirect = useCallback(
    (vol: number) => {
      const clamped = Math.min(150, Math.max(0, vol));
      setMicVolume(clamped);
      broadcastMicParams(clamped, micEcho);
    },
    [broadcastMicParams, micEcho]
  );

  // Interactive (+ and -) Echo controls
  const increaseEcho = useCallback(() => {
    setMicEcho((prev) => {
      const next = Math.min(100, prev + 5);
      broadcastMicParams(micVolume, next);
      if (onToast) onToast(`Echo Gema: ${next}%`);
      return next;
    });
  }, [broadcastMicParams, micVolume, onToast]);

  const decreaseEcho = useCallback(() => {
    setMicEcho((prev) => {
      const next = Math.max(0, prev - 5);
      broadcastMicParams(micVolume, next);
      if (onToast) onToast(`Echo Gema: ${next}%`);
      return next;
    });
  }, [broadcastMicParams, micVolume, onToast]);

  const setEchoDirect = useCallback(
    (echo: number) => {
      const clamped = Math.min(100, Math.max(0, echo));
      setMicEcho(clamped);
      broadcastMicParams(micVolume, clamped);
    },
    [broadcastMicParams, micVolume]
  );

  // Stop broadcasting and clean up all media resources
  const stopBroadcasting = useCallback(() => {
    isStreamingRef.current = false;
    setIsStreaming(false);
    setIsMuted(false);
    setAudioLevel(0);

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (scriptProcessorRef.current) {
      try {
        scriptProcessorRef.current.disconnect();
      } catch {}
      scriptProcessorRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      localStreamRef.current = null;
    }

    if (pcRef.current) {
      try {
        pcRef.current.onicecandidate = null;
        pcRef.current.onconnectionstatechange = null;
        pcRef.current.close();
      } catch {}
      pcRef.current = null;
    }

    pendingCandidatesRef.current = [];
    setConnectionStatus('idle');

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      try {
        socketRef.current.send(
          JSON.stringify({
            type: 'RTC_MIC_STATUS',
            roomId,
            payload: {
              isMicOn: false,
              senderName,
            },
            timestamp: Date.now(),
          })
        );
      } catch (err) {
        console.warn('[WebRTC] Failed to send mic stop signal:', err);
      }
    }

    if (onToast) onToast('Mikrofon HP dimatikan');
  }, [roomId, senderName, socketRef, onToast]);

  // Start broadcasting microphone via WebRTC + real-time WebSocket audio relay
  const startBroadcasting = useCallback(
    async (forceEchoCancel?: boolean) => {
      setMicError(null);
      setConnectionStatus('connecting');

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const err = 'Peramban tidak mendukung akses mikrofon WebRTC.';
        setMicError(err);
        setConnectionStatus('error');
        if (onToast) onToast(err);
        return false;
      }

      const useEcho = typeof forceEchoCancel === 'boolean' ? forceEchoCancel : isEchoCancellationEnabled;

      try {
        // 1. Capture microphone with clean audio parameters
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: useEcho,
              noiseSuppression: !isZeroDelayBypass,
              autoGainControl: !isZeroDelayBypass,
              channelCount: 1,
              sampleRate: 48000,
            },
            video: false,
          });
        } catch {
          // Fallback constraint for older Android engines
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: useEcho,
              channelCount: 1,
            },
            video: false,
          });
        }

        localStreamRef.current = stream;

        // 2. Setup AudioContext and Audio Processor for live VU meter AND real-time WebSocket audio relay
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const audioCtx = new AudioCtx({ latencyHint: 'interactive' });
          audioContextRef.current = audioCtx;
          if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
          }

          const source = audioCtx.createMediaStreamSource(stream);

          // AnalyserNode for local visualizer meter
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 64;
          analyser.smoothingTimeConstant = 0.3;
          source.connect(analyser);
          analyserRef.current = analyser;

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const updateMeter = () => {
            if (analyserRef.current && localStreamRef.current && isStreamingRef.current) {
              analyserRef.current.getByteFrequencyData(dataArray);
              let sum = 0;
              for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
              }
              const avg = sum / dataArray.length;
              const level = isMutedRef.current ? 0 : Math.min(100, Math.round((avg / 128) * 100));
              setAudioLevel(level);

              // Throttle level update to Master (~60ms)
              const now = Date.now();
              if (now - lastLevelSentRef.current > 60 && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                lastLevelSentRef.current = now;
                try {
                  socketRef.current.send(
                    JSON.stringify({
                      type: 'RTC_MIC_LEVEL',
                      roomId,
                      payload: {
                        senderName,
                        level,
                      },
                    })
                  );
                } catch {}
              }

              animFrameRef.current = requestAnimationFrame(updateMeter);
            }
          };

          // ScriptProcessor for real-time WebSocket audio relay (bufferSize = 2048 samples = ~42ms at 48kHz)
          // Guarantees audio arrives at Master even across cellular CGNAT or symmetric firewalls
          const processor = audioCtx.createScriptProcessor(2048, 1, 1);
          scriptProcessorRef.current = processor;
          source.connect(processor);
          // Connect to destination via silent dummy gain so Chrome runs the processor without sound feedback on phone
          const silentGain = audioCtx.createGain();
          silentGain.gain.value = 0.00001;
          processor.connect(silentGain);
          silentGain.connect(audioCtx.destination);

          processor.onaudioprocess = (e) => {
            if (!isStreamingRef.current || isMutedRef.current) return;
            const input = e.inputBuffer.getChannelData(0);
            if (!input || input.length === 0) return;

            // Compute peak amplitude
            let maxVal = 0;
            const len = input.length;
            const pcm16 = new Int16Array(len);
            for (let i = 0; i < len; i++) {
              const val = input[i];
              const abs = Math.abs(val);
              if (abs > maxVal) maxVal = abs;
              // Float32 to 16-bit PCM conversion
              const clamped = Math.max(-1, Math.min(1, val));
              pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
            }

            const currentLevel = Math.min(100, Math.round(maxVal * 100));

            // Convert to Base64 string
            const u8 = new Uint8Array(pcm16.buffer);
            let binary = '';
            const u8len = u8.byteLength;
            for (let i = 0; i < u8len; i++) {
              binary += String.fromCharCode(u8[i]);
            }
            const base64 = btoa(binary);

            if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
              try {
                socketRef.current.send(
                  JSON.stringify({
                    type: 'CLIENT_MIC_AUDIO_DATA',
                    roomId,
                    payload: {
                      senderName,
                      pcm: base64,
                      sampleRate: audioCtx.sampleRate,
                      level: currentLevel,
                      volume: micVolume,
                      echo: micEcho,
                    },
                  })
                );
              } catch {}
            }
          };

          updateMeter();
        }

        // 3. Create WebRTC Peer Connection (P2P direct audio mode)
        const pc = new RTCPeerConnection(ICE_SERVERS);
        pcRef.current = pc;

        // Add audio track to peer connection with high priority
        stream.getAudioTracks().forEach((track) => {
          const sender = pc.addTrack(track, stream);
          try {
            const params = sender.getParameters();
            if (params.encodings && params.encodings[0]) {
              params.encodings[0].priority = 'high';
              params.encodings[0].networkPriority = 'high';
              params.encodings[0].maxBitrate = 128000;
              sender.setParameters(params).catch(() => {});
            }
          } catch {}
        });

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
          if (event.candidate && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(
              JSON.stringify({
                type: 'RTC_ICE_CANDIDATE',
                roomId,
                payload: {
                  candidate: event.candidate,
                  senderName,
                },
                timestamp: Date.now(),
              })
            );
          }
        };

        pc.onconnectionstatechange = () => {
          if (!pcRef.current) return;
          const state = pcRef.current.connectionState;
          if (state === 'connected') {
            setConnectionStatus('connected');
          } else if (state === 'failed' || state === 'disconnected') {
            // Note: WebSocket audio relay continues streaming even if WebRTC P2P drops!
            setConnectionStatus('connected');
          }
        };

        // 4. Create Offer with low-latency audio settings
        const rawOffer = await pc.createOffer({
          offerToReceiveAudio: false,
          offerToReceiveVideo: false,
        });

        const optimizedOffer = {
          type: rawOffer.type,
          sdp: optimizeSdpForUltraLowLatency(rawOffer.sdp || ''),
        };

        await pc.setLocalDescription(optimizedOffer);

        // 5. Send Offer and initial mic parameters to Master
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              type: 'RTC_OFFER',
              roomId,
              payload: {
                offer: optimizedOffer,
                senderName,
              },
              timestamp: Date.now(),
            })
          );

          socketRef.current.send(
            JSON.stringify({
              type: 'RTC_MIC_STATUS',
              roomId,
              payload: {
                isMicOn: true,
                senderName,
              },
              timestamp: Date.now(),
            })
          );

          broadcastMicParams(micVolume, micEcho);
        } else {
          throw new Error('Koneksi WebSocket belum siap. Pastikan terhubung ke ruangan.');
        }

        isStreamingRef.current = true;
        setIsStreaming(true);
        setIsMuted(false);
        setConnectionStatus('connected');
        if (onToast) onToast('🎤 Mikrofon HP Aktif! Suara langsung masuk ke Master.');
        return true;
      } catch (err: any) {
        console.error('[WebRTC] Error starting mic broadcast:', err);
        let message = 'Gagal mengakses mikrofon. Izinkan izin mikrofon di browser HP.';
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          message = 'Izin mikrofon ditolak. Mohon izinkan mikrofon di pengaturan browser.';
        } else if (err.name === 'NotFoundError') {
          message = 'Tidak ada perangkat mikrofon yang terdeteksi.';
        } else if (err.message) {
          message = err.message;
        }
        setMicError(message);
        setConnectionStatus('error');
        stopBroadcasting();
        if (onToast) onToast(message);
        return false;
      }
    },
    [
      roomId,
      senderName,
      socketRef,
      stopBroadcasting,
      isEchoCancellationEnabled,
      isZeroDelayBypass,
      micVolume,
      micEcho,
      broadcastMicParams,
      onToast,
    ]
  );

  // Toggle echo cancellation mode dynamically
  const toggleEchoCancellation = useCallback(() => {
    setIsEchoCancellationEnabled((prev) => {
      const nextVal = !prev;
      if (localStreamRef.current) {
        const audioTrack = localStreamRef.current.getAudioTracks()[0];
        if (audioTrack && typeof (audioTrack as any).applyConstraints === 'function') {
          (audioTrack as any)
            .applyConstraints({
              echoCancellation: nextVal,
            })
            .catch(() => {});
        }
      }
      if (onToast) {
        onToast(nextVal ? 'Anti-Gema Hardware: AKTIF' : 'Anti-Gema Hardware: NONAKTIF');
      }
      return nextVal;
    });
  }, [onToast]);

  // Toggle zero-delay bypass mode
  const toggleZeroDelayBypass = useCallback(() => {
    setIsZeroDelayBypass((prev) => {
      const nextVal = !prev;
      if (onToast) {
        onToast(nextVal ? 'Mode Nol Delay Vokal-Musik: AKTIF' : 'Mode Filter Standar: AKTIF');
      }
      return nextVal;
    });
  }, [onToast]);

  // Handle incoming signaling messages from Master (RTC_ANSWER, RTC_ICE_CANDIDATE, RTC_MIC_PARAMS)
  const handleSignalingMessage = useCallback(async (data: any) => {
    if (!data || !data.type) return;

    if (data.type === 'RTC_ANSWER' && pcRef.current) {
      const answer = data.payload?.answer;
      if (answer) {
        try {
          if (pcRef.current.signalingState === 'have-local-offer') {
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
            setConnectionStatus('connected');

            while (pendingCandidatesRef.current.length > 0) {
              const candidate = pendingCandidatesRef.current.shift();
              if (candidate) {
                await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
              }
            }
          }
        } catch (e) {
          console.warn('[WebRTC] Error setting remote description (answer):', e);
        }
      }
    } else if (data.type === 'RTC_ICE_CANDIDATE' && pcRef.current) {
      const candidate = data.payload?.candidate;
      if (candidate) {
        try {
          if (pcRef.current.remoteDescription && pcRef.current.remoteDescription.type) {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
          } else {
            pendingCandidatesRef.current.push(candidate);
          }
        } catch (e) {
          console.warn('[WebRTC] Error adding ICE candidate:', e);
        }
      }
    } else if (data.type === 'RTC_MIC_PARAMS') {
      const { volume, echo } = data.payload || {};
      if (typeof volume === 'number') setMicVolume(Math.min(150, Math.max(0, volume)));
      if (typeof echo === 'number') setMicEcho(Math.min(100, Math.max(0, echo)));
    }
  }, []);

  // Toggle local microphone mute
  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const audioTrack = localStreamRef.current.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      const nextMuted = !audioTrack.enabled;
      setIsMuted(nextMuted);
      isMutedRef.current = nextMuted;
      if (onToast) {
        onToast(audioTrack.enabled ? 'Mikrofon diaktifkan' : 'Mikrofon dibisukan (Mute)');
      }
    }
  }, [onToast]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopBroadcasting();
    };
  }, [stopBroadcasting]);

  return {
    isStreaming,
    isMuted,
    isEchoCancellationEnabled,
    isZeroDelayBypass,
    micVolume,
    micEcho,
    audioLevel,
    micError,
    connectionStatus,
    startBroadcasting,
    stopBroadcasting,
    toggleMute,
    toggleEchoCancellation,
    toggleZeroDelayBypass,
    increaseVolume,
    decreaseVolume,
    setVolumeDirect,
    increaseEcho,
    decreaseEcho,
    setEchoDirect,
    handleSignalingMessage,
  };
}
