"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  findBestMatch,
  getEmbeddingFromVideoFrame,
  loadModels,
} from "@/lib/faceRecognition";
import {
  CAMERA_CONSTRAINTS,
  getCameraErrorMessage,
} from "@/lib/camera";
import { useSpeechTranscript } from "@/lib/useSpeechTranscript";

type RecognitionState = "idle" | "recognizing" | "recognized" | "unknown";
type StartupState =
  | "booting"
  | "ready"
  | "camera-error"
  | "model-error"
  | "data-error";

interface Person {
  id: string;
  name: string;
  relationship: string;
  bio: string;
  recentTopics: string;
  lastSeen: string | null;
}

interface StoredEmbedding {
  personId: string;
  embedding: number[];
}

interface Conversation {
  id: string;
  summary: string;
  createdAt: string;
}

interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function formatLastSeen(dateStr: string | null): string {
  if (!dateStr) return "Unknown";

  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
  }

  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
}

const glass: CSSProperties = {
  background: "rgba(10, 10, 10, 0.52)",
  backdropFilter: "blur(14px) saturate(150%)",
  WebkitBackdropFilter: "blur(14px) saturate(150%)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  boxShadow: "0 8px 28px rgba(0, 0, 0, 0.32)",
};

const MISS_THRESHOLD = 2;
const RECOGNITION_INTERVAL_MS = 1100;
const RECOGNITION_FRAME_WIDTH = 480;
const FACE_BOX_UPDATE_MS = 700;
const FACE_BOX_MIN_DELTA = 1.25;
export default function PatientView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recognitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const recognitionInFlightRef = useRef(false);
  const cameraRequestIdRef = useRef(0);
  const shouldResumeCameraRef = useRef(false);
  const missCountRef = useRef(0);
  const prevPersonRef = useRef<Person | null>(null);
  const isRecordingRef = useRef(false);
  const lastFaceBoxRef = useRef<FaceBox | null>(null);
  const lastFaceBoxUpdateRef = useRef(0);

  const [state, setState] = useState<RecognitionState>("idle");
  const [modelsReady, setModelsReady] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [recognizedPerson, setRecognizedPerson] = useState<Person | null>(null);
  const [storedEmbeddings, setStoredEmbeddings] = useState<StoredEmbedding[]>(
    [],
  );
  const [personsMap, setPersonsMap] = useState<Map<string, Person>>(new Map());
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [faceBox, setFaceBox] = useState<FaceBox | null>(null);
  const [conversationMode, setConversationMode] = useState(false);

  const {
    liveText,
    start: startMic,
    stop: stopMic,
    supported: speechSupported,
  } = useSpeechTranscript();

  const stopCamera = useCallback(() => {
    cameraRequestIdRef.current += 1;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.onloadedmetadata = null;
      videoRef.current.srcObject = null;
    }

    setCameraReady(false);
  }, []);

  const clearFaceBox = useCallback(() => {
    lastFaceBoxRef.current = null;
    lastFaceBoxUpdateRef.current = 0;
    setFaceBox(null);
  }, []);

  const updateFaceBox = useCallback((nextFaceBox: FaceBox) => {
    const previousFaceBox = lastFaceBoxRef.current;
    const now = performance.now();
    const moved =
      !previousFaceBox ||
      Math.abs(previousFaceBox.x - nextFaceBox.x) > FACE_BOX_MIN_DELTA ||
      Math.abs(previousFaceBox.y - nextFaceBox.y) > FACE_BOX_MIN_DELTA ||
      Math.abs(previousFaceBox.w - nextFaceBox.w) > FACE_BOX_MIN_DELTA ||
      Math.abs(previousFaceBox.h - nextFaceBox.h) > FACE_BOX_MIN_DELTA;
    const stale = now - lastFaceBoxUpdateRef.current > FACE_BOX_UPDATE_MS;

    if (!moved && !stale) return;

    lastFaceBoxRef.current = nextFaceBox;
    lastFaceBoxUpdateRef.current = now;
    setFaceBox(nextFaceBox);
  }, []);

  const loadAppData = useCallback(async () => {
    setDataError(null);
    setDataReady(false);

    try {
      const [embeddingsRes, personsRes] = await Promise.all([
        fetch("/api/embeddings?compact=true"),
        fetch("/api/persons"),
      ]);

      if (!embeddingsRes.ok || !personsRes.ok) {
        throw new Error("Failed to fetch recognition data");
      }

      const embeddingsData: StoredEmbedding[] = await embeddingsRes.json();
      const personsData: Person[] = await personsRes.json();
      const nextMap = new Map<string, Person>();

      personsData.forEach((person) => nextMap.set(person.id, person));

      setStoredEmbeddings(embeddingsData);
      setPersonsMap(nextMap);
      setDataReady(true);
    } catch (error) {
      console.error("Failed to fetch data:", error);
      setDataReady(false);
      setDataError(
        "We could not load the enrolled profiles. Check the database and retry.",
      );
    }
  }, []);

  const loadFaceModels = useCallback(async () => {
    setModelError(null);
    setModelsReady(false);

    try {
      await loadModels();
      setModelsReady(true);
    } catch (error) {
      console.error("Failed to load face models:", error);
      setModelsReady(false);
      setModelError(
        "Face detection models could not be loaded. Refresh and verify the model files are present.",
      );
    }
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    stopCamera();

    if (document.visibilityState !== "visible") {
      shouldResumeCameraRef.current = true;
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("This browser does not support camera access.");
      return;
    }

    const requestId = cameraRequestIdRef.current;

    try {
      const stream =
        await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);

      if (
        cameraRequestIdRef.current !== requestId ||
        document.visibilityState !== "visible"
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = async () => {
          if (cameraRequestIdRef.current !== requestId) return;

          try {
            await videoRef.current?.play();
          } catch {
            // Browsers can reject autoplay until metadata is ready.
          }
          setCameraReady(true);
        };
      } else {
        setCameraReady(true);
      }
    } catch (error) {
      if (cameraRequestIdRef.current !== requestId) return;

      console.warn("Camera access denied:", error);
      setCameraError(getCameraErrorMessage(error));
    }
  }, [stopCamera]);

  const persistConversation = useCallback(
    (personId: string | undefined, transcript: string) => {
      const trimmed = transcript.trim();

      if (!personId || trimmed.length <= 20) return;

      fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, transcript: trimmed }),
      }).catch(() => {});
    },
    [],
  );

  const fetchConversations = useCallback(async (personId: string) => {
    try {
      const response = await fetch(`/api/conversations?personId=${personId}`);
      if (!response.ok) return;
      const data: Conversation[] = await response.json();
      setConversations(data);
    } catch {
      setConversations([]);
    }
  }, []);

  useEffect(() => {
    setConversationMode(localStorage.getItem("ff-conversation-mode") === "true");
  }, []);

  useEffect(() => {
    void loadFaceModels();
    void loadAppData();
    void startCamera();

    return () => {
      if (recognitionTimerRef.current) {
        clearTimeout(recognitionTimerRef.current);
      }

      if (isRecordingRef.current) {
        stopMic();
      }

      stopCamera();
    };
  }, [loadAppData, loadFaceModels, startCamera, stopCamera, stopMic]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        shouldResumeCameraRef.current = Boolean(streamRef.current);

        if (recognitionTimerRef.current) {
          clearTimeout(recognitionTimerRef.current);
          recognitionTimerRef.current = null;
        }

        recognitionInFlightRef.current = false;
        stopCamera();
        clearFaceBox();
        setState("idle");
        setRecognizedPerson(null);

        if (isRecordingRef.current) {
          const transcript = stopMic();
          setIsRecording(false);
          isRecordingRef.current = false;
          persistConversation(prevPersonRef.current?.id, transcript);
        }
      } else if (shouldResumeCameraRef.current) {
        shouldResumeCameraRef.current = false;
        void startCamera();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [clearFaceBox, persistConversation, startCamera, stopCamera, stopMic]);

  useEffect(() => {
    const previous = prevPersonRef.current;

    if (recognizedPerson && recognizedPerson.id !== previous?.id) {
      setConversations([]);
      void fetchConversations(recognizedPerson.id);
      fetch(`/api/persons/${recognizedPerson.id}`, { method: "PATCH" }).catch(
        () => {},
      );

      if (conversationMode) {
        if (previous && isRecordingRef.current) {
          persistConversation(previous.id, stopMic());
        }

        if (speechSupported && startMic()) {
          setIsRecording(true);
          isRecordingRef.current = true;
        } else {
          setIsRecording(false);
          isRecordingRef.current = false;
        }
      }
    } else if (!recognizedPerson && previous) {
      const transcript = stopMic();
      setIsRecording(false);
      isRecordingRef.current = false;
      setConversations([]);

      if (conversationMode) {
        persistConversation(previous.id, transcript);
      }
    }

    prevPersonRef.current = recognizedPerson;
  }, [
    conversationMode,
    fetchConversations,
    persistConversation,
    recognizedPerson,
    speechSupported,
    startMic,
    stopMic,
  ]);

  const runRecognition = useCallback(async () => {
    if (!videoRef.current || !modelsReady || !dataReady) return;

    const video = videoRef.current;

    if (video.readyState < 2) return;

    setState((previousState) =>
      previousState === "idle" || previousState === "unknown"
        ? "recognizing"
        : previousState,
    );

    try {
      let canvas = recognitionCanvasRef.current;

      if (!canvas) {
        canvas = document.createElement("canvas");
        recognitionCanvasRef.current = canvas;
      }

      const result = await getEmbeddingFromVideoFrame(video, canvas, {
        frameWidth: RECOGNITION_FRAME_WIDTH,
        inputSize: 224,
        scoreThreshold: 0.45,
      });

      if (!result) {
        missCountRef.current += 1;

        if (missCountRef.current >= MISS_THRESHOLD) {
          setState("recognizing");
          setRecognizedPerson(null);
          clearFaceBox();
          missCountRef.current = 0;
        }

        return;
      }

      const { box, descriptor } = result;
      updateFaceBox({
        x: ((box.x + box.width / 2) / video.videoWidth) * 100,
        y: ((box.y + box.height) / video.videoHeight) * 100,
        w: (box.width / video.videoWidth) * 100,
        h: (box.height / video.videoHeight) * 100,
      });

      const match = findBestMatch(descriptor, storedEmbeddings);

      if (match) {
        const person = personsMap.get(match.personId);

        if (person) {
          missCountRef.current = 0;
          setRecognizedPerson(person);
          setState("recognized");
          return;
        }
      }

      missCountRef.current += 1;

      if (missCountRef.current >= MISS_THRESHOLD) {
        setState("unknown");
        setRecognizedPerson(null);
        clearFaceBox();
        missCountRef.current = 0;
      }
    } catch (error) {
      console.error("Recognition error:", error);
      setState("idle");
    }
  }, [
    clearFaceBox,
    dataReady,
    modelsReady,
    personsMap,
    storedEmbeddings,
    updateFaceBox,
  ]);

  const startupState: StartupState = useMemo(() => {
    if (modelError) return "model-error";
    if (dataError) return "data-error";
    if (cameraError) return "camera-error";
    if (modelsReady && dataReady && cameraReady) return "ready";
    return "booting";
  }, [cameraError, cameraReady, dataError, dataReady, modelError, modelsReady]);

  const readyForRecognition =
    startupState === "ready" && storedEmbeddings.length > 0;

  useEffect(() => {
    if (!readyForRecognition) return;

    let cancelled = false;

    const scheduleNextRun = () => {
      if (cancelled) return;
      recognitionTimerRef.current = setTimeout(runLoop, RECOGNITION_INTERVAL_MS);
    };

    const runLoop = async () => {
      if (cancelled) return;

      if (
        document.visibilityState !== "visible" ||
        recognitionInFlightRef.current
      ) {
        scheduleNextRun();
        return;
      }

      recognitionInFlightRef.current = true;
      await runRecognition();
      recognitionInFlightRef.current = false;
      scheduleNextRun();
    };

    setState((previousState) =>
      previousState === "recognized" ? previousState : "idle",
    );
    runLoop();

    return () => {
      cancelled = true;
      recognitionInFlightRef.current = false;
      if (recognitionTimerRef.current) {
        clearTimeout(recognitionTimerRef.current);
      }
    };
  }, [readyForRecognition, runRecognition]);

  const toggleConversationMode = useCallback(() => {
    if (!speechSupported) return;

    setConversationMode((previousValue) => {
      const nextValue = !previousValue;
      localStorage.setItem("ff-conversation-mode", String(nextValue));

      if (!nextValue && isRecordingRef.current) {
        const transcript = stopMic();
        setIsRecording(false);
        isRecordingRef.current = false;
        persistConversation(prevPersonRef.current?.id, transcript);
      } else if (
        nextValue &&
        recognizedPerson &&
        !isRecordingRef.current &&
        startMic()
      ) {
        setIsRecording(true);
        isRecordingRef.current = true;
      }

      return nextValue;
    });
  }, [persistConversation, recognizedPerson, speechSupported, startMic, stopMic]);

  const retryStartup = useCallback(() => {
    void loadFaceModels();
    void loadAppData();
    void startCamera();
  }, [loadAppData, loadFaceModels, startCamera]);

  const blockingNotice = useMemo(() => {
    if (startupState === "camera-error") {
      return {
        actionLabel: "Retry camera",
        description: cameraError ?? "",
        title: "Camera unavailable",
      };
    }

    if (startupState === "model-error") {
      return {
        actionLabel: "Retry setup",
        description: modelError ?? "",
        title: "Face models failed to load",
      };
    }

    if (startupState === "data-error") {
      return {
        actionLabel: "Retry setup",
        description: dataError ?? "",
        title: "Profile data is unavailable",
      };
    }

    if (startupState === "ready" && personsMap.size === 0) {
      return {
        actionLabel: "Open Admin",
        description:
          "Enroll someone and capture face samples before using patient mode.",
        title: "No profiles enrolled yet",
      };
    }

    if (startupState === "ready" && storedEmbeddings.length === 0) {
      return {
        actionLabel: "Open Admin",
        description:
          "Profiles exist, but face samples are still missing. Add at least one sample to start recognition.",
        title: "Face samples are missing",
      };
    }

    return null;
  }, [
    cameraError,
    dataError,
    modelError,
    personsMap.size,
    startupState,
    storedEmbeddings.length,
  ]);

  const statusLabel =
    startupState === "booting"
      ? "Starting up"
      : startupState === "camera-error"
        ? "Camera blocked"
        : startupState === "model-error"
          ? "Model load failed"
          : startupState === "data-error"
            ? "Profiles unavailable"
            : state === "recognized"
              ? "Recognized"
              : state === "unknown"
                ? "Unknown person"
                : "Scanning";

  const statusDotColor =
    startupState === "ready"
      ? state === "recognized"
        ? "#34d399"
        : state === "unknown"
          ? "#fb923c"
          : "#ffffff70"
      : startupState === "booting"
        ? "#fbbf24"
        : "#f87171";

  const transcriptPositionClass =
    state === "recognized"
      ? "hidden md:flex md:left-6 md:right-[408px] md:bottom-6"
      : "flex left-3 right-3 bottom-3 md:left-6 md:right-6 md:bottom-6";

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#030712] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.16),_transparent_28%),linear-gradient(180deg,_rgba(8,15,32,0.92),_rgba(3,7,18,1))]" />

      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
          cameraReady ? "opacity-100" : "opacity-0"
        }`}
      />

      <div className="absolute inset-0 bg-black/20" />

      <div
        className="absolute right-3 top-3 flex items-center gap-3 rounded-full px-4 py-2.5 md:right-5 md:top-5"
        style={glass}
      >
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 flex-shrink-0 rounded-full"
            style={{
              animation:
                startupState === "booting" ||
                (startupState === "ready" &&
                  (state === "recognizing" || state === "idle"))
                  ? "pulse 1.5s infinite"
                  : undefined,
              backgroundColor: statusDotColor,
              boxShadow:
                startupState === "ready" && state === "recognized"
                  ? "0 0 8px #34d399"
                  : undefined,
            }}
          />
          <span className="text-sm font-medium text-white/80">{statusLabel}</span>
        </div>

        <div className="h-4 w-px bg-white/20" />

        <button
          onClick={toggleConversationMode}
          disabled={!speechSupported}
          className="flex items-center gap-1.5 text-sm font-medium transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
          title={
            speechSupported
              ? conversationMode
                ? "Turn off conversation recording"
                : "Turn on conversation recording"
              : "Speech transcription is unavailable in this browser"
          }
        >
          {conversationMode && isRecording ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
              <span className="text-white/90">Rec</span>
            </>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke={conversationMode ? "white" : "rgba(255,255,255,0.45)"}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="23" />
              <line x1="8" x2="16" y1="23" y2="23" />
            </svg>
          )}
        </button>

        <div className="h-4 w-px bg-white/20" />

        <Link
          href="/admin"
          className="text-sm font-medium text-white/65 transition-colors hover:text-white"
        >
          Admin
        </Link>
      </div>

      {blockingNotice && (
        <div className="absolute inset-x-3 top-24 z-20 mx-auto max-w-lg md:top-28">
          <div className="rounded-[28px] px-6 py-6 text-center" style={glass}>
            <p className="text-xs font-medium uppercase tracking-[0.28em] text-white/45">
              FamiliarFaces
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white">
              {blockingNotice.title}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-white/68">
              {blockingNotice.description}
            </p>
            <div className="mt-5 flex justify-center">
              {blockingNotice.actionLabel === "Open Admin" ? (
                <Link
                  href="/admin"
                  className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-zinc-900 transition-transform hover:-translate-y-0.5"
                >
                  Open Admin
                </Link>
              ) : (
                <button
                  onClick={retryStartup}
                  className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-zinc-900 transition-transform hover:-translate-y-0.5"
                >
                  {blockingNotice.actionLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {startupState === "ready" &&
        state === "recognized" &&
        recognizedPerson &&
        faceBox && (
          <div
            className="ff-name-card absolute left-0 top-0 z-20 hidden lg:block"
            style={{
              transform: [
                `translate3d(${
                  faceBox.x > 30
                    ? faceBox.x - faceBox.w / 2 - 1
                    : faceBox.x + faceBox.w / 2 + 1
                }vw, ${faceBox.y - faceBox.h / 2}vh, 0)`,
                faceBox.x > 30
                  ? "translateX(-100%) translateY(-50%)"
                  : "translateY(-50%)",
              ].join(" "),
            }}
          >
            <div className="rounded-2xl px-5 py-3" style={glass}>
              <p className="text-xl font-semibold leading-none tracking-tight text-white">
                {recognizedPerson.name}
              </p>
              <p className="mt-1 text-sm font-medium text-white/55">
                {recognizedPerson.relationship}
              </p>
            </div>
          </div>
        )}

      {startupState === "ready" && state === "recognized" && recognizedPerson && (
        <div
          className="ff-info-panel absolute inset-x-3 bottom-3 z-20 max-h-[46vh] overflow-y-auto md:inset-x-auto md:right-6 md:w-[360px] md:max-h-[80vh]"
          style={{ ...glass, borderRadius: 28 }}
        >
          <InfoPanel person={recognizedPerson} conversations={conversations} />
        </div>
      )}

      {startupState !== "ready" || state !== "recognized" ? (
        <div
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-full px-5 py-2.5 md:bottom-6"
          style={glass}
        >
          {(startupState === "booting" ||
            (startupState === "ready" &&
              (state === "recognizing" || state === "idle"))) && (
            <svg
              className="h-3.5 w-3.5 animate-spin text-white/60"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="2.5"
              />
              <path
                className="opacity-75"
                d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
                fill="currentColor"
              />
            </svg>
          )}
          {startupState === "camera-error" && (
            <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-400" />
          )}
          {startupState === "ready" && state === "unknown" && (
            <span className="h-2 w-2 flex-shrink-0 rounded-full bg-orange-400" />
          )}
          <span className="text-sm font-medium text-white/80">
            {startupState === "booting" && "Preparing camera and recognition"}
            {startupState === "camera-error" && "Camera access is unavailable"}
            {startupState === "model-error" && "Face models failed to load"}
            {startupState === "data-error" && "Profiles could not be loaded"}
            {startupState === "ready" && storedEmbeddings.length === 0
              ? "Waiting for face samples"
              : null}
            {startupState === "ready" && storedEmbeddings.length > 0
              ? state === "idle" || state === "recognizing"
                ? "Scanning for faces"
                : state === "unknown"
                  ? "Unfamiliar face"
                  : null
              : null}
          </span>
        </div>
      ) : null}

      {isRecording && conversationMode && (
        <div
          className={`absolute ${transcriptPositionClass} items-start gap-3 rounded-2xl px-4 py-3`}
          style={glass}
        >
          <span className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-red-400 animate-pulse" />
          <p className="text-sm leading-relaxed text-white/90">
            {liveText || (
              <span className="italic text-white/40">Listening...</span>
            )}
          </p>
        </div>
      )}

      <style>{`
        @keyframes slideInDesktop {
          from {
            opacity: 0;
            transform: translateY(-50%) translateX(12px);
          }
          to {
            opacity: 1;
            transform: translateY(-50%) translateX(0);
          }
        }

        @keyframes slideInMobile {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .ff-name-card {
          contain: layout paint style;
          pointer-events: none;
          transition: transform 0.3s ease-out;
          will-change: transform;
        }

        .ff-info-panel {
          animation: slideInMobile 0.25s ease-out;
          contain: layout paint style;
          will-change: transform, opacity;
        }

        @media (min-width: 768px) {
          .ff-info-panel {
            top: 50%;
            bottom: auto;
            transform: translateY(-50%);
            animation: slideInDesktop 0.25s ease-out;
          }
        }
      `}</style>
    </div>
  );
}

const InfoPanel = memo(function InfoPanel({
  person,
  conversations,
}: {
  person: Person;
  conversations: Conversation[];
}) {
  return (
    <div className="space-y-6 px-6 py-6 md:px-7 md:py-7">
      <GlassField label="Your Bond" value={person.bio} />
      <GlassField label="A Shared Memory" value={person.recentTopics} />

      {conversations.length > 0 && (
        <div>
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-white/40">
            Recent conversations
          </p>
          <div className="space-y-2.5">
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                className="rounded-xl px-4 py-3"
                style={{
                  background: "rgba(255,255,255,0.07)",
                  border: "1px solid rgba(255,255,255,0.10)",
                }}
              >
                <p className="text-[15px] leading-relaxed text-white/90">
                  {conversation.summary}
                </p>
                <p className="mt-2 text-xs text-white/35">
                  {formatLastSeen(conversation.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {person.lastSeen && (
        <div className="pt-1">
          <p className="mb-1 text-xs font-medium uppercase tracking-widest text-white/40">
            Last visit
          </p>
          <p className="text-sm text-white/70">
            {formatLastSeen(person.lastSeen)}
          </p>
        </div>
      )}
    </div>
  );
});

function GlassField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-widest text-white/40">
        {label}
      </p>
      <p className="text-[16px] leading-relaxed text-white/90">
        {value || "Nothing has been added yet."}
      </p>
    </div>
  );
}
