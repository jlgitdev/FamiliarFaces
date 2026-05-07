export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 960 },
    height: { ideal: 540 },
    frameRate: { ideal: 24, max: 30 },
    facingMode: "user",
  },
  audio: false,
};

export function getCameraErrorMessage(error: unknown) {
  if (!(error instanceof DOMException)) {
    return "We could not start the camera. Check the device and try again.";
  }

  if (error.name === "NotAllowedError") {
    return "Allow camera access in the browser to use face recognition.";
  }

  if (error.name === "NotFoundError") {
    return "No camera was found on this device.";
  }

  if (error.name === "NotReadableError") {
    return "The camera is busy in another app. Close the other app and retry.";
  }

  return "We could not start the camera. Check the device and try again.";
}
