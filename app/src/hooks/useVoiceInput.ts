import { useState, useRef, useEffect, useCallback } from "react";
import { useNotificationStore } from "../stores/useToastStore";

interface UseVoiceInputProps {
  onTranscript: (text: string) => void;
  getCurrentValue: () => string;
}

export function useVoiceInput({ onTranscript, getCurrentValue }: UseVoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const addNotification = useNotificationStore(s => s.addNotification);
  const recognitionRef = useRef<any>(null);
  
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const getCurrentValueRef = useRef(getCurrentValue);
  getCurrentValueRef.current = getCurrentValue;

  const baselineRef = useRef("");

  const SpeechRecognitionAPI =
    typeof window !== "undefined"
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : null;

  const isSupported = !!SpeechRecognitionAPI;

  // Initialize SpeechRecognition instance
  useEffect(() => {
    if (!isSupported || !SpeechRecognitionAPI) return;

    const rec = new SpeechRecognitionAPI();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onstart = () => {
      baselineRef.current = getCurrentValueRef.current();
      setIsListening(true);
    };

    rec.onend = () => {
      setIsListening(false);
      baselineRef.current = "";
    };

    rec.onresult = (event: any) => {
      let finalTranscript = "";
      let interimTranscript = "";

      for (let i = 0; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      const spaces = baselineRef.current && !baselineRef.current.endsWith(" ") ? " " : "";
      const currentText = baselineRef.current + spaces + finalTranscript + interimTranscript;
      onTranscriptRef.current(currentText);
    };

    rec.onerror = (event: any) => {
      setIsListening(false);
      console.error("Speech recognition error:", event.error);
      if (event.error !== "no-speech" && event.error !== "aborted") {
        addNotification(`Speech recognition error: ${event.error}`, "error");
      }
    };

    recognitionRef.current = rec;

    return () => {
      try {
        rec.abort();
      } catch {}
    };
  }, [isSupported, SpeechRecognitionAPI, addNotification]);

  const toggleListening = useCallback(async () => {
    if (!isSupported) {
      addNotification("Speech input is not supported in this environment.", "error");
      return;
    }

    const rec = recognitionRef.current;
    if (!rec) return;

    if (isListening) {
      rec.stop();
    } else {
      try {
        // Explicitly request microphone permission to trigger the OS prompt
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Stop tracks immediately so the recording indicator doesn't leak/lock
        stream.getTracks().forEach(track => track.stop());
        rec.start();
      } catch (e: any) {
        console.error("Microphone permission check failed:", e);
        if (e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError") {
          addNotification("Microphone permission is required for voice input.", "error");
        } else {
          addNotification("Microphone access is unavailable or failed to initialize.", "error");
        }
        setIsListening(false);
      }
    }
  }, [isSupported, isListening, addNotification]);

  return {
    isListening,
    isSupported,
    toggleListening,
  };
}
