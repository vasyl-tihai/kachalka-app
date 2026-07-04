// fx.js — звукові/тактильні ефекти сигналу «кінець відпочинку».
// Вбудовані звуки синтезуються Web Audio (без файлів і авторських прав),
// плюс можна завантажити свій звук (зберігається на пристрої).

export const SOUNDS = [
  { id: 'triple', label: 'Потрійний сигнал' },
  { id: 'bell', label: 'Дзвіночок' },
  { id: 'digital', label: 'Цифровий будильник' },
  { id: 'gong', label: 'Гонг' },
];

let ac = null;
let customEl = null; // <audio> зі своїм звуком (dataURL)

// ----- розблокування аудіо першим дотиком (політика мобільних браузерів) -----
function unlock() {
  try {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ac = new AC();
    }
    if (ac && ac.state === 'suspended') ac.resume();
    primeCustom();
  } catch (e) {
    /* не критично */
  }
}
export function initFx(getCustomSound) {
  // підвантажити збережений свій звук
  try {
    const data = getCustomSound && getCustomSound();
    if (data) setCustomSound(data);
  } catch (e) {}
  document.addEventListener('pointerdown', unlock, { passive: true });
}

export function setCustomSound(dataUrl) {
  try {
    customEl = dataUrl ? new Audio(dataUrl) : null;
    if (customEl) {
      customEl.preload = 'auto';
      primeCustom();
    }
  } catch (e) {
    customEl = null;
  }
}
// «прогріти» свій звук у межах жесту (щоб потім грав без блокування)
let primed = false;
function primeCustom() {
  if (!customEl || primed) return;
  const el = customEl;
  el.muted = true;
  const p = el.play();
  if (p && p.then) {
    p.then(() => {
      el.pause();
      el.currentTime = 0;
      el.muted = false;
      primed = true;
    }).catch(() => {
      el.muted = false;
    });
  }
}

// ----- синтезовані звуки -----
function tone(t0, freq, dur, { type = 'square', vol = 0.5 } = {}) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.connect(g);
  g.connect(ac.destination);
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

const SYNTH = {
  triple(t0) {
    for (let i = 0; i < 3; i++) tone(t0 + i * 0.22, 1000, 0.16, { type: 'square', vol: 0.5 });
  },
  bell(t0) {
    // дзвіночок: основний тон + обертони із довгим загасанням
    tone(t0, 880, 1.1, { type: 'sine', vol: 0.5 });
    tone(t0, 1760, 0.7, { type: 'sine', vol: 0.18 });
    tone(t0 + 0.35, 880, 1.0, { type: 'sine', vol: 0.35 });
    tone(t0 + 0.35, 2637, 0.4, { type: 'sine', vol: 0.08 });
  },
  digital(t0) {
    // класичний «біп-біп» будильника: 2 пари двотональних сигналів
    for (let i = 0; i < 4; i++) tone(t0 + i * 0.18, i % 2 ? 1250 : 850, 0.13, { type: 'square', vol: 0.45 });
  },
  gong(t0) {
    tone(t0, 196, 1.8, { type: 'sine', vol: 0.6 });
    tone(t0, 294, 1.4, { type: 'sine', vol: 0.25 });
    tone(t0, 392, 1.0, { type: 'triangle', vol: 0.15 });
  },
};

/** Програти звук за налаштуваннями ({soundOn, soundId}); customOverride — для прослуховування. */
export function playSound(settings, idOverride) {
  const id = idOverride || settings.soundId || 'triple';
  if (!idOverride && !settings.soundOn) return;
  try {
    if (id === 'custom') {
      if (customEl) {
        customEl.muted = false;
        customEl.currentTime = 0;
        customEl.play().catch(() => {});
        // не даємо довгим трекам грати нескінченно
        setTimeout(() => {
          try { customEl.pause(); customEl.currentTime = 0; } catch (e) {}
        }, 6000);
      }
      return;
    }
    unlock();
    if (!ac) return;
    const fn = SYNTH[id] || SYNTH.triple;
    fn(ac.currentTime);
  } catch (e) {
    /* звук не критичний */
  }
}

/** Коротка вібрація «час працювати». */
export function vibrateFinish(settings) {
  if (settings.vibrateOn === false) return;
  if (navigator.vibrate) navigator.vibrate([120, 80, 120, 80, 200]);
}
