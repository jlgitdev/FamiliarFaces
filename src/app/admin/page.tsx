'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CAMERA_CONSTRAINTS, getCameraErrorMessage } from '@/lib/camera';
import { getEmbeddingFromVideoFrame, loadModels } from '@/lib/faceRecognition';

interface Person {
  id: string;
  name: string;
  relationship: string;
  bio: string;
  recentTopics: string;
  lastSeen: string | null;
  embeddingCount: number;
}

type AdminView = 'list' | 'add';
type CaptureStatus = 'idle' | 'success' | 'error';

const CAPTURE_FRAME_WIDTH = 720;

export default function AdminPage() {
  const [view, setView] = useState<AdminView>('list');
  const [persons, setPersons] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [modelsReady, setModelsReady] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  const fetchPersons = useCallback(async () => {
    setLoading(true);
    setApiError(null);

    try {
      const response = await fetch('/api/persons');
      if (!response.ok) {
        throw new Error('Failed to fetch people');
      }

      const data: Person[] = await response.json();
      setPersons(data);
    } catch (error) {
      console.error(error);
      setApiError('People could not be loaded. Check the database and retry.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAdminModels = useCallback(async () => {
    if (modelsReady) return;

    setModelsError(null);

    try {
      await loadModels();
      setModelsReady(true);
    } catch (error) {
      console.error(error);
      setModelsReady(false);
      setModelsError(
        'Face models are unavailable. You can still manage records, but new captures are blocked until setup succeeds.',
      );
    }
  }, [modelsReady]);

  useEffect(() => {
    void fetchPersons();
  }, [fetchPersons]);

  useEffect(() => {
    if (view === 'add') {
      void loadAdminModels();
    }
  }, [loadAdminModels, view]);

  async function deletePerson(id: string) {
    if (!confirm('Remove this person from the database?')) return;

    setApiError(null);

    try {
      const response = await fetch(`/api/persons/${id}`, { method: 'DELETE' });

      if (!response.ok) {
        throw new Error('Delete failed');
      }

      await fetchPersons();
    } catch (error) {
      console.error(error);
      setApiError('The person could not be removed. Try again.');
    }
  }

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <header className="flex flex-col gap-4 border-b border-[#e5e7eb] bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-3 text-zinc-500 transition-colors hover:text-zinc-900"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="5" r="2.5" fill="white" />
                <path
                  d="M2 12c0-2.761 2.239-5 5-5s5 2.239 5 5"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <span className="text-[15px] font-semibold tracking-tight text-zinc-900">
              FamiliarFaces
            </span>
          </Link>
          <span className="text-zinc-300">/</span>
          <span className="text-sm text-zinc-500">Admin</span>
        </div>

        <div className="flex items-center gap-3">
          {view === 'add' && !modelsReady && !modelsError && (
            <span className="flex items-center gap-1.5 text-xs text-yellow-600">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse" />
              Loading models
            </span>
          )}
          <Link
            href="/"
            className="text-sm text-zinc-500 transition-colors hover:text-zinc-900"
          >
            ← Patient View
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-10">
        {(apiError || modelsError) && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {apiError || modelsError}
          </div>
        )}

        {view === 'list' ? (
          <ListView
            loading={loading}
            onAdd={() => setView('add')}
            onDelete={deletePerson}
            onRefresh={fetchPersons}
            persons={persons}
          />
        ) : (
          <EnrollView
            modelsReady={modelsReady}
            onCancel={() => setView('list')}
            onDone={() => {
              setView('list');
              void fetchPersons();
            }}
          />
        )}
      </div>
    </div>
  );
}

function ListView({
  persons,
  loading,
  onAdd,
  onDelete,
  onRefresh,
}: {
  persons: Person[];
  loading: boolean;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            People
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Manage enrolled visitors and their face data
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="rounded-lg px-3 py-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          >
            Refresh
          </button>
          <button
            onClick={onAdd}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
          >
            Add person
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <svg
            className="h-5 w-5 animate-spin text-zinc-400"
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
        </div>
      ) : persons.length === 0 ? (
        <div className="rounded-xl border border-[#e5e7eb] bg-white px-8 py-16 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9ca3af"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6" />
            </svg>
          </div>
          <h3 className="mb-1 text-sm font-semibold text-zinc-900">
            No people enrolled
          </h3>
          <p className="mb-6 text-sm text-zinc-500">
            Add a visitor so the patient can recognize them.
          </p>
          <button
            onClick={onAdd}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
          >
            Add first person
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {persons.map((person) => (
            <div
              key={person.id}
              className="flex flex-col gap-4 rounded-xl border border-[#e5e7eb] bg-white px-6 py-5 transition-colors hover:border-zinc-300 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold text-zinc-600">
                  {person.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-900">
                    {person.name}
                  </p>
                  <p className="text-xs text-zinc-500">{person.relationship}</p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-6 sm:justify-end">
                <div className="text-right">
                  <p className="text-xs text-zinc-400">Face samples</p>
                  <p
                    className={`text-sm font-semibold ${
                      person.embeddingCount >= 3
                        ? 'text-emerald-600'
                        : person.embeddingCount > 0
                          ? 'text-yellow-600'
                          : 'text-red-500'
                    }`}
                  >
                    {person.embeddingCount}
                    {person.embeddingCount < 3 && (
                      <span className="ml-1 text-xs font-normal text-zinc-400">
                        / 3 min
                      </span>
                    )}
                  </p>
                </div>

                <button
                  onClick={() => onDelete(person.id)}
                  className="p-1 text-zinc-400 transition-colors hover:text-red-500"
                  title="Remove"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4h6v2" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EnrollView({
  modelsReady,
  onDone,
  onCancel,
}: {
  modelsReady: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRequestIdRef = useRef(0);
  const captureStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const [step, setStep] = useState<'form' | 'capture' | 'done'>('form');
  const [form, setForm] = useState({
    name: '',
    relationship: '',
    bio: '',
    recentTopics: '',
  });
  const [personId, setPersonId] = useState<string | null>(null);
  const [capturedCount, setCapturedCount] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<typeof form>>({});

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

    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    stopCamera();

    if (document.visibilityState !== 'visible') return;

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser does not support camera access.');
      return;
    }

    const requestId = cameraRequestIdRef.current;

    try {
      const stream =
        await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);

      if (
        cameraRequestIdRef.current !== requestId ||
        document.visibilityState !== 'visible'
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
          setCameraOn(true);
        };
      } else {
        setCameraOn(true);
      }
    } catch (error) {
      if (cameraRequestIdRef.current !== requestId) return;

      console.warn('Camera error:', error);
      setCameraError(getCameraErrorMessage(error));
    }
  }, [stopCamera]);

  useEffect(() => {
    if (step !== 'capture') {
      stopCamera();
      return;
    }

    void startCamera();

    return () => {
      stopCamera();
    };
  }, [startCamera, step, stopCamera]);

  useEffect(() => {
    if (step !== 'capture') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stopCamera();
      } else {
        void startCamera();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [startCamera, step, stopCamera]);

  useEffect(
    () => () => {
      if (captureStatusTimerRef.current) {
        clearTimeout(captureStatusTimerRef.current);
      }
    },
    [],
  );

  function validateForm() {
    const nextErrors: Partial<typeof form> = {};

    if (!form.name.trim()) nextErrors.name = 'Name is required';
    if (!form.relationship.trim()) {
      nextErrors.relationship = 'Relationship is required';
    }
    if (!form.bio.trim()) nextErrors.bio = 'Bio is required';
    if (!form.recentTopics.trim()) {
      nextErrors.recentTopics = 'Topics are required';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleFormSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!validateForm()) return;

    setSubmitError(null);
    setSubmitting(true);

    try {
      const response = await fetch('/api/persons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!response.ok) {
        throw new Error('Failed to create person');
      }

      const data = await response.json();
      setPersonId(data.id);
      setStep('capture');
    } catch (error) {
      console.error(error);
      setSubmitError('The person could not be created. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function capturePhoto() {
    if (!videoRef.current || !personId || !modelsReady) return;

    setCapturing(true);
    setCaptureStatus('idle');
    setSubmitError(null);

    try {
      let canvas = captureCanvasRef.current;

      if (!canvas) {
        canvas = document.createElement('canvas');
        captureCanvasRef.current = canvas;
      }

      const result = await getEmbeddingFromVideoFrame(videoRef.current, canvas, {
        frameWidth: CAPTURE_FRAME_WIDTH,
        inputSize: 320,
        scoreThreshold: 0.5,
      });

      if (!result) {
        setCaptureStatus('error');
        return;
      }

      const response = await fetch('/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personId,
          embedding: Array.from(result.descriptor),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save embedding');
      }

      setCapturedCount((count) => count + 1);
      setCaptureStatus('success');
    } catch (error) {
      console.error(error);
      setCaptureStatus('error');
      setSubmitError('The face sample could not be saved. Try again.');
    } finally {
      setCapturing(false);
      if (captureStatusTimerRef.current) {
        clearTimeout(captureStatusTimerRef.current);
      }
      captureStatusTimerRef.current = setTimeout(
        () => setCaptureStatus('idle'),
        2000,
      );
    }
  }

  if (step === 'done') {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#10b981"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2 className="mb-2 text-xl font-semibold text-zinc-900">
          Person enrolled
        </h2>
        <p className="mb-8 text-sm text-zinc-500">
          {form.name} has been added with {capturedCount} face sample
          {capturedCount !== 1 ? 's' : ''}.
        </p>
        <button
          onClick={onDone}
          className="rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
        >
          Back to people list
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-8 flex items-center gap-2">
        <button
          onClick={() => {
            stopCamera();
            onCancel();
          }}
          className="text-sm text-zinc-500 transition-colors hover:text-zinc-900"
        >
          People
        </button>
        <span className="text-zinc-300">/</span>
        <span className="text-sm text-zinc-900">Add person</span>
      </div>

      {step === 'form' ? (
        <form onSubmit={handleFormSubmit} className="space-y-6">
          <div>
            <h1 className="mb-1 text-2xl font-semibold tracking-tight text-zinc-900">
              Add a person
            </h1>
            <p className="text-sm text-zinc-500">
              Fill in their details. The patient will see this information when
              they are recognized.
            </p>
          </div>

          <div className="space-y-5 rounded-xl border border-[#e5e7eb] bg-white p-6">
            <FormField
              label="Full name"
              placeholder="e.g. Sarah"
              value={form.name}
              onChange={(value) => setForm((current) => ({ ...current, name: value }))}
              error={errors.name}
            />
            <FormField
              label="Relationship"
              placeholder="e.g. Granddaughter, Neighbor, Doctor"
              value={form.relationship}
              onChange={(value) =>
                setForm((current) => ({ ...current, relationship: value }))
              }
              error={errors.relationship}
            />
            <FormField
              label="Your Bond"
              placeholder="e.g. Sarah is your granddaughter. She grew up visiting you every Sunday and loves cooking with you."
              value={form.bio}
              onChange={(value) => setForm((current) => ({ ...current, bio: value }))}
              error={errors.bio}
              multiline
            />
            <FormField
              label="A Shared Memory"
              placeholder="e.g. Her dog Milo, school, gardening, old family recipes"
              value={form.recentTopics}
              onChange={(value) =>
                setForm((current) => ({ ...current, recentTopics: value }))
              }
              error={errors.recentTopics}
              multiline
            />
          </div>

          {submitError && (
            <p className="text-sm text-red-600">{submitError}</p>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-[#e5e7eb] px-4 py-2.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Save & capture face →'}
            </button>
          </div>
        </form>
      ) : (
        <div>
          <div className="mb-8">
            <h1 className="mb-1 text-2xl font-semibold tracking-tight text-zinc-900">
              Capture face — {form.name}
            </h1>
            <p className="text-sm text-zinc-500">
              Take 3 to 5 photos with slightly different angles for best
              accuracy.{' '}
              <span
                className={
                  capturedCount >= 3
                    ? 'font-medium text-emerald-600'
                    : 'text-zinc-500'
                }
              >
                {capturedCount} captured
                {capturedCount >= 3 && ' ✓'}
              </span>
            </p>
          </div>

          <div className="mb-6 overflow-hidden rounded-xl border border-[#e5e7eb] bg-white">
            <div className="relative aspect-video bg-zinc-950">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className={`h-full w-full object-cover transition-opacity duration-300 ${
                  cameraOn ? 'opacity-100' : 'opacity-0'
                }`}
              />

              {!cameraOn && (
                <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
                  <div>
                    <p className="text-sm font-medium text-white/90">
                      {cameraError ? 'Camera unavailable' : 'Starting camera'}
                    </p>
                    <p className="mt-1 text-xs text-white/55">
                      {cameraError ||
                        'This takes a moment while the device grants access.'}
                    </p>
                    {cameraError && (
                      <button
                        onClick={() => void startCamera()}
                        className="mt-4 rounded-full bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition-transform hover:-translate-y-0.5"
                      >
                        Retry camera
                      </button>
                    )}
                  </div>
                </div>
              )}

              {captureStatus === 'success' && (
                <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/20 backdrop-blur-[2px]">
                  <div className="rounded-full bg-white p-3 shadow-lg">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                </div>
              )}

              {captureStatus === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-red-500/20 backdrop-blur-[2px]">
                  <div className="rounded-xl bg-white px-4 py-3 text-center shadow-lg">
                    <p className="text-sm font-medium text-red-600">
                      No face detected
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      Position the face in frame and try again.
                    </p>
                  </div>
                </div>
              )}

              <div className="absolute right-3 top-3">
                <div className="flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1.5 text-xs text-white backdrop-blur-sm">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <span
                      key={index}
                      className={`h-1.5 w-1.5 rounded-full ${
                        index < capturedCount ? 'bg-emerald-400' : 'bg-white/30'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-[#e5e7eb] p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-zinc-500">
                {!modelsReady
                  ? 'Recognition models are still loading.'
                  : cameraOn
                    ? 'Camera active — ensure good lighting and vary the angle slightly.'
                    : 'Waiting for camera access.'}
              </p>
              <button
                onClick={capturePhoto}
                disabled={capturing || !cameraOn || !modelsReady}
                className="flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40"
              >
                {capturing ? (
                  <>
                    <svg
                      className="h-3.5 w-3.5 animate-spin"
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
                    Processing
                  </>
                ) : (
                  <>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <circle cx="12" cy="12" r="4" />
                      <path d="M9 2h6l2 3h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3L9 2z" />
                    </svg>
                    Capture photo
                  </>
                )}
              </button>
            </div>
          </div>

          {submitError && (
            <p className="mb-4 text-sm text-red-600">{submitError}</p>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => {
                stopCamera();
                setStep('form');
              }}
              className="rounded-lg border border-[#e5e7eb] px-4 py-2.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
            >
              ← Back
            </button>
            <button
              onClick={() => {
                stopCamera();
                setStep('done');
              }}
              disabled={capturedCount < 3}
              className="flex-1 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40"
            >
              {capturedCount < 3
                ? `Capture ${3 - capturedCount} more sample${
                    3 - capturedCount === 1 ? '' : 's'
                  }`
                : `Done — ${capturedCount} photos captured`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FormField({
  label,
  placeholder,
  value,
  onChange,
  error,
  multiline,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  multiline?: boolean;
}) {
  const baseClass = `w-full rounded-lg border px-3.5 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 ${
    error ? 'border-red-300 bg-red-50/50' : 'border-[#e5e7eb] bg-white'
  }`;

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-600">
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={3}
          className={`${baseClass} resize-none`}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={baseClass}
        />
      )}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
