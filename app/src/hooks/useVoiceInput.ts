import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNotificationStore } from "../stores/useToastStore";

interface UseVoiceInputProps {
  onTranscript: (text: string) => void;
  getCurrentValue: () => string;
}

interface TranscribeResponse {
  status: string;
  text?: string | null;
  message?: string | null;
}

/** Ordered by encoder support; the first supported type is used. */
const PREFERRED_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function appendToCurrent(current: string, addition: string): string {
  if (!current) return addition;
  const needsSpace = !/\s$/.test(current);
  return `${current}${needsSpace ? " " : ""}${addition}`;
}

/**
 * Voice input via local recording plus a speech-to-text provider.
 *
 * The Web Speech API is deliberately not used: inside the Tauri webview
 * `webkitSpeechRecognition` proxies to a cloud backend the webview cannot reach
 * and every attempt fails with a `network` error. Recording with MediaRecorder
 * and transcribing through the user's configured provider works offline of that.
 *
 * The tradeoff is that there are no interim partial transcripts — the text lands
 * once recording stops, rather than streaming in while the user speaks.
 */
export function useVoiceInput({ onTranscript, getCurrentValue }: UseVoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const addNotification = useNotificationStore((s) => s.addNotification);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const baselineRef = useRef("");

  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const getCurrentValueRef = useRef(getCurrentValue);
  getCurrentValueRef.current = getCurrentValue;

  const isSupported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  const teardown = useCallback(() => {
    recorderRef.current = null;
    chunksRef.current = [];
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Never leave the microphone hot if the view unmounts mid-recording.
  useEffect(() => teardown, [teardown]);

  const stopListening = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      teardown();
      setIsListening(false);
      return;
    }

    const mimeType = recorder.mimeType || pickMimeType() || "audio/webm";
    const finished = new Promise<Blob>((resolve) => {
      recorder.addEventListener("stop", () => resolve(new Blob(chunksRef.current, { type: mimeType })), { once: true });
    });

    recorder.stop();
    const audio = await finished;
    teardown();
    setIsListening(false);

    if (audio.size === 0) {
      addNotification("No audio was captured.", "error");
      return;
    }

    try {
      const bytes = new Uint8Array(await audio.arrayBuffer());
      const response = await invoke<TranscribeResponse>("agent_transcribe", {
        request: {
          audioBase64: toBase64(bytes),
          mimeType,
        },
      });

      if (response?.status !== "ok" || !response.text) {
        addNotification(response?.message || "Transcription failed.", "error");
        return;
      }

      onTranscriptRef.current(appendToCurrent(baselineRef.current, response.text.trim()));
      baselineRef.current = "";
    } catch (error: any) {
      console.error("Transcription failed:", error);
      addNotification(`Transcription failed: ${error?.message ?? "unknown error"}`, "error");
    }
  }, [addNotification, teardown]);

  const startListening = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const mimeType = pickMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    });
    recorder.addEventListener("error", () => {
      teardown();
      setIsListening(false);
      addNotification("Microphone recording failed.", "error");
    });

    recorder.start();
    baselineRef.current = getCurrentValueRef.current();
    setIsListening(true);
  }, [addNotification, teardown]);

  const toggleListening = useCallback(async () => {
    if (!isSupported) {
      addNotification("Voice input is not supported in this environment.", "error");
      return;
    }

    if (isListening) {
      await stopListening();
      return;
    }

    try {
      await startListening();
    } catch (error: any) {
      console.error("Microphone access failed:", error);
      const denied = error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError";
      addNotification(
        denied
          ? "Microphone permission is required for voice input."
          : `Microphone access is unavailable: ${error?.message ?? "unknown error"}`,
        "error",
      );
      teardown();
      setIsListening(false);
    }
  }, [isSupported, isListening, startListening, stopListening, addNotification, teardown]);

  return {
    isListening,
    isSupported,
    toggleListening,
  };
}