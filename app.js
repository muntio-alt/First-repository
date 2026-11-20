/* 내 옷장 — 가상 옷장 & 아바타 피팅 웹앱
 * 모든 데이터는 이 기기의 브라우저(IndexedDB / localStorage)에만 저장됩니다.
 */
'use strict';

/* ---------- 상수 ---------- */

// 카테고리 = 아바타 착용 슬롯. rect: 아바타(300x600) 좌표계 기준 기본 위치 [x, y, w, h]
const SLOTS = [
  { key: 'top',       label: '상의',     emoji: '👕', rect: [62, 110, 176, 200] },
  { key: 'bottom',    label: '하의',     emoji: '👖', rect: [80, 278, 140, 265] },
  { key: 'dress',     label: '원피스',   emoji: '👗', rect: [60, 110, 180, 330] },
  { key: 'outer',     label: '아우터',   emoji: '🧥', rect: [48, 104, 204, 260] },
  { key: 'shoes',     label: '신발',     emoji: '👟', rect: [80, 515, 140, 70] },
  { key: 'bag',       label: '가방',     emoji: '👜', rect: [196, 238, 92, 112] },
  { key: 'hat',       label: '모자',     emoji: '🧢', rect: [100, 6, 100, 72] },
  { key: 'accessory', label: '액세서리', emoji: '💍', rect: [116, 92, 68, 60] },
];
const SLOT = Object.fromEntries(SLOTS.map(s => [s.key, s]));
// 아래 → 위 순서로 겹쳐 그림
const Z_ORDER = ['bottom', 'shoes', 'top', 'dress', 'outer', 'bag', 'accessory', 'hat'];

const COLORS = [
  { name: '블랙', hex: '#222222' }, { name: '화이트', hex: '#f7f7f5' }, { name: '그레이', hex: '#9e9e9e' },
  { name: '네이비', hex: '#1f2a44' }, { name: '블루', hex: '#3b6fd8' }, { name: '스카이', hex: '#8ec5ff' },
  { name: '그린', hex: '#3c8d5a' }, { name: '카키', hex: '#7a7a4a' }, { name: '베이지', hex: '#e3d3b5' },
  { name: '브라운', hex: '#7b5235' }, { name: '레드', hex: '#d23b3b' }, { name: '핑크', hex: '#f2a0b8' },
  { name: '옐로', hex: '#f4d03f' }, { name: '퍼플', hex: '#8e5cc7' }, { name: '멀티', hex: 'multi' },
];
const COLOR = Object.fromEntries(COLORS.map(c => [c.name, c]));
const SEASONS = ['봄', '여름', '가을', '겨울'];

const SKINS = ['#fde3cf', '#f5cfae', '#e0ac85', '#b9805a', '#7d5136'];
const HAIR_COLORS = ['#2a1d17', '#5a3825', '#a0673b', '#d9b26f', '#9a9a9a'];
const HAIR_STYLES = [
  { key: 'short', label: '숏컷' }, { key: 'bob', label: '단발' },
  { key: 'long', label: '긴머리' }, { key: 'none', label: '없음' },
];
const BODY_TYPES = [
  { key: 'slim', label: '슬림', k: 0.9 }, { key: 'normal', label: '보통', k: 1 }, { key: 'broad', label: '듬직', k: 1.12 },
];

/* ---------- 유틸 ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmtDate = t => { const d = new Date(t); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; };

function currentSeason() {
  const m = new Date().getMonth() + 1;
  if (m >= 3 && m <= 5) return '봄';
  if (m >= 6 && m <= 8) return '여름';
  if (m >= 9 && m <= 11) return '가을';
  return '겨울';
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

function colorDot(name) {
  const c = COLOR[name];
  if (!c) return '';
  return c.hex === 'multi' ? '<span class="dot multi"></span>' : `<span class="dot" style="background:${c.hex}"></span>`;
}

/* ---------- 저장소 (IndexedDB) ---------- */

const DB = {
  db: null,
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('my-wardrobe', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('outfits')) d.createObjectStore('outfits', { keyPath: 'id' });
      };
      req.onsuccess = () => { this.db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  },
  tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(store, mode);
      const s = t.objectStore(store);
      const r = fn(s);
      t.oncomplete = () => resolve(r && r.result);
      t.onerror = () => reject(t.error);
    });
  },
  all(store) { return this.tx(store, 'readonly', s => s.getAll()); },
  put(store, val) { return this.tx(store, 'readwrite', s => s.put(val)); },
  del(store, id) { return this.tx(store, 'readwrite', s => s.delete(id)); },
  clear(store) { return this.tx(store, 'readwrite', s => s.clear()); },
};

/* ---------- 상태 ---------- */

const state = {
  tab: 'closet',
  items: [],
  outfits: [],
  avatar: loadAvatar(),
  closet: { cat: 'all', q: '', season: 'all' },
  fit: { slots: {}, selected: null, cat: 'top', outfitId: null, outfitName: '' },
};

function loadAvatar() {
  const def = { skin: SKINS[1], hair: 'short', hairColor: HAIR_COLORS[0], body: 'normal' };
  try { return { ...def, ...JSON.parse(localStorage.getItem('wardrobe.avatar') || '{}') }; }
  catch { return def; }
}
function saveAvatar() {
  try { localStorage.setItem('wardrobe.avatar', JSON.stringify(state.avatar)); } catch {}
}
const itemById = id => state.items.find(i => i.id === id);

/* ---------- 이미지 처리 ---------- */

async function fileToCanvas(file, max = 900) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('이미지를 열 수 없어요'));
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 가장자리에서 시작하는 flood-fill로 배경(벽, 바닥, 침대 등 단색 배경)을 투명하게 만듭니다.
function removeBackground(src, tol) {
  const w = src.width, h = src.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const p = data.data;

  // 네 모서리의 평균 색 = 배경 후보색
  const patch = 6, refs = [];
  for (const [cx, cy] of [[0, 0], [w - patch, 0], [0, h - patch], [w - patch, h - patch]]) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = Math.max(0, cy); y < Math.min(h, cy + patch); y++)
      for (let x = Math.max(0, cx); x < Math.min(w, cx + patch); x++) {
        const i = (y * w + x) * 4; r += p[i]; g += p[i + 1]; b += p[i + 2]; n++;
      }
    refs.push([r / n, g / n, b / n]);
  }
  const t2 = tol * tol;
  const near = idx => {
    const i = idx * 4;
    if (p[i + 3] === 0) return true;
    for (const [r, g, b] of refs) {
      const dr = p[i] - r, dg = p[i + 1] - g, db = p[i + 2] - b;
      if (dr * dr + dg * dg + db * db <= t2) return true;
    }
    return false;
  };

  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = idx => { if (!seen[idx] && near(idx)) { seen[idx] = 1; stack[sp++] = idx; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) {
    const idx = stack[--sp];
    p[idx * 4 + 3] = 0;
    const x = idx % w, y = (idx / w) | 0;
    if (x > 0) push(idx - 1);
    if (x < w - 1) push(idx + 1);
    if (y > 0) push(idx - w);
    if (y < h - 1) push(idx + w);
  }
  // 경계 부드럽게
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (seen[idx]) continue;
      if (seen[idx - 1] || seen[idx + 1] || seen[idx - w] || seen[idx + w]) p[idx * 4 + 3] = Math.min(p[idx * 4 + 3], 170);
    }
  ctx.putImageData(data, 0, 0);
  return autoCrop(out);
}

// 투명 영역을 잘라내 옷만 남김 (아바타에 맞추기 쉬워짐)
function autoCrop(c) {
  const w = c.width, h = c.height;
  const p = c.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (p[(y * w + x) * 4 + 3] > 20) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  if (x1 < 0) return c; // 전부 지워졌으면 원본 유지
  const pad = 4;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/* ---------- 아바타 SVG ---------- */

function hairSVG(a, layer) {
  const c = a.hairColor;
  if (a.hair === 'none') return '';
  if (layer === 'back') {
    if (a.hair === 'long') return `<path d="M112 62 Q110 40 150 32 Q190 40 188 62 L196 190 Q150 206 104 190 Z" fill="${c}"/>`;
    if (a.hair === 'bob') return `<path d="M112 62 Q110 40 150 32 Q190 40 188 62 L192 118 Q150 128 108 118 Z" fill="${c}"/>`;
    return '';
  }
  // front (앞머리)
  if (a.hair === 'short') return `<path d="M114 70 Q108 30 150 28 Q194 30 186 70 Q178 48 150 46 Q124 48 114 70 Z" fill="${c}"/>`;
  return `<path d="M114 74 Q106 30 150 28 Q196 30 186 74 Q182 52 160 46 Q140 58 118 56 Z" fill="${c}"/>`;
}

function bodySVG(a) {
  const k = (BODY_TYPES.find(b => b.key === a.body) || BODY_TYPES[1]).k;
  const s = a.skin;
  const shade = 'rgba(0,0,0,.08)';
  return `
  <g class="body">
    ${hairSVG(a, 'back')}
    <g transform="translate(150 0) scale(${k} 1) translate(-150 0)">
      <line x1="100" y1="132" x2="76" y2="300" stroke="${s}" stroke-width="22" stroke-linecap="round"/>
      <line x1="200" y1="132" x2="224" y2="300" stroke="${s}" stroke-width="22" stroke-linecap="round"/>
      <circle cx="75" cy="306" r="12" fill="${s}"/>
      <circle cx="225" cy="306" r="12" fill="${s}"/>
      <line x1="126" y1="300" x2="124" y2="532" stroke="${s}" stroke-width="34" stroke-linecap="round"/>
      <line x1="174" y1="300" x2="176" y2="532" stroke="${s}" stroke-width="34" stroke-linecap="round"/>
      <rect x="138" y="96" width="24" height="28" rx="8" fill="${s}"/>
      <path d="M96 128 Q150 112 204 128 L212 296 Q150 306 88 296 Z" fill="${s}"/>
      <!-- 기본 이너 -->
      <path d="M104 132 Q150 124 196 132 L204 250 Q150 258 96 250 Z" fill="#d9d4cf"/>
      <path d="M92 262 Q150 270 208 262 L212 320 L156 324 L150 308 L144 324 L88 320 Z" fill="#bdb6ae"/>
      <path d="M96 128 Q150 112 204 128" fill="none" stroke="${shade}" stroke-width="3"/>
    </g>
    <ellipse cx="122" cy="544" rx="22" ry="10" fill="${s}"/>
    <ellipse cx="178" cy="544" rx="22" ry="10" fill="${s}"/>
    <circle cx="150" cy="68" r="36" fill="${s}"/>
    <circle cx="114" cy="72" r="6" fill="${s}"/>
    <circle cx="186" cy="72" r="6" fill="${s}"/>
    ${hairSVG(a, 'front')}
    <circle cx="137" cy="74" r="3.4" fill="#2b2420"/>
    <circle cx="163" cy="74" r="3.4" fill="#2b2420"/>
    <ellipse cx="130" cy="86" rx="6" ry="3" fill="#f2a0a0" opacity=".45"/>
    <ellipse cx="170" cy="86" rx="6" ry="3" fill="#f2a0a0" opacity=".45"/>
    <path d="M141 88 Q150 95 159 88" fill="none" stroke="#2b2420" stroke-width="2.4" stroke-linecap="round"/>
  </g>`;
}

function layerTransform(slotKey, t) {
  const [x, y, w, h] = SLOT[slotKey].rect;
  const cx = x + w / 2, cy = y + h / 2;
  return `translate(${t.dx || 0} ${t.dy || 0}) translate(${cx} ${cy}) rotate(${t.r || 0}) scale(${t.s || 1}) translate(${-cx} ${-cy})`;
}

// slots: { slotKey: { itemId, dx, dy, s, r } }
function avatarSVG(slots, opts = {}) {
  const layers = Z_ORDER.map(key => {
    const t = slots[key];
    if (!t) return '';
    const item = itemById(t.itemId);
    if (!item) return '';
    const [x, y, w, h] = SLOT[key].rect;
    const sel = opts.selected === key;
    return `<g class="layer${sel ? ' selected' : ''}" data-slot="${key}" transform="${layerTransform(key, t)}">
      <image href="${item.image}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>
      ${opts.interactive ? `<rect class="sel-box" x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#c8734f" stroke-width="2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="transparent"/>` : ''}
    </g>`;
  }).join('');
  return `<svg viewBox="0 0 300 600" xmlns="http://www.w3.org/2000/svg" ${opts.id ? `id="${opts.id}"` : ''}>
    <ellipse cx="150" cy="556" rx="80" ry="10" fill="rgba(0,0,0,.08)"/>
    ${bodySVG(state.avatar)}
    ${layers}
  </svg>`;
}

/* ---------- 라우팅 / 화면 ---------- */

const TITLES = { closet: '내 옷장', fitting: '피팅룸', outfits: '코디북', settings: '설정' };

function go(tab) {
  state.tab = tab;
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#screen-title').textContent = TITLES[tab];
  render();
  window.scrollTo(0, 0);
}

function render() {
  const app = $('#app');
  const sub = $('#screen-sub');
  if (state.tab === 'closet') { sub.textContent = `옷 ${state.items.length}벌`; renderCloset(app); }
  if (state.tab === 'fitting') { sub.textContent = state.fit.outfitName ? `「${state.fit.outfitName}」 편집 중` : ''; renderFitting(app); }
  if (state.tab === 'outfits') { sub.textContent = `코디 ${state.outfits.length}개`; renderOutfits(app); }
  if (state.tab === 'settings') { sub.textContent = ''; renderSettings(app); }
}

/* ---------- 옷장 화면 ---------- */

function filteredItems() {
  const { cat, q, season } = state.closet;
  const query = q.trim().toLowerCase();
  return state.items
    .filter(i => cat === 'all' || i.category === cat)
    .filter(i => season === 'all' || !i.seasons?.length || i.seasons.includes(season))
    .filter(i => !query || [i.name, i.brand, i.memo, i.color, SLOT[i.category]?.label].join(' ').toLowerCase().includes(query))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function renderCloset(app) {
  const { cat, q, season } = state.closet;
  const counts = {};
  state.items.forEach(i => { counts[i.category] = (counts[i.category] || 0) + 1; });
  const list = filteredItems();

  app.innerHTML = `
    <div class="toolbar">
      <input class="input grow" id="q" type="search" placeholder="🔍 이름, 브랜드, 색상으로 검색" value="${esc(q)}">
      <select class="input" id="season" style="width:auto">
        <option value="all">전체 계절</option>
        ${SEASONS.map(s => `<option value="${s}" ${season === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="chips">
      <button class="chip ${cat === 'all' ? 'active' : ''}" data-cat="all">전체<span class="n">${state.items.length}</span></button>
      ${SLOTS.map(s => `<button class="chip ${cat === s.key ? 'active' : ''}" data-cat="${s.key}">${s.emoji} ${s.label}<span class="n">${counts[s.key] || 0}</span></button>`).join('')}
    </div>
    ${state.items.length === 0 ? `
      <div class="empty"><div class="big">🧺</div>
        <p><b>아직 옷장이 비어 있어요</b></p>
        <p class="small">아래 <b>+ 옷 추가</b>를 눌러 집에 있는 옷 사진을 찍어 등록해 보세요.<br>단색 벽이나 바닥 위에 펼쳐 찍으면 배경이 깔끔하게 지워져요.</p>
      </div>` : list.length === 0 ? `<div class="empty"><div class="big">🔎</div><p>조건에 맞는 옷이 없어요</p></div>` : `
      <div class="grid">
        ${list.map(i => `
          <button class="item-card" data-id="${i.id}">
            <div class="thumb"><img src="${i.image}" alt="${esc(i.name)}" loading="lazy"></div>
            <div class="meta">
              <div class="name">${esc(i.name || SLOT[i.category]?.label)}</div>
              <div class="tags">${colorDot(i.color)} ${esc(SLOT[i.category]?.label || '')}${i.seasons?.length ? ' · ' + esc(i.seasons.join('/')) : ''}</div>
            </div>
          </button>`).join('')}
      </div>`}
    <button class="fab" id="add">+ 옷 추가</button>
  `;

  const qEl = $('#q', app);
  qEl.addEventListener('input', () => {
    state.closet.q = qEl.value;
    const pos = qEl.selectionStart;
    renderCloset(app);
    const n = $('#q', app); n.focus(); n.setSelectionRange(pos, pos);
  });
  $('#season', app).addEventListener('change', e => { state.closet.season = e.target.value; renderCloset(app); });
  $$('[data-cat]', app).forEach(b => b.addEventListener('click', () => { state.closet.cat = b.dataset.cat; renderCloset(app); }));
  $$('.item-card', app).forEach(b => b.addEventListener('click', () => openItemEditor(itemById(b.dataset.id))));
  $('#add', app).addEventListener('click', () => openItemEditor(null));
}

/* ---------- 옷 등록/수정 ---------- */

function openItemEditor(item) {
  const isNew = !item;
  const draft = item ? { ...item, seasons: [...(item.seasons || [])] } : {
    id: uid(), name: '', category: state.closet.cat !== 'all' ? state.closet.cat : 'top',
    color: '', seasons: [], brand: '', memo: '', image: '', createdAt: Date.now(),
  };
  let srcCanvas = null;          // 새로 고른 원본 사진
  let srcIsPng = false;
  let bgRemove = true, tol = 40;

  const root = $('#modal-root');
  root.innerHTML = `
  <div class="overlay">
    <div class="sheet" role="dialog" aria-modal="true" aria-label="옷 ${isNew ? '등록' : '수정'}">
      <h2>${isNew ? '👕 옷 등록하기' : '✏️ 옷 정보 수정'}</h2>
      <label class="photo-box" for="photo">
        ${draft.image ? `<img id="preview" src="${draft.image}" alt="">` : `<div class="ph" id="ph">📷<br>눌러서 사진 찍기 / 앨범에서 선택</div><img id="preview" alt="" hidden>`}
      </label>
      <input type="file" id="photo" accept="image/*" hidden>
      <div id="bg-tools" hidden class="card" style="margin-bottom:12px">
        <label class="row small"><input type="checkbox" id="bg-on" checked> <b>배경 자동 지우기</b> <span class="muted">(아바타에 자연스럽게 입혀져요)</span></label>
        <label class="row small" style="margin-top:8px">지우는 정도 <input type="range" id="bg-tol" min="10" max="120" value="${tol}" class="grow"></label>
      </div>
      <div class="field"><span>이름</span><input class="input" id="name" placeholder="예) 흰색 옥스포드 셔츠" value="${esc(draft.name)}"></div>
      <div class="field"><span>종류</span>
        <div class="chips" id="cat">${SLOTS.map(s => `<button type="button" class="chip ${draft.category === s.key ? 'active' : ''}" data-v="${s.key}">${s.emoji} ${s.label}</button>`).join('')}</div>
      </div>
      <div class="field"><span>색상</span>
        <div class="check-row" id="color">${COLORS.map(c => `<button type="button" title="${c.name}" aria-label="${c.name}" class="color-opt ${c.hex === 'multi' ? 'multi' : ''} ${draft.color === c.name ? 'active' : ''}" data-v="${c.name}" style="${c.hex !== 'multi' ? `background:${c.hex}` : ''}"></button>`).join('')}</div>
      </div>
      <div class="field"><span>계절 <small class="muted">(선택 안 하면 사계절)</small></span>
        <div class="check-row" id="seasons">${SEASONS.map(s => `<button type="button" class="chip ${draft.seasons.includes(s) ? 'active' : ''}" data-v="${s}">${s}</button>`).join('')}</div>
      </div>
      <div class="field"><span>브랜드</span><input class="input" id="brand" value="${esc(draft.brand)}" placeholder="선택"></div>
      <div class="field"><span>메모</span><textarea class="input" id="memo" placeholder="구매처, 사이즈, 세탁 방법 등">${esc(draft.memo)}</textarea></div>
      ${!isNew && item.lastWorn ? `<p class="small muted">마지막으로 입은 날: ${fmtDate(item.lastWorn)} · 총 ${item.wearCount || 0}회 착용</p>` : ''}
      <div class="sheet-actions">
        ${!isNew ? '<button class="btn danger" id="del">삭제</button>' : ''}
        <button class="btn" id="cancel">취소</button>
        <button class="btn primary" id="save">${isNew ? '등록' : '저장'}</button>
      </div>
    </div>
  </div>`;

  const close = () => { root.innerHTML = ''; };
  const preview = $('#preview', root);

  let pending = 0;
  async function refreshPreview() {
    if (!srcCanvas) return;
    const my = ++pending;
    await new Promise(r => setTimeout(r, 30));
    if (my !== pending) return;
    const out = bgRemove ? removeBackground(srcCanvas, tol) : srcCanvas;
    draft.image = (bgRemove || srcIsPng) ? out.toDataURL('image/png') : out.toDataURL('image/jpeg', 0.86);
    preview.src = draft.image;
    preview.hidden = false;
    $('#ph', root)?.remove();
  }

  $('#photo', root).addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      srcCanvas = await fileToCanvas(f);
      srcIsPng = /png|webp/.test(f.type);
      $('#bg-tools', root).hidden = false;
      await refreshPreview();
    } catch (err) { toast(err.message); }
  });
  $('#bg-on', root).addEventListener('change', e => { bgRemove = e.target.checked; refreshPreview(); });
  $('#bg-tol', root).addEventListener('input', e => { tol = +e.target.value; refreshPreview(); });

  $$('#cat .chip', root).forEach(b => b.addEventListener('click', () => {
    draft.category = b.dataset.v;
    $$('#cat .chip', root).forEach(x => x.classList.toggle('active', x === b));
  }));
  $$('#color .color-opt', root).forEach(b => b.addEventListener('click', () => {
    draft.color = draft.color === b.dataset.v ? '' : b.dataset.v;
    $$('#color .color-opt', root).forEach(x => x.classList.toggle('active', x.dataset.v === draft.color));
  }));
  $$('#seasons .chip', root).forEach(b => b.addEventListener('click', () => {
    const v = b.dataset.v;
    draft.seasons = draft.seasons.includes(v) ? draft.seasons.filter(s => s !== v) : [...draft.seasons, v];
    b.classList.toggle('active');
  }));

  $('.overlay', root).addEventListener('click', e => { if (e.target.classList.contains('overlay')) close(); });
  $('#cancel', root).addEventListener('click', close);
  $('#del', root)?.addEventListener('click', async () => {
    if (!confirm('이 옷을 옷장에서 삭제할까요?')) return;
    await DB.del('items', draft.id);
    state.items = state.items.filter(i => i.id !== draft.id);
    for (const k of Object.keys(state.fit.slots)) if (state.fit.slots[k].itemId === draft.id) delete state.fit.slots[k];
    close(); toast('삭제했어요'); render();
  });
  $('#save', root).addEventListener('click', async () => {
    if (!draft.image) { toast('사진을 먼저 추가해 주세요'); return; }
    draft.name = $('#name', root).value.trim();
    draft.brand = $('#brand', root).value.trim();
    draft.memo = $('#memo', root).value.trim();
    if (!draft.name) draft.name = [draft.color, SLOT[draft.category].label].filter(Boolean).join(' ');
    await DB.put('items', draft);
    const idx = state.items.findIndex(i => i.id === draft.id);
    if (idx >= 0) state.items[idx] = draft; else state.items.push(draft);
    close(); toast(isNew ? '옷장에 등록했어요 👏' : '저장했어요'); render();
  });
}

/* ---------- 피팅룸 ---------- */

function wear(slotKey, itemId) {
  const slots = state.fit.slots;
  if (slots[slotKey]?.itemId === itemId) { delete slots[slotKey]; if (state.fit.selected === slotKey) state.fit.selected = null; return; }
  slots[slotKey] = { itemId, dx: 0, dy: 0, s: 1, r: 0 };
  if (slotKey === 'dress') { delete slots.top; delete slots.bottom; }
  if (slotKey === 'top' || slotKey === 'bottom') delete slots.dress;
  state.fit.selected = slotKey;
}

function randomOutfit() {
  const season = currentSeason();
  const pool = key => state.items.filter(i => i.category === key && (!i.seasons?.length || i.seasons.includes(season)));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const slots = {};
  const put = (key, chance = 1) => { const p = pool(key); if (p.length && Math.random() < chance) slots[key] = { itemId: pick(p).id, dx: 0, dy: 0, s: 1, r: 0 }; };
  const dresses = pool('dress'), canTB = pool('top').length || pool('bottom').length;
  if (dresses.length && (!canTB || Math.random() < 0.3)) put('dress'); else { put('top'); put('bottom'); }
  put('outer', season === '겨울' ? 0.9 : season === '여름' ? 0.1 : 0.5);
  put('shoes'); put('bag', 0.5); put('hat', 0.3); put('accessory', 0.4);
  if (!Object.keys(slots).length) { toast('옷장에 옷을 먼저 등록해 주세요'); return; }
  state.fit.slots = slots;
  state.fit.selected = null;
  state.fit.outfitId = null;
  state.fit.outfitName = '';
  toast(`🎲 ${season} 코디를 골라봤어요`);
}

function renderFitting(app) {
  const f = state.fit;
  const catItems = state.items.filter(i => i.category === f.cat).sort((a, b) => b.createdAt - a.createdAt);
  const sel = f.selected && f.slots[f.selected];
  const wearingKeys = Z_ORDER.filter(k => f.slots[k] && itemById(f.slots[k].itemId));

  app.innerHTML = `
  <div class="fitting">
    <div>
      <div class="stage" id="stage">
        ${avatarSVG(f.slots, { interactive: true, selected: f.selected, id: 'avatar' })}
        <div class="hint">${wearingKeys.length ? '옷을 끌어서 위치를 맞춰요' : '아래에서 옷을 골라 입혀보세요'}</div>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn" id="random">🎲 랜덤 코디</button>
        <button class="btn" id="clear" ${wearingKeys.length ? '' : 'disabled'}>🧹 다 벗기</button>
        <span class="grow"></span>
        <button class="btn primary" id="save" ${wearingKeys.length ? '' : 'disabled'}>💾 코디 저장</button>
      </div>
    </div>
    <div>
      ${wearingKeys.length ? `<div class="section-title" style="margin-top:0">입고 있는 옷</div>
      <div class="wearing">${wearingKeys.map(k => `<button class="w" data-sel="${k}" style="${f.selected === k ? 'outline:2px solid var(--accent)' : ''}">${SLOT[k].emoji} <b>${esc(itemById(f.slots[k].itemId).name)}</b><span class="x" data-off="${k}" aria-label="벗기">✕</span></button>`).join('')}</div>` : ''}
      ${sel ? `
      <div class="card layer-panel" style="margin-top:10px">
        <div class="row"><b class="grow">${SLOT[f.selected].emoji} ${SLOT[f.selected].label} 조정</b>
          <button class="btn sm" id="reset">위치 초기화</button></div>
        <label>크기 <input type="range" id="sz" min="0.4" max="2" step="0.02" value="${sel.s}"><span id="sz-v">${Math.round(sel.s * 100)}%</span></label>
        <label>회전 <input type="range" id="rot" min="-45" max="45" step="1" value="${sel.r}"><span id="rot-v">${sel.r}°</span></label>
      </div>` : ''}
      <div class="section-title">옷 고르기</div>
      <div class="chips">${SLOTS.map(s => `<button class="chip ${f.cat === s.key ? 'active' : ''}" data-cat="${s.key}">${s.emoji} ${s.label}</button>`).join('')}</div>
      ${catItems.length ? `<div class="strip">${catItems.map(i => `
        <button class="s-item ${f.slots[f.cat]?.itemId === i.id ? 'on' : ''}" data-id="${i.id}" title="${esc(i.name)}"><img src="${i.image}" alt="${esc(i.name)}"></button>`).join('')}</div>`
        : `<p class="small muted">이 종류의 옷이 아직 없어요. <a href="#" id="go-closet">옷장에서 등록하기 →</a></p>`}
    </div>
  </div>`;

  $$('[data-cat]', app).forEach(b => b.addEventListener('click', () => { f.cat = b.dataset.cat; renderFitting(app); }));
  $$('.s-item', app).forEach(b => b.addEventListener('click', () => { wear(f.cat, b.dataset.id); renderFitting(app); }));
  $$('[data-sel]', app).forEach(b => b.addEventListener('click', e => {
    const off = e.target.closest('[data-off]');
    if (off) { delete f.slots[off.dataset.off]; if (f.selected === off.dataset.off) f.selected = null; }
    else { f.selected = b.dataset.sel; f.cat = b.dataset.sel; }
    renderFitting(app);
  }));
  $('#go-closet', app)?.addEventListener('click', e => { e.preventDefault(); state.closet.cat = f.cat; go('closet'); });
  $('#random', app).addEventListener('click', () => { randomOutfit(); render(); });
  $('#clear', app).addEventListener('click', () => { f.slots = {}; f.selected = null; f.outfitId = null; f.outfitName = ''; render(); });
  $('#save', app).addEventListener('click', saveOutfit);

  if (sel) {
    const layerEl = () => $(`#avatar [data-slot="${f.selected}"]`, app);
    $('#sz', app).addEventListener('input', e => {
      sel.s = +e.target.value; $('#sz-v', app).textContent = Math.round(sel.s * 100) + '%';
      layerEl()?.setAttribute('transform', layerTransform(f.selected, sel));
    });
    $('#rot', app).addEventListener('input', e => {
      sel.r = +e.target.value; $('#rot-v', app).textContent = sel.r + '°';
      layerEl()?.setAttribute('transform', layerTransform(f.selected, sel));
    });
    $('#reset', app).addEventListener('click', () => { Object.assign(sel, { dx: 0, dy: 0, s: 1, r: 0 }); renderFitting(app); });
  }

  setupDrag(app);
}

function setupDrag(app) {
  const svg = $('#avatar', app);
  const f = state.fit;
  let drag = null;
  const toSvg = e => {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };
  svg.addEventListener('pointerdown', e => {
    const g = e.target.closest('.layer');
    if (!g) {
      if (f.selected) { f.selected = null; renderFitting(app); }
      return;
    }
    const key = g.dataset.slot;
    const t = f.slots[key];
    const p = toSvg(e);
    drag = { key, g, t, x0: p.x, y0: p.y, dx0: t.dx, dy0: t.dy, moved: false, id: e.pointerId };
    svg.setPointerCapture(e.pointerId);
    $$('.layer', svg).forEach(l => l.classList.toggle('selected', l === g));
  });
  svg.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = toSvg(e);
    drag.t.dx = clamp(drag.dx0 + p.x - drag.x0, -200, 200);
    drag.t.dy = clamp(drag.dy0 + p.y - drag.y0, -300, 300);
    if (Math.abs(p.x - drag.x0) + Math.abs(p.y - drag.y0) > 2) drag.moved = true;
    drag.g.setAttribute('transform', layerTransform(drag.key, drag.t));
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const key = drag.key;
    drag = null;
    if (f.selected !== key) { f.selected = key; f.cat = key; renderFitting(app); }
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
}

async function saveOutfit() {
  const f = state.fit;
  const existing = f.outfitId && state.outfits.find(o => o.id === f.outfitId);
  let asNew = true;
  if (existing) asNew = !confirm(`「${existing.name}」 코디를 덮어쓸까요?\n(취소를 누르면 새 코디로 저장해요)`);
  let name = existing && !asNew ? existing.name : prompt('코디 이름을 지어주세요', `${currentSeason()} 코디 ${state.outfits.length + 1}`);
  if (name === null) return;
  name = name.trim() || '이름 없는 코디';
  const outfit = existing && !asNew
    ? { ...existing, name, slots: structuredClone(f.slots), updatedAt: Date.now() }
    : { id: uid(), name, slots: structuredClone(f.slots), createdAt: Date.now(), wornDates: [] };
  await DB.put('outfits', outfit);
  const idx = state.outfits.findIndex(o => o.id === outfit.id);
  if (idx >= 0) state.outfits[idx] = outfit; else state.outfits.push(outfit);
  f.outfitId = outfit.id; f.outfitName = outfit.name;
  toast('코디북에 저장했어요 ✨');
  render();
}

/* ---------- 코디북 ---------- */

function renderOutfits(app) {
  const list = [...state.outfits].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  if (!list.length) {
    app.innerHTML = `<div class="empty"><div class="big">✨</div><p><b>저장된 코디가 없어요</b></p>
      <p class="small">피팅룸에서 아바타에 옷을 입혀보고 <b>코디 저장</b>을 눌러보세요.</p>
      <button class="btn primary" id="go-fit">피팅룸 가기</button></div>`;
    $('#go-fit', app).addEventListener('click', () => go('fitting'));
    return;
  }
  app.innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">
    ${list.map(o => {
      const names = Z_ORDER.filter(k => o.slots[k] && itemById(o.slots[k].itemId)).map(k => itemById(o.slots[k].itemId).name);
      const last = o.wornDates?.length ? o.wornDates[o.wornDates.length - 1] : null;
      return `<div class="outfit-card">
        <div class="mini">${avatarSVG(o.slots)}</div>
        <div class="meta">
          <div class="name">${esc(o.name)}</div>
          <div class="small muted">${esc(names.join(', ') || '옷이 삭제되었어요')}</div>
          <div class="small muted">${last ? `마지막 착용 ${fmtDate(last)} · ${o.wornDates.length}회` : `저장 ${fmtDate(o.createdAt)}`}</div>
          <div class="actions">
            <button class="btn sm primary" data-load="${o.id}">입혀보기</button>
            <button class="btn sm" data-worn="${o.id}">오늘 입음</button>
            <button class="btn sm danger" data-del="${o.id}">삭제</button>
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`;

  $$('[data-load]', app).forEach(b => b.addEventListener('click', () => {
    const o = state.outfits.find(x => x.id === b.dataset.load);
    state.fit.slots = structuredClone(o.slots);
    for (const k of Object.keys(state.fit.slots)) if (!itemById(state.fit.slots[k].itemId)) delete state.fit.slots[k];
    state.fit.selected = null; state.fit.outfitId = o.id; state.fit.outfitName = o.name;
    go('fitting');
  }));
  $$('[data-worn]', app).forEach(b => b.addEventListener('click', async () => {
    const o = state.outfits.find(x => x.id === b.dataset.worn);
    const now = Date.now();
    o.wornDates = [...(o.wornDates || []), now];
    await DB.put('outfits', o);
    for (const t of Object.values(o.slots)) {
      const it = itemById(t.itemId);
      if (it) { it.lastWorn = now; it.wearCount = (it.wearCount || 0) + 1; await DB.put('items', it); }
    }
    toast('오늘의 코디로 기록했어요 📅'); render();
  }));
  $$('[data-del]', app).forEach(b => b.addEventListener('click', async () => {
    if (!confirm('이 코디를 삭제할까요? (옷은 옷장에 그대로 남아요)')) return;
    await DB.del('outfits', b.dataset.del);
    state.outfits = state.outfits.filter(o => o.id !== b.dataset.del);
    if (state.fit.outfitId === b.dataset.del) { state.fit.outfitId = null; state.fit.outfitName = ''; }
    render();
  }));
}

/* ---------- 설정 ---------- */

function renderSettings(app) {
  const a = state.avatar;
  const unworn = state.items.filter(i => !i.lastWorn).length;
  app.innerHTML = `
  <div class="settings-grid">
    <div class="card avatar-preview">${avatarSVG({})}</div>
    <div class="card">
      <div class="section-title" style="margin-top:0">🧍 아바타 꾸미기</div>
      <div class="field"><span>피부색</span><div class="swatches">${SKINS.map(c => `<button class="swatch ${a.skin === c ? 'active' : ''}" data-skin="${c}" style="background:${c}" aria-label="피부색"></button>`).join('')}</div></div>
      <div class="field"><span>헤어스타일</span><div class="chips">${HAIR_STYLES.map(h => `<button class="chip ${a.hair === h.key ? 'active' : ''}" data-hair="${h.key}">${h.label}</button>`).join('')}</div></div>
      <div class="field"><span>머리색</span><div class="swatches">${HAIR_COLORS.map(c => `<button class="swatch ${a.hairColor === c ? 'active' : ''}" data-hc="${c}" style="background:${c}" aria-label="머리색"></button>`).join('')}</div></div>
      <div class="field"><span>체형</span><div class="chips">${BODY_TYPES.map(b => `<button class="chip ${a.body === b.key ? 'active' : ''}" data-body="${b.key}">${b.label}</button>`).join('')}</div></div>
    </div>
  </div>

  <div class="card" style="margin-top:14px">
    <div class="section-title" style="margin-top:0">📊 옷장 통계</div>
    <p class="small">옷 <b>${state.items.length}</b>벌 · 코디 <b>${state.outfits.length}</b>개 · 한 번도 기록 안 된 옷 <b>${unworn}</b>벌</p>
    <div class="row small muted">${SLOTS.map(s => `${s.emoji} ${s.label} ${state.items.filter(i => i.category === s.key).length}`).join(' · ')}</div>
  </div>

  <div class="card" style="margin-top:14px">
    <div class="section-title" style="margin-top:0">💾 데이터</div>
    <p class="small muted">모든 옷 사진과 코디는 이 기기의 브라우저에만 저장돼요. 휴대폰을 바꾸거나 브라우저 데이터를 지우기 전에 백업 파일로 내보내 두세요.</p>
    <div class="row">
      <button class="btn" id="export">⬇️ 백업 내보내기</button>
      <label class="btn">⬆️ 백업 불러오기<input type="file" id="import" accept="application/json,.json" hidden></label>
      <button class="btn danger" id="wipe">전체 삭제</button>
    </div>
  </div>`;

  const set = (k, v) => { a[k] = v; saveAvatar(); renderSettings(app); };
  $$('[data-skin]', app).forEach(b => b.addEventListener('click', () => set('skin', b.dataset.skin)));
  $$('[data-hc]', app).forEach(b => b.addEventListener('click', () => set('hairColor', b.dataset.hc)));
  $$('[data-hair]', app).forEach(b => b.addEventListener('click', () => set('hair', b.dataset.hair)));
  $$('[data-body]', app).forEach(b => b.addEventListener('click', () => set('body', b.dataset.body)));

  $('#export', app).addEventListener('click', () => {
    const data = { app: 'my-wardrobe', version: 1, exportedAt: Date.now(), avatar: state.avatar, items: state.items, outfits: state.outfits };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const link = Object.assign(document.createElement('a'), { href: url, download: `내옷장-백업-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json` });
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('#import', app).addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'my-wardrobe' || !Array.isArray(data.items)) throw new Error('내 옷장 백업 파일이 아니에요');
      for (const it of data.items) if (it && it.id && it.image && SLOT[it.category]) await DB.put('items', it);
      for (const o of data.outfits || []) if (o && o.id && o.slots) await DB.put('outfits', o);
      if (data.avatar) { state.avatar = { ...state.avatar, ...data.avatar }; saveAvatar(); }
      state.items = await DB.all('items');
      state.outfits = await DB.all('outfits');
      toast(`옷 ${data.items.length}벌, 코디 ${(data.outfits || []).length}개를 불러왔어요`);
      render();
    } catch (err) { toast('불러오기 실패: ' + err.message); }
  });
  $('#wipe', app).addEventListener('click', async () => {
    if (!confirm('정말 모든 옷과 코디를 삭제할까요? 되돌릴 수 없어요.')) return;
    await DB.clear('items'); await DB.clear('outfits');
    state.items = []; state.outfits = []; state.fit = { slots: {}, selected: null, cat: 'top', outfitId: null, outfitName: '' };
    toast('모두 삭제했어요'); render();
  });
}

/* ---------- 시작 ---------- */

async function init() {
  $$('.tabbar button').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
  try {
    await DB.open();
    [state.items, state.outfits] = await Promise.all([DB.all('items'), DB.all('outfits')]);
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  } catch (err) {
    $('#app').innerHTML = `<div class="empty"><div class="big">⚠️</div><p>저장소를 열 수 없어요. 사생활 보호(시크릿) 모드에서는 동작하지 않을 수 있어요.</p></div>`;
    return;
  }
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
init();
