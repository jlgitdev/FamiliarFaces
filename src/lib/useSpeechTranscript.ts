import { useCallback, useEffect, useRef, useState } from "react";

interface BrowserSpeechRecognitionAlternative {
  transcript: string;
}

interface BrowserSpeechRecognitionResult {
  isFinal: boolean;
  0: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionResultList {
  length: number;
  [index: number]: BrowserSpeechRecognitionResult;
}

interface BrowserSpeechRecognitionEvent {
  resultIndex: number;
  results: BrowserSpeechRecognitionResultList;
}

interface BrowserSpeechRecognitionErrorEvent {
  error: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface BrowserSpeechRecognitionConstructor {
  new (): BrowserSpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

function getSpeechRecognitionAPI(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function getLastSentence(transcript: string) {
  const sentences = transcript.trim().split(/[.!?]+/).filter(Boolean);
  return sentences[sentences.length - 1]?.trim() ?? "";
}

const LIVE_TEXT_COMMIT_MS = 120;

export function useSpeechTranscript() {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const transcriptRef = useRef("");
  const isRunningRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveTextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveTextRef = useRef("");
  const pendingLiveTextRef = useRef("");
  const constructorRef = useRef<BrowserSpeechRecognitionConstructor | null>(
    null,
  );

  const [liveText, setLiveText] = useState("");
  const [supported, setSupported] = useState(false);

  const clearRetryTimer = useCallback(() => {
    if (!retryTimerRef.current) return;
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  const clearLiveTextTimer = useCallback(() => {
    if (!liveTextTimerRef.current) return;
    clearTimeout(liveTextTimerRef.current);
    liveTextTimerRef.current = null;
  }, []);

  const commitLiveText = useCallback(
    (text: string, immediate = false) => {
      const nextText = text.trim();
      pendingLiveTextRef.current = nextText;

      if (immediate) {
        clearLiveTextTimer();

        if (liveTextRef.current !== nextText) {
          liveTextRef.current = nextText;
          setLiveText(nextText);
        }

        return;
      }

      if (liveTextTimerRef.current) return;

      liveTextTimerRef.current = setTimeout(() => {
        liveTextTimerRef.current = null;

        const pendingText = pendingLiveTextRef.current;
        if (liveTextRef.current === pendingText) return;

        liveTextRef.current = pendingText;
        setLiveText(pendingText);
      }, LIVE_TEXT_COMMIT_MS);
    },
    [clearLiveTextTimer],
  );

  const teardownRecognition = useCallback(
    (method: "stop" | "abort") => {
      const recognition = recognitionRef.current;
      recognitionRef.current = null;

      if (!recognition) return;

      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;

      try {
        recognition[method]();
      } catch {
        // Instance may already be shut down.
      }
    },
    [],
  );

  const scheduleRestart = useCallback(
    (delayMs: number) => {
      clearRetryTimer();

      if (!isRunningRef.current || !constructorRef.current) return;

      retryTimerRef.current = setTimeout(() => {
        if (!isRunningRef.current || !constructorRef.current) return;

        const SpeechRecognitionAPI = constructorRef.current;
        teardownRecognition("abort");

        const recognition = new SpeechRecognitionAPI();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";

        recognition.onresult = (event) => {
          let interim = "";

          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const result = event.results[i];
            if (result.isFinal) {
              transcriptRef.current += `${result[0].transcript} `;
              commitLiveText(getLastSentence(transcriptRef.current), true);
            } else {
              interim += result[0].transcript;
            }
          }

          if (interim) {
            commitLiveText(interim);
          }
        };

        recognition.onerror = (event) => {
          if (!isRunningRef.current) return;

          if (event.error === "aborted" || event.error === "no-speech") {
            return;
          }

          if (
            event.error === "not-allowed" ||
            event.error === "service-not-allowed"
          ) {
            console.error("Microphone permission denied");
            isRunningRef.current = false;
            clearRetryTimer();
            teardownRecognition("abort");
            commitLiveText("", true);
            return;
          }

          const retryDelay = event.error === "network" ? 2000 : 600;
          scheduleRestart(retryDelay);
        };

        recognition.onend = () => {
          if (!isRunningRef.current || recognitionRef.current !== recognition) {
            return;
          }

          scheduleRestart(300);
        };

        recognitionRef.current = recognition;

        try {
          recognition.start();
        } catch {
          scheduleRestart(600);
        }
      }, delayMs);
    },
    [clearRetryTimer, commitLiveText, teardownRecognition],
  );

  const start = useCallback(() => {
    const SpeechRecognitionAPI = getSpeechRecognitionAPI();

    if (!SpeechRecognitionAPI) {
      console.warn("SpeechRecognition not supported in this browser");
      return false;
    }

    teardownRecognition("abort");

    transcriptRef.current = "";
    commitLiveText("", true);
    isRunningRef.current = true;
    constructorRef.current = SpeechRecognitionAPI;
    scheduleRestart(0);

    return true;
  }, [clearRetryTimer, commitLiveText, scheduleRestart, teardownRecognition]);

  const stop = useCallback((): string => {
    isRunningRef.current = false;
    clearRetryTimer();
    clearLiveTextTimer();
    teardownRecognition("stop");

    const result = transcriptRef.current.trim();
    transcriptRef.current = "";
    commitLiveText("", true);

    return result;
  }, [clearLiveTextTimer, clearRetryTimer, commitLiveText, teardownRecognition]);

  useEffect(
    () => () => {
      stop();
    },
    [stop],
  );

  useEffect(() => {
    setSupported(Boolean(getSpeechRecognitionAPI()));
  }, []);

  return { liveText, start, stop, supported };
}
