import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
export type VoiceState =
  'idle' | 'microphone' | 'connecting' | 'listening' | 'responding' | 'error';
export function useBrowserVoice(onTranscript: (role: 'user' | 'assistant', text: string) => void) {
  const [state, setState] = useState<VoiceState>('idle'),
    [error, setError] = useState(''),
    [seconds, setSeconds] = useState(0),
    [audioBlocked, setAudioBlocked] = useState(false);
  const peer = useRef<RTCPeerConnection | null>(null),
    stream = useRef<MediaStream | null>(null),
    audio = useRef<HTMLAudioElement | null>(null),
    session = useRef<string | null>(null),
    channel = useRef<RTCDataChannel | null>(null),
    timer = useRef<ReturnType<typeof setInterval> | null>(null),
    maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    callback = useRef(onTranscript),
    generation = useRef(0),
    mounted = useRef(true),
    starting = useRef(false);
  callback.current = onTranscript;
  const closeLocal = useCallback(() => {
    generation.current++;
    starting.current = false;
    if (timer.current) clearInterval(timer.current);
    if (maxTimer.current) clearTimeout(maxTimer.current);
    channel.current?.close();
    channel.current = null;
    const pc = peer.current;
    peer.current = null;
    pc?.close();
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (audio.current) {
      audio.current.pause();
      audio.current.srcObject = null;
    }
    audio.current = null;
  }, []);
  const stop = useCallback(async () => {
    const id = session.current;
    session.current = null;
    closeLocal();
    setAudioBlocked(false);
    setState('idle');
    if (id)
      try {
        await api(`/voice/session/${id}/end`, { method: 'POST', keepalive: true });
      } catch (e) {
        if (mounted.current) {
          setError(
            'Your microphone is stopped, but backend termination could not be confirmed: ' +
              (e as Error).message,
          );
          setState('error');
        }
      }
  }, [closeLocal]);
  async function enableAudio() {
    try {
      await audio.current?.play();
      setAudioBlocked(false);
      setError('');
    } catch {
      setError('Playback is still blocked. Check browser sound permissions.');
    }
  }
  async function start() {
    if (peer.current || starting.current || !mounted.current) return;
    starting.current = true;
    const attempt = ++generation.current,
      valid = () => mounted.current && generation.current === attempt;
    setError('');
    setAudioBlocked(false);
    setState('microphone');
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error('Your browser requires HTTPS and microphone support for voice.');
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      // Permission dialogs cannot be aborted. A late grant must never reopen a canceled microphone.
      if (!valid()) {
        acquired.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = acquired;
      setState('connecting');
      const pc = new RTCPeerConnection();
      peer.current = pc;
      const player = new Audio();
      player.autoplay = true;
      audio.current = player;
      pc.ontrack = (e) => {
        if (peer.current !== pc || !valid()) return;
        player.srcObject = e.streams[0];
        void player.play().catch(() => {
          if (valid()) {
            setAudioBlocked(true);
            setError('This browser needs a tap to enable sound.');
          }
        });
      };
      for (const track of acquired.getTracks()) pc.addTrack(track, acquired);
      pc.onconnectionstatechange = () => {
        if (peer.current !== pc || !valid()) return;
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          setError('The voice connection was interrupted. No redial is attempted.');
          void stop();
        }
      };
      const dc = pc.createDataChannel('oai-events');
      channel.current = dc;
      dc.onopen = () => {
        if (!valid()) return;
        setState('listening');
        const began = Date.now();
        setSeconds(0);
        timer.current = setInterval(
          () => setSeconds(Math.floor((Date.now() - began) / 1000)),
          1000,
        );
      };
      dc.onmessage = (e) => {
        if (!valid()) return;
        let event: any;
        try {
          event = JSON.parse(e.data);
        } catch {
          return;
        }
        if (event.type === 'input_audio_buffer.speech_started') setState('listening');
        if (event.type === 'response.created') setState('responding');
        if (event.type === 'response.done' || event.type === 'output_audio_buffer.stopped')
          setState('listening');
        if (
          event.type === 'conversation.item.input_audio_transcription.completed' &&
          event.transcript
        )
          callback.current('user', event.transcript);
        if (event.type === 'response.output_audio_transcript.done' && event.transcript)
          callback.current('assistant', event.transcript);
        if (
          event.type === 'error' &&
          !['response_cancel_not_active', 'conversation_already_has_active_response'].includes(
            event.error?.code,
          )
        ) {
          setError('The live provider reported an error. Check System status.');
          void stop();
        }
      };
      const offer = await pc.createOffer();
      if (!valid()) return;
      await pc.setLocalDescription(offer);
      if (!valid()) return;
      const result = await api<{
        sdp: string;
        session_id: string;
        conversation_id: string;
        max_seconds: number;
      }>('/voice/session', { method: 'POST', body: { sdp: offer.sdp } });
      // Keep the response so a creation racing navigation can be explicitly terminated, not retried.
      if (!valid()) {
        void api(`/voice/session/${result.session_id}/end`, {
          method: 'POST',
          keepalive: true,
        }).catch(() => {});
        return;
      }
      session.current = result.session_id;
      await pc.setRemoteDescription({ type: 'answer', sdp: result.sdp });
      if (!valid()) return;
      maxTimer.current = setTimeout(() => void stop(), result.max_seconds * 1000);
    } catch (e) {
      if (!valid()) return;
      const id = session.current;
      session.current = null;
      closeLocal();
      if (id) void api(`/voice/session/${id}/end`, { method: 'POST' }).catch(() => {});
      setError((e as Error).message);
      setState('error');
    } finally {
      if (generation.current === attempt) starting.current = false;
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const id = session.current;
      session.current = null;
      closeLocal();
      if (id)
        void api(`/voice/session/${id}/end`, { method: 'POST', keepalive: true }).catch(() => {});
    };
  }, [closeLocal]);
  return {
    state,
    error,
    seconds,
    start,
    stop,
    audioBlocked,
    enableAudio,
    active: ['microphone', 'connecting', 'listening', 'responding'].includes(state),
  };
}
