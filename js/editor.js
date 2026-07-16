/* ============================================================
   PixelPeel — editor.js
   Viewport del escenario: zoom/pan, pincel de refinamiento
   (con previsualización tintada) y comparador antes/después.
   Los canvases mostrados son los de resolución ORIGINAL,
   escalados solo visualmente vía CSS transform.
   ============================================================ */

const TINT = {
  restore: 'rgba(95, 224, 124, 0.55)',
  erase: 'rgba(199, 125, 255, 0.55)',
};

export class Editor {
  /**
   * @param {object} o
   *  stage, transformEl, stackEl, divider, cursorEl : elementos DOM
   *  onStroke({points, mode, size})   : trazo terminado
   *  onTransform(scale)               : para actualizar el rótulo de zoom
   */
  constructor(o) {
    this.stage = o.stage;
    this.transformEl = o.transformEl;
    this.stackEl = o.stackEl;
    this.divider = o.divider;
    this.cursorEl = o.cursorEl;
    this.onStroke = o.onStroke;
    this.onTransform = o.onTransform || (() => {});

    this.item = null;
    this.tool = 'pan';
    this.brushSize = 60; // en píxeles de imagen
    this.compare = false;
    this.comparePct = 50;

    this.s = 1;
    this.tx = 0;
    this.ty = 0;

    this._spacePan = false;
    this._panning = false;
    this._stroke = null;

    this.overlay = document.createElement('canvas');
    this.overlay.className = 'layer layer-overlay';
    this.overlayCtx = this.overlay.getContext('2d');

    this._bind();
  }

  /* ================= elemento activo ================= */

  setItem(item) {
    this.stackEl.replaceChildren();
    this.item = item;
    this._stroke = null;

    if (!item) {
      this.transformEl.style.display = 'none';
      this.divider.hidden = true;
      return;
    }
    this.transformEl.style.display = '';

    const W = item.width;
    const H = item.height;
    this.stackEl.style.width = `${W}px`;
    this.stackEl.style.height = `${H}px`;
    this.transformEl.style.width = `${W}px`;
    this.transformEl.style.height = `${H}px`;

    const hasResult = item.status === 'done' && item.finalCanvas;
    if (hasResult) {
      item.finalCanvas.className = 'layer layer-final';
      item.originalCanvas.className = 'layer layer-original';
      this.stackEl.append(item.finalCanvas, item.originalCanvas);
      this.refCanvas = item.finalCanvas;
    } else {
      // aún sin resultado: mostrar el original como marcador
      item.originalCanvas.className = 'layer layer-final';
      item.originalCanvas.style.clipPath = ''; // limpiar recorte del comparador
      this.stackEl.append(item.originalCanvas);
      this.refCanvas = item.originalCanvas;
    }

    this.overlay.width = W;
    this.overlay.height = H;
    this.stackEl.append(this.overlay);

    this._syncCompare();
    this.fit();
  }

  refreshLayers() {
    // tras completarse el procesamiento del item activo
    if (this.item) this.setItem(this.item);
  }

  /* ================= herramientas ================= */

  setTool(tool) {
    this.tool = tool;
    this.stage.classList.toggle('is-pan', tool === 'pan');
    this.stage.classList.toggle('is-brush', tool === 'restore' || tool === 'erase');
    if (tool !== 'restore' && tool !== 'erase') this.cursorEl.hidden = true;
    this.cursorEl.classList.toggle('is-cut', tool === 'erase');
  }

  setBrushSize(px) {
    this.brushSize = px;
    this._sizeCursor();
  }

  setCompare(on) {
    this.compare = !!on;
    this._syncCompare();
  }

  _syncCompare() {
    const orig = this.item?.originalCanvas;
    const usable = this.item?.status === 'done';
    const show = this.compare && usable;
    if (orig) orig.classList.toggle('is-visible', show && orig.classList.contains('layer-original'));
    this.divider.hidden = !show;
    if (show) this._applyClip();
  }

  /* ================= transformaciones ================= */

  fit() {
    if (!this.item) return;
    const r = this.stage.getBoundingClientRect();
    const pad = 48;
    const s = Math.min(
      (r.width - pad) / this.item.width,
      (r.height - pad) / this.item.height,
    );
    this.s = Math.min(Math.max(s, 0.02), 8);
    this.tx = (r.width - this.item.width * this.s) / 2;
    this.ty = (r.height - this.item.height * this.s) / 2;
    this._apply();
  }

  zoomBy(k) {
    const r = this.stage.getBoundingClientRect();
    this._zoomAt(r.left + r.width / 2, r.top + r.height / 2, k);
  }

  _zoomAt(clientX, clientY, k) {
    if (!this.item) return;
    const r = this.stage.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    const ns = Math.min(Math.max(this.s * k, 0.02), 12);
    const kk = ns / this.s;
    this.tx = px - (px - this.tx) * kk;
    this.ty = py - (py - this.ty) * kk;
    this.s = ns;
    this._apply();
  }

  _apply() {
    this.transformEl.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.s})`;
    if (!this.divider.hidden) this._placeDivider();
    this._sizeCursor();
    this.onTransform(this.s);
  }

  /* ================= comparador ================= */

  _applyClip() {
    const orig = this.item?.originalCanvas;
    if (!orig) return;
    orig.style.clipPath = `inset(0 ${100 - this.comparePct}% 0 0)`;
    this._placeDivider();
  }

  _placeDivider() {
    if (!this.item) return;
    const x = this.tx + (this.comparePct / 100) * this.item.width * this.s;
    this.divider.style.left = `${x}px`;
  }

  _compareFromClientX(clientX) {
    const r = this.stage.getBoundingClientRect();
    const x = clientX - r.left;
    const pct = ((x - this.tx) / (this.item.width * this.s)) * 100;
    this.comparePct = Math.min(98, Math.max(2, pct));
    this._applyClip();
  }

  /* ================= coordenadas ================= */

  _toImage(e) {
    const r = this.refCanvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * this.item.width,
      y: ((e.clientY - r.top) / r.height) * this.item.height,
    };
  }

  /* ================= punteros ================= */

  _bind() {
    const st = this.stage;

    st.addEventListener('wheel', (e) => {
      if (!this.item) return;
      e.preventDefault();
      this._zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    st.addEventListener('pointerdown', (e) => this._down(e));
    st.addEventListener('pointermove', (e) => this._move(e));
    st.addEventListener('pointerup', (e) => this._up(e));
    st.addEventListener('pointercancel', (e) => this._up(e));
    st.addEventListener('pointerleave', () => { this.cursorEl.hidden = true; });

    // Divisor del comparador (elemento sin escalar, hijo del stage)
    this.divider.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this._divDrag = true;
      this.divider.setPointerCapture(e.pointerId);
    });
    this.divider.addEventListener('pointermove', (e) => {
      if (this._divDrag) this._compareFromClientX(e.clientX);
    });
    const endDiv = () => { this._divDrag = false; };
    this.divider.addEventListener('pointerup', endDiv);
    this.divider.addEventListener('pointercancel', endDiv);

    // Barra espaciadora = pan temporal
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !isTyping(e)) {
        this._spacePan = true;
        st.classList.add('is-pan');
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this._spacePan = false;
        if (this.tool !== 'pan') st.classList.remove('is-pan');
      }
    });

    window.addEventListener('resize', () => { if (this.item) this.fit(); });
  }

  _down(e) {
    if (!this.item) return;
    this.stage.setPointerCapture(e.pointerId);

    const wantsPan = e.button === 1 || this._spacePan || this.tool === 'pan';
    const isBrush = (this.tool === 'restore' || this.tool === 'erase');

    if (wantsPan) {
      this._panning = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this.stage.classList.add('is-panning');
      return;
    }

    if (isBrush && this.item.status === 'done' && e.button === 0) {
      const p = this._toImage(e);
      this._stroke = { points: [p], mode: this.tool, size: this.brushSize };
      this._drawOverlay();
    }
  }

  _move(e) {
    if (!this.item) return;

    if (this.tool === 'restore' || this.tool === 'erase') {
      this._placeCursor(e);
    }

    if (this._panning) {
      this.tx += e.clientX - this._lastX;
      this.ty += e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this._apply();
      return;
    }

    if (this._stroke) {
      const p = this._toImage(e);
      const pts = this._stroke.points;
      const last = pts[pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > 1.5) {
        pts.push(p);
        this._drawOverlay();
      }
    }
  }

  _up() {
    if (this._panning) {
      this._panning = false;
      this.stage.classList.remove('is-panning');
    }
    if (this._stroke) {
      const stroke = this._stroke;
      this._stroke = null;
      this.overlayCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
      this.onStroke(stroke);
    }
  }

  _drawOverlay() {
    const ctx = this.overlayCtx;
    const s = this._stroke;
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.strokeStyle = ctx.fillStyle = TINT[s.mode];
    ctx.lineWidth = s.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (s.points.length === 1) {
      const p = s.points[0];
      ctx.beginPath();
      ctx.arc(p.x, p.y, s.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      ctx.stroke();
    }
  }

  /* ================= cursor de pincel ================= */

  _placeCursor(e) {
    const r = this.stage.getBoundingClientRect();
    this.cursorEl.hidden = false;
    this.cursorEl.style.left = `${e.clientX - r.left}px`;
    this.cursorEl.style.top = `${e.clientY - r.top}px`;
    this._sizeCursor();
  }

  _sizeCursor() {
    const d = Math.max(4, this.brushSize * this.s);
    this.cursorEl.style.width = `${d}px`;
    this.cursorEl.style.height = `${d}px`;
  }
}

export function isTyping(e) {
  const t = e.target;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}
