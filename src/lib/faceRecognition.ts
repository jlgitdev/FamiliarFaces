let modelsLoaded = false;
let loadModelsPromise: Promise<void> | null = null;
let faceApiPromise: Promise<typeof import("face-api.js")> | null = null;

type NumericVector = ArrayLike<number>;
type StoredProfile = { personId: string; embedding: number[] };

interface DetectionOptions {
  frameWidth?: number;
  inputSize?: number;
  scoreThreshold?: number;
}

async function getFaceApi() {
  if (typeof window === "undefined") {
    throw new Error("Face recognition is only available in the browser");
  }

  faceApiPromise ??= import("face-api.js");
  return faceApiPromise;
}

export async function loadModels(): Promise<void> {
  if (modelsLoaded) return;
  if (loadModelsPromise) return loadModelsPromise;

  loadModelsPromise = (async () => {
    const faceapi = await getFaceApi();
    const MODEL_URL = "/models";

    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);

    modelsLoaded = true;
  })().catch((error) => {
    loadModelsPromise = null;
    throw error;
  });

  return loadModelsPromise;
}

interface DetectionResult {
  descriptor: Float32Array;
  box: { x: number; y: number; width: number; height: number };
}

async function getEmbeddingFromImageData(
  imageData: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
  options: DetectionOptions = {},
): Promise<DetectionResult | null> {
  const faceapi = await getFaceApi();
  const detection = await faceapi
    .detectSingleFace(
      imageData,
      new faceapi.TinyFaceDetectorOptions({
        inputSize: options.inputSize ?? 320,
        scoreThreshold: options.scoreThreshold ?? 0.5,
      }),
    )
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) return null;
  return {
    descriptor: detection.descriptor,
    box: detection.detection.box,
  };
}

export async function getEmbeddingFromVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  options: DetectionOptions = {},
): Promise<DetectionResult | null> {
  if (!video.videoWidth || !video.videoHeight) return null;

  const frameWidth = Math.min(options.frameWidth ?? 640, video.videoWidth);
  const frameHeight = Math.round(
    (frameWidth / video.videoWidth) * video.videoHeight,
  );

  if (canvas.width !== frameWidth || canvas.height !== frameHeight) {
    canvas.width = frameWidth;
    canvas.height = frameHeight;
  }

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return null;

  context.drawImage(video, 0, 0, frameWidth, frameHeight);

  const result = await getEmbeddingFromImageData(canvas, options);
  if (!result) return null;

  const scaleX = video.videoWidth / frameWidth;
  const scaleY = video.videoHeight / frameHeight;

  return {
    descriptor: result.descriptor,
    box: {
      x: result.box.x * scaleX,
      y: result.box.y * scaleY,
      width: result.box.width * scaleX,
      height: result.box.height * scaleY,
    },
  };
}

export function findBestMatch(
  liveEmbedding: NumericVector,
  storedProfiles: StoredProfile[],
  threshold = 0.55,
): { personId: string; distance: number } | null {
  if (storedProfiles.length === 0) return null;

  let bestMatch: { personId: string; distance: number } | null = null;
  let minSquaredDistance = threshold * threshold;

  for (const profile of storedProfiles) {
    if (liveEmbedding.length !== profile.embedding.length) continue;

    let squaredDistance = 0;

    for (let i = 0; i < liveEmbedding.length; i += 1) {
      const delta = liveEmbedding[i] - profile.embedding[i];
      squaredDistance += delta * delta;

      if (squaredDistance >= minSquaredDistance) break;
    }

    if (squaredDistance < minSquaredDistance) {
      minSquaredDistance = squaredDistance;
      bestMatch = {
        personId: profile.personId,
        distance: Math.sqrt(squaredDistance),
      };
    }
  }

  return bestMatch;
}
