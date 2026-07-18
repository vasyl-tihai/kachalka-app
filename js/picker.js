// picker.js — горизонтальний барабан-прокрутка чисел (як на макеті)
// Центральне число — вибране. Можна гортати пальцем або тапнути по числу.

const ITEM_W = 58; // має збігатися з CSS .wheel-item width (великі цифри — легше обирати)

export class NumberWheel {
  /**
   * @param {HTMLElement} mount
   * @param {object} opts — { min, max, value, target, onChange }
   *   target — планова кількість: вибране число < target біле, > target жовте
   */
  constructor(mount, opts = {}) {
    this.mount = mount;
    this.min = opts.min ?? 1;
    this.max = opts.max ?? 30;
    this.target = opts.target ?? null;
    this.value = clamp(opts.value ?? this.min, this.min, this.max);
    this.onChange = opts.onChange || (() => {});
    this._scrollTimer = null;
    this._suppress = false;
    this._ready = false;
    this._build();

    // перерахувати відступи й виставити значення, коли контейнер отримає ширину.
    // Не покладаємось лише на rAF/ResizeObserver (вони залежать від циклу рендерингу):
    // пробуємо синхронно, через мікрозатримку і через ResizeObserver — що спрацює першим.
    if ('ResizeObserver' in window) {
      this._ro = new ResizeObserver(() => this._sizePads());
      this._ro.observe(this.mount);
    }
    this._sizePads();
    setTimeout(() => this._sizePads(), 0);
  }

  _build() {
    this.mount.classList.add('wheel');
    this.mount.innerHTML = `<div class="wheel-track">
      <div class="wheel-pad"></div><div class="wheel-pad wheel-pad-end"></div>
    </div>`;
    this.track = this.mount.querySelector('.wheel-track');
    this.padStart = this.track.querySelector('.wheel-pad');
    this.padEnd = this.track.querySelector('.wheel-pad-end');
    this._renderItems();

    this.mount.addEventListener('scroll', () => {
      if (this._suppress) return;
      clearTimeout(this._scrollTimer);
      this._highlightNearest();
      this._scrollTimer = setTimeout(() => this._snapToNearest(), 110);
    });
  }

  _renderItems() {
    // прибрати старі елементи (лишаючи пади на місці)
    this.track.querySelectorAll('.wheel-item').forEach((el) => el.remove());
    const frag = document.createDocumentFragment();
    for (let n = this.min; n <= this.max; n++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wheel-item';
      b.dataset.val = n;
      b.textContent = n;
      b.addEventListener('click', () => this.setValue(n, true));
      frag.appendChild(b);
    }
    this.track.insertBefore(frag, this.padEnd);
    this.items = Array.from(this.track.querySelectorAll('.wheel-item'));
  }

  _sizePads() {
    const w = this.mount.clientWidth;
    if (!w) {
      // контейнер ще без ширини — спробувати ще раз трохи згодом
      if ((this._padTries = (this._padTries || 0) + 1) <= 30) {
        setTimeout(() => this._sizePads(), 30);
      }
      return;
    }
    const pad = Math.max(0, Math.round(w / 2 - ITEM_W / 2));
    if (this.padStart.style.flex === `0 0 ${pad}px` && this._ready) return; // нічого не змінилось
    this.padStart.style.flex = `0 0 ${pad}px`;
    this.padEnd.style.flex = `0 0 ${pad}px`;
    // після зміни відступів — повернути поточне значення в центр (синхронно)
    this.setValue(this.value, false);
    this._ready = true;
  }

  setRange(min, max) {
    this.min = min;
    this.max = max;
    this.value = clamp(this.value, min, max);
    this._renderItems();
    this._ready = false;
    this._sizePads();
  }

  _itemFor(val) {
    return this.items.find((el) => Number(el.dataset.val) === val);
  }

  _highlightNearest() {
    const center = this.mount.scrollLeft + this.mount.clientWidth / 2;
    let best = null;
    let bestDist = Infinity;
    for (const el of this.items) {
      const c = el.offsetLeft + el.offsetWidth / 2;
      const d = Math.abs(c - center);
      if (d < bestDist) {
        bestDist = d;
        best = el;
      }
    }
    this._select(best);
    return best;
  }

  // позначити вибраний елемент + колір відносно цілі: менше — біле, більше — жовте
  _select(sel) {
    this.items.forEach((el) => {
      const on = el === sel;
      el.classList.toggle('is-selected', on);
      if (!on) {
        el.classList.remove('below', 'above');
        return;
      }
      const v = Number(el.dataset.val);
      const below = this.target != null && v < this.target;
      const above = this.target != null && v > this.target;
      el.classList.toggle('below', below);
      el.classList.toggle('above', above);
    });
  }

  setTarget(target) {
    this.target = target;
    this._select(this._itemFor(this.value));
  }

  _snapToNearest() {
    const best = this._highlightNearest();
    if (!best) return;
    const val = Number(best.dataset.val);
    this._scrollToEl(best, true);
    if (val !== this.value) {
      this.value = val;
      this.onChange(val);
    }
  }

  _scrollToEl(el, smooth) {
    const target = el.offsetLeft + el.offsetWidth / 2 - this.mount.clientWidth / 2;
    this._suppress = true;
    this.mount.scrollTo({ left: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
    clearTimeout(this._unsuppress);
    this._unsuppress = setTimeout(() => {
      this._suppress = false;
    }, smooth ? 360 : 60);
  }

  setValue(val, fire = true) {
    val = clamp(Math.round(val), this.min, this.max);
    this.value = val;
    const el = this._itemFor(val);
    if (el) {
      this._select(el);
      this._scrollToEl(el, false);
    }
    if (fire) this.onChange(val);
  }

  getValue() {
    // якщо барабан щойно гортали і снап ще не спрацював — зафіксувати центр одразу
    if (this._scrollTimer) {
      clearTimeout(this._scrollTimer);
      this._scrollTimer = null;
      this._snapToNearest();
    }
    return this.value;
  }

  destroy() {
    if (this._ro) this._ro.disconnect();
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
