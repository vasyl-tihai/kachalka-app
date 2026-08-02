// timer.js — круговий таймер відпочинку між підходами
// Малює SVG-кільце, що заповнюється, рахує час униз, вібрує/пищить у кінці.
import { t } from './i18n.js';

/**
 * Секундомір РОБОТИ — скільки триває сам підхід (гантелі в руках).
 * Рахує вгору, без сигналів у кінці: зупиняє його запис підходу.
 * Компактний рядок: кнопка ▶/⏸ + час + скидання.
 */
export class WorkStopwatch {
  constructor(mount) {
    this.mount = mount;
    this.running = false;
    this._acc = 0; // накопичено секунд до останньої паузи
    this._from = 0; // performance.now() старту поточного відрізка
    this._iv = null;
    this._build();
    this.render();
  }

  _build() {
    this.mount.innerHTML = `
      <button class="work-btn" type="button" id="workToggle">▶</button>
      <div class="work-info">
        <span class="work-lab">${t('Час роботи')}</span>
        <span class="work-time">0:00</span>
      </div>
      <button class="work-reset" type="button" title="${t('Скинути секундомір')}">↺</button>`;
    this.timeEl = this.mount.querySelector('.work-time');
    this.toggleBtn = this.mount.querySelector('.work-btn');
    this.toggleBtn.addEventListener('click', () => this.toggle());
    this.mount.querySelector('.work-reset').addEventListener('click', () => this.reset());
  }

  get seconds() {
    return this._acc + (this.running ? (performance.now() - this._from) / 1000 : 0);
  }

  _fmt(s) {
    s = Math.max(0, Math.floor(s));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  render() {
    this.timeEl.textContent = this._fmt(this.seconds);
    this.toggleBtn.textContent = this.running ? '⏸' : '▶';
    this.mount.classList.toggle('running', this.running);
  }

  toggle() {
    this.running ? this.pause() : this.start();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._from = performance.now();
    clearInterval(this._iv);
    this._iv = setInterval(() => this.render(), 200);
    this.render();
  }

  pause() {
    if (this.running) this._acc = this.seconds;
    this.running = false;
    clearInterval(this._iv);
    this.render();
  }

  reset() {
    this.pause();
    this._acc = 0;
    this.render();
  }

  destroy() {
    this.pause();
  }
}

export class RingTimer {
  /**
   * @param {HTMLElement} mount — контейнер
   * @param {object} opts — { seconds, onTick, onDone, onFinishFx }
   *   onFinishFx — власні ефекти в кінці (звук/вібрація/спалах за налаштуваннями);
   *   якщо не заданий, використовується вбудований сигнал.
   */
  constructor(mount, opts = {}) {
    this.mount = mount;
    this.total = opts.seconds || 60;
    this.remaining = this.total;
    this.onTick = opts.onTick || (() => {});
    this.onDone = opts.onDone || (() => {});
    this.onFinishFx = opts.onFinishFx || null;
    this.running = false;
    this._iv = null;
    this._endAt = 0;
    this._build();
    this.render();
  }

  _build() {
    const R = 52; // радіус кільця
    const C = 2 * Math.PI * R;
    this.circumference = C;
    this.mount.innerHTML = `
      <div class="ring-wrap">
        <svg class="ring-svg" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="ring-track" cx="60" cy="60" r="${R}" fill="none" stroke-width="9"/>
          <circle class="ring-progress" cx="60" cy="60" r="${R}" fill="none" stroke-width="9"
                  stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="0"
                  transform="rotate(-90 60 60)"/>
        </svg>
        <button class="ring-center" type="button">
          <span class="ring-time">${this._fmt(this.remaining)}</span>
          <span class="ring-hint">${t('сек')}</span>
        </button>
      </div>`;
    this.progress = this.mount.querySelector('.ring-progress');
    this.timeEl = this.mount.querySelector('.ring-time');
    this.hintEl = this.mount.querySelector('.ring-hint');
    this.centerBtn = this.mount.querySelector('.ring-center');
    this.centerBtn.addEventListener('click', () => this.toggle());
  }

  _fmt(s) {
    s = Math.max(0, Math.ceil(s));
    if (s >= 60) {
      const m = Math.floor(s / 60);
      const r = s % 60;
      return `${m}:${String(r).padStart(2, '0')}`;
    }
    return String(s);
  }

  setTotal(seconds) {
    this.total = Math.max(5, seconds);
    if (!this.running) {
      this.remaining = this.total;
      this.render();
    }
  }

  // ручне задання тривалості: скидає відлік на нове значення (працює і під час роботи)
  setDuration(seconds) {
    this.total = Math.max(5, Math.round(seconds));
    this.remaining = this.total;
    if (this.running) this._endAt = performance.now() + this.remaining * 1000;
    this.render();
  }

  render() {
    const frac = this.total > 0 ? this.remaining / this.total : 0;
    const offset = this.circumference * (1 - frac);
    this.progress.style.strokeDashoffset = offset;
    this.timeEl.textContent = this._fmt(this.remaining);
    this.mount.classList.toggle('running', this.running);
    this.hintEl.textContent = this.running ? t('пауза') : t('старт');
  }

  toggle() {
    this.running ? this.pause() : this.start();
  }

  start() {
    if (this.running) return;
    this._ensureAudio(); // старт у жесті користувача — розблоковуємо звук для сигналу в кінці
    if (this.remaining <= 0) this.remaining = this.total;
    this.running = true;
    this._endAt = performance.now() + this.remaining * 1000;
    clearInterval(this._iv);
    this._iv = setInterval(() => this._tick(), 100);
    this.render();
  }

  _tick() {
    if (!this.running) return;
    this.remaining = Math.max(0, (this._endAt - performance.now()) / 1000);
    this.render();
    this.onTick(this.remaining);
    if (this.remaining <= 0.05) {
      this.running = false;
      this.remaining = 0;
      clearInterval(this._iv);
      this.render();
      this._finish();
    }
  }

  pause() {
    this.running = false;
    clearInterval(this._iv);
    this.render();
  }

  reset() {
    this.pause();
    this.remaining = this.total;
    this.render();
  }

  add(seconds) {
    // налаштований відпочинок завжди змінюється на ±seconds (мін. 5с) —
    // тож збережений стандарт і наступний підхід беруть правильне значення
    this.total = Math.max(5, this.total + seconds);
    if (this.running) {
      this._endAt += seconds * 1000;
      // не дати залишку миттєво впасти до 0 (інакше хибний сигнал «кінець»)
      const minEnd = performance.now() + 1000;
      if (this._endAt < minEnd) this._endAt = minEnd;
      this.remaining = Math.max(0, (this._endAt - performance.now()) / 1000);
    } else {
      this.remaining = this.total;
    }
    this.render();
  }

  _finish() {
    if (this.onFinishFx) {
      // ефекти керуються ззовні (налаштування користувача)
      this.onFinishFx();
    } else {
      this._beep();
      // коротка вібрація — «час працювати»
      if (navigator.vibrate) navigator.vibrate([120, 80, 120, 80, 200]);
    }
    this.onDone();
  }

  _ensureAudio() {
    try {
      if (!this._ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this._ac = new AC();
      }
      if (this._ac && this._ac.state === 'suspended') this._ac.resume();
    } catch (e) {
      /* звук не критичний */
    }
  }

  _beep() {
    try {
      const ctx = this._ac;
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      // три короткі гучні сигнали — добре чути «час працювати»
      const t0 = ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        const t = t0 + i * 0.22;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g);
        g.connect(ctx.destination);
        o.type = 'square';
        o.frequency.value = 1000;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.start(t);
        o.stop(t + 0.18);
      }
    } catch (e) {
      /* звук не критичний */
    }
  }

  destroy() {
    this.pause();
    try { if (this._ac) this._ac.close(); } catch (e) {}
    this._ac = null;
  }
}
