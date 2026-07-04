// pose.js — завантаження MediaPipe Pose Landmarker (офлайн, з vendor-файлів)
// та допоміжні штуки для малювання скелета. Усе локальне: жодних CDN/мережі.
import { FilesetResolver, PoseLandmarker, DrawingUtils } from '../vendor/mediapipe/vision_bundle.mjs';

export { PoseLandmarker, DrawingUtils };

// кеш на кожен режим окремо — щоб перемикання режимів ніколи не закривало
// екземпляр, який досі використовує живий цикл детекції
const _byMode = {};
const _loadingByMode = {};

// шляхи рахуємо відносно цього модуля (/js/pose.js) → /vendor, /models
const WASM_DIR = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
const MODEL_URL = new URL('../models/pose_landmarker_lite.task', import.meta.url).href;

function optsFor(runningMode, delegate) {
  return {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  };
}

// отримати (з кешуванням) PoseLandmarker для режиму 'VIDEO' або 'IMAGE'.
// Пробуємо GPU, із відкатом на CPU (старі пристрої / без WebGL).
export async function getLandmarker(runningMode = 'VIDEO') {
  if (_byMode[runningMode]) return _byMode[runningMode];
  if (_loadingByMode[runningMode]) return _loadingByMode[runningMode];

  _loadingByMode[runningMode] = (async () => {
    const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
    let lm;
    try {
      lm = await PoseLandmarker.createFromOptions(fileset, optsFor(runningMode, 'GPU'));
    } catch (e) {
      // GPU-делегат недоступний (немає WebGL) → CPU
      lm = await PoseLandmarker.createFromOptions(fileset, optsFor(runningMode, 'CPU'));
    }
    _byMode[runningMode] = lm;
    return lm;
  })();
  try {
    return await _loadingByMode[runningMode];
  } finally {
    delete _loadingByMode[runningMode];
  }
}

// малювання скелета поверх відео на canvas
export function drawPose(ctx, landmarks, { highlight } = {}) {
  const du = new DrawingUtils(ctx);
  du.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, { color: '#5B9BFF', lineWidth: 3 });
  du.drawLandmarks(landmarks, { color: '#36D77A', radius: 3, lineWidth: 1 });
  // підсвітити трійку точок поточного суглоба
  if (highlight && highlight.length) {
    for (const i of highlight) {
      const p = landmarks[i];
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x * ctx.canvas.width, p.y * ctx.canvas.height, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#FFC24B';
      ctx.fill();
    }
  }
}
