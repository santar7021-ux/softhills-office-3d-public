/* 3D 자리 배치도 — Three.js 렌더러 (아이소메트릭 돌하우스 스타일)
 * 데이터는 js/office_data.js 의 window.OFFICE_DATA 를 읽어서 그립니다.
 * 좌석 정보를 바꾸고 싶으면 office_data.js 만 수정하면 됩니다.
 */

const TEAM_LABEL = {
  mgmt: '경영지원',
  core: 'Core R&D',
  solution: 'Solution R&D',
  bizops: 'Business Operations',
  other: '기타',
};

const DATA = window.OFFICE_DATA;
const TEAM_COLOR = DATA.teamColors;

const DESK_TOP_H = 0.72;
const WOOD_TOP = 0xd9bd92;
const WOOD_TOP_EMPTY = 0xc3bdb0;
const LEG_DARK = 0x2e2e2e;
const CHAIR_SEAT = 0x33363c;
const MEETING_CHAIR = 0x5c8a5b;

let scene, camera, renderer, controls, raycaster, pointer;
const officeGroups = {}; // key -> THREE.Group
const seatHitboxes = {}; // key -> [mesh,...] (invisible pick targets)
let currentOffice = 'seoul';
let hoveredSeat = null;
let selectedSeat = null;
let highlightRing;
let currentHalfH = 12;
const ISO_DIR = new THREE.Vector3(1, 1.55, 1).normalize();
const texLoader = new THREE.TextureLoader();
const avatarBillboards = [];

function init() {
  const wrap = document.getElementById('canvas-wrap');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x44484f);
  scene.fog = new THREE.Fog(0x44484f, 50, 110);

  camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 500);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputEncoding = THREE.sRGBEncoding;
  wrap.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.minZoom = 0.4;
  controls.maxZoom = 6;
  controls.enablePan = true;

  const hemi = new THREE.HemisphereLight(0xeef2f6, 0x2b2d33, 0.85);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xfff6e8, 0.85);
  dir.position.set(22, 34, 16);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.camera.left = -40;
  dir.shadow.camera.right = 40;
  dir.shadow.camera.top = 40;
  dir.shadow.camera.bottom = -40;
  scene.add(dir);
  scene.add(new THREE.AmbientLight(0xffffff, 0.3));

  // selection ring (shared across offices)
  const ringGeo = new THREE.PlaneGeometry(1, 1);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x3b6f91, transparent: true, opacity: 0.28, side: THREE.DoubleSide });
  highlightRing = new THREE.Mesh(ringGeo, ringMat);
  highlightRing.rotation.x = -Math.PI / 2;
  highlightRing.visible = false;
  scene.add(highlightRing);

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();

  Object.keys(DATA.offices).forEach(buildOffice);

  setActiveOffice('seoul', true);

  window.addEventListener('resize', onResize);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerleave', () => setTooltip(null));
  renderer.domElement.addEventListener('click', onClick);

  document.getElementById('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    setActiveOffice(btn.dataset.office, true);
  });

  document.getElementById('reset-view').addEventListener('click', () => frameOffice(currentOffice));

  document.getElementById('roster-search').addEventListener('input', (e) => {
    renderRoster(currentOffice, e.target.value.trim());
  });

  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const root = document.documentElement;
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('sh-theme', next); } catch (e) {}
      themeBtn.textContent = next === 'dark' ? '라이트 모드' : '다크 모드';
    });
  }
}

/* ---------------- textures ---------------- */

function makeWoodTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const planks = 8;
  const plankH = canvas.height / planks;
  for (let i = 0; i < planks; i++) {
    const base = 205 + Math.sin(i * 1.7) * 10;
    ctx.fillStyle = `rgb(${base}, ${base - 28}, ${base - 65})`;
    ctx.fillRect(0, i * plankH, canvas.width, plankH);
    ctx.strokeStyle = 'rgba(70,48,24,0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, i * plankH, canvas.width, plankH);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let g = 0; g < 6; g++) {
      const y = i * plankH + Math.random() * plankH;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y + (Math.random() - 0.5) * 4);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeBlindTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const stripes = 10;
  const h = canvas.height / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#e4e2dc' : '#cfccc4';
    ctx.fillRect(0, i * h, canvas.width, h);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, i * h + h - 3, canvas.width, 3);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

const WOOD_TEX = makeWoodTexture();

function makeLabelSprite(text, { fontSize = 42, color = '#fdfaf4', bg = 'rgba(32,28,22,0.74)', weight = 600 } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${weight} ${fontSize}px "Apple SD Gothic Neo","Malgun Gothic",sans-serif`;
  const padX = 22;
  const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
  const h = fontSize + 24;
  canvas.width = w;
  canvas.height = h;
  ctx.font = `${weight} ${fontSize}px "Apple SD Gothic Neo","Malgun Gothic",sans-serif`;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  const scale = 0.0105;
  sprite.scale.set(w * scale, h * scale, 1);
  return sprite;
}

/* ---------------- furniture builders ---------------- */

function buildDesk(seat) {
  const group = new THREE.Group();
  const deskW = seat.w * 0.8;
  const deskD = seat.d * 0.8;
  const occupied = seat.occupied;

  const topMat = new THREE.MeshStandardMaterial({
    color: occupied ? WOOD_TOP : WOOD_TOP_EMPTY,
    roughness: 0.55,
    transparent: !occupied,
    opacity: occupied ? 1 : 0.55,
  });
  const top = new THREE.Mesh(new THREE.BoxGeometry(deskW, 0.05, deskD), topMat);
  top.position.y = DESK_TOP_H;
  top.castShadow = true;
  top.receiveShadow = true;
  group.add(top);

  const legMat = new THREE.MeshStandardMaterial({ color: LEG_DARK, roughness: 0.4, metalness: 0.3 });
  const legGeo = new THREE.CylinderGeometry(0.022, 0.022, DESK_TOP_H - 0.02, 8);
  const insetX = deskW / 2 - 0.08;
  const insetZ = deskD / 2 - 0.08;
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(sx * insetX, (DESK_TOP_H - 0.02) / 2, sz * insetZ);
    leg.castShadow = true;
    group.add(leg);
  });

  // floor accent strip (team identification, subtle)
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(TEAM_COLOR[seat.team] || TEAM_COLOR.other), roughness: 0.8 });
  const accent = new THREE.Mesh(new THREE.BoxGeometry(deskW * 0.6, 0.012, 0.09), accentMat);
  accent.position.set(0, 0.007, deskD / 2 + 0.07);
  group.add(accent);

  if (occupied) {
    const monW = deskW * 0.32;
    const monH = 0.24;
    const monMat = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.3 });
    const monitor = new THREE.Mesh(new THREE.BoxGeometry(monW, monH, 0.02), monMat);
    monitor.position.set(0, DESK_TOP_H + 0.025 + monH / 2, -deskD / 2 + 0.06);
    monitor.castShadow = true;
    group.add(monitor);

    const standMat = new THREE.MeshStandardMaterial({ color: 0x3a3d44 });
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.05), standMat);
    stand.position.set(0, DESK_TOP_H + 0.025 + 0.03, -deskD / 2 + 0.06);
    group.add(stand);

    const kbMat = new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.6 });
    const kb = new THREE.Mesh(new THREE.BoxGeometry(deskW * 0.4, 0.012, deskD * 0.16), kbMat);
    kb.position.set(0, DESK_TOP_H + 0.025 + 0.006, -0.02);
    group.add(kb);
  }

  group.userData = { deskW, deskD };
  return group;
}

function buildAvatar(seat) {
  const group = new THREE.Group();
  const teamColor = new THREE.Color(TEAM_COLOR[seat.team] || TEAM_COLOR.other);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.345, 28),
    new THREE.MeshBasicMaterial({ color: teamColor, side: THREE.DoubleSide, toneMapped: false })
  );
  group.add(ring);

  const photoPath = window.PHOTO_MAP && window.PHOTO_MAP[seat.name];
  let circleMat;
  if (photoPath) {
    const tex = texLoader.load(photoPath);
    tex.encoding = THREE.sRGBEncoding;
    circleMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  } else {
    circleMat = new THREE.MeshBasicMaterial({ color: teamColor.clone().multiplyScalar(0.85), toneMapped: false });
  }
  const circle = new THREE.Mesh(new THREE.CircleGeometry(0.29, 28), circleMat);
  circle.position.z = 0.001;
  group.add(circle);

  avatarBillboards.push(group);
  return group;
}

function buildChair(backColor, radius = 0.26, facing = 1) {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.5, metalness: 0.4 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.62, radius * 0.7, 0.04, 16), baseMat);
  base.position.y = 0.02;
  group.add(base);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.32, 8), baseMat);
  pole.position.y = 0.02 + 0.16;
  group.add(pole);

  const seatMat = new THREE.MeshStandardMaterial({ color: CHAIR_SEAT, roughness: 0.65 });
  const seatPad = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.95, 0.07, 16), seatMat);
  seatPad.position.y = 0.02 + 0.32 + 0.03;
  seatPad.castShadow = true;
  group.add(seatPad);

  const backMat = new THREE.MeshStandardMaterial({ color: backColor, roughness: 0.6 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(radius * 1.65, 0.34, 0.035), backMat);
  back.position.set(0, 0.02 + 0.32 + 0.03 + 0.22, -facing * radius * 0.8);
  back.rotation.x = facing * 0.14;
  back.castShadow = true;
  group.add(back);

  return group;
}

function buildOffice(key) {
  const office = DATA.offices[key];
  const group = new THREE.Group();
  group.visible = false;
  const cx = office.floor.w / 2;
  const cz = office.floor.d / 2;
  group.userData.center = { x: cx, z: cz };
  group.userData.size = { w: office.floor.w, d: office.floor.d };

  // floor
  const floorTex = WOOD_TEX.clone();
  floorTex.needsUpdate = true;
  floorTex.repeat.set(office.floor.w / 1.1, office.floor.d / 1.1);
  const floorGeo = new THREE.BoxGeometry(office.floor.w, 0.2, office.floor.d);
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.82 });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.position.set(cx, -0.1, cz);
  floorMesh.receiveShadow = true;
  group.add(floorMesh);

  // perimeter walls (textured, with a gap as an entrance opening)
  const wallH = 2.1;
  const wallThickness = 0.14;
  const gap = Math.min(office.floor.w, office.floor.d) * 0.2;

  function addWallSegment(x1, z1, x2, z2) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.05) return;
    const tex = makeBlindTexture();
    tex.repeat.set(Math.max(1, Math.round(len)), 1);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
    const geo = new THREE.BoxGeometry(len, wallH, wallThickness);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((x1 + x2) / 2, wallH / 2, (z1 + z2) / 2);
    mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const w = office.floor.w, d = office.floor.d;
  addWallSegment(0, 0, w, 0);
  addWallSegment(0, 0, 0, d);
  addWallSegment(w, 0, w, d);
  const frontMid = w / 2;
  addWallSegment(0, d, frontMid - gap / 2, d);
  addWallSegment(frontMid + gap / 2, d, w, d);

  // rooms (meeting rooms, pillar, etc.)
  (office.rooms || []).forEach((room) => {
    if (room.type === 'pillar') {
      const r = Math.min(room.w, room.d) / 2;
      const geo = new THREE.CylinderGeometry(r, r, wallH + 0.4, 24);
      const mat = new THREE.MeshStandardMaterial({ color: 0xcac6bc, roughness: 0.7 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(room.x + room.w / 2, (wallH + 0.4) / 2, room.z + room.d / 2);
      mesh.castShadow = true;
      group.add(mesh);
      const label = makeLabelSprite(room.label, { fontSize: 30, color: '#f4f1ea', bg: 'rgba(40,40,40,0.55)' });
      label.position.set(room.x + room.w / 2, wallH + 0.7, room.z + room.d / 2);
      group.add(label);
    } else {
      const wallGeo = new THREE.BoxGeometry(room.w, 1.85, room.d);
      const edges = new THREE.EdgesGeometry(wallGeo);
      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2e4a5e }));
      line.position.set(room.x + room.w / 2, 0.95, room.z + room.d / 2);
      group.add(line);
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x7fb3e0, transparent: true, opacity: 0.16, roughness: 0.15 });
      const glass = new THREE.Mesh(wallGeo, glassMat);
      glass.position.copy(line.position);
      group.add(glass);

      // mid-height frame rail
      const railMat = new THREE.MeshStandardMaterial({ color: 0x24323c });
      const railGeoH = new THREE.BoxGeometry(room.w, 0.05, 0.03);
      [room.z, room.z + room.d].forEach((zz) => {
        const rail = new THREE.Mesh(railGeoH, railMat);
        rail.position.set(room.x + room.w / 2, 0.95, zz);
        group.add(rail);
      });

      // meeting table
      const tableGeo = new THREE.BoxGeometry(room.w * 0.55, 0.72, room.d * 0.4);
      const tableMat = new THREE.MeshStandardMaterial({ color: 0x8a6b4a, roughness: 0.5 });
      const table = new THREE.Mesh(tableGeo, tableMat);
      table.position.set(room.x + room.w / 2, 0.36, room.z + room.d / 2);
      table.castShadow = true;
      group.add(table);

      // a few meeting chairs around the table
      const tcx = room.x + room.w / 2;
      const tcz = room.z + room.d / 2;
      const half = (room.w * 0.55) / 2;
      [-1, 1].forEach((side) => {
        const chair = buildChair(MEETING_CHAIR, 0.22, side);
        chair.position.set(tcx + side * (half + 0.3), 0, tcz);
        chair.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        group.add(chair);
      });

      const label = makeLabelSprite(room.label, { fontSize: 32, color: '#eaf3fb', bg: 'rgba(30,50,65,0.6)' });
      label.position.set(room.x + room.w / 2, 2.2, room.z + room.d / 2);
      group.add(label);
    }
  });

  // zone labels (floating overhead team markers) — Seoul only
  (office.zones || []).forEach((zone) => {
    const label = makeLabelSprite(zone.label, { fontSize: 28, color: '#f1efe9', bg: 'rgba(40,38,34,0.5)' });
    label.position.set(zone.x, 3.1, zone.z);
    group.add(label);
  });

  // ambient decor: a reception counter + plants for the flagship (largest) office only
  if (key === 'seoul') {
    const deskMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.4 });
    const topMat2 = new THREE.MeshStandardMaterial({ color: 0x2b2d33, roughness: 0.3 });
    const reception = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.95, 0.6), deskMat);
    body.position.y = 0.475;
    body.castShadow = true;
    reception.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.05, 0.7), topMat2);
    top.position.y = 0.975;
    reception.add(top);
    reception.position.set(frontMid, 0, d - 1.6);
    group.add(reception);
  }

  addPlant(group, w * 0.04, d * 0.05);
  addPlant(group, w * 0.96, d * 0.95);

  // seats
  const hitboxes = [];
  (office.seats || []).forEach((seat) => {
    const desk = buildDesk(seat);
    desk.position.set(seat.x, 0, seat.z);
    group.add(desk);

    if (seat.occupied) {
      const chairColor = new THREE.Color(TEAM_COLOR[seat.team] || TEAM_COLOR.other);
      const chair = buildChair(chairColor, Math.min(seat.w, seat.d) * 0.3);
      chair.position.set(seat.x, 0, seat.z + seat.d * 0.8 / 2 + 0.34);
      chair.castShadow = true;
      group.add(chair);

      const nameTag = makeLabelSprite(`${seat.name}`);
      nameTag.position.set(seat.x, 1.45, seat.z);
      group.add(nameTag);

      const avatar = buildAvatar(seat);
      avatar.position.set(seat.x, 2.05, seat.z);
      group.add(avatar);
    }

    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(seat.w, 1.4, seat.d),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.set(seat.x, 0.7, seat.z);
    hit.userData = { seat, office: key };
    group.add(hit);
    hitboxes.push(hit);
  });

  seatHitboxes[key] = hitboxes;
  officeGroups[key] = group;
  scene.add(group);
}

function addPlant(group, x, z) {
  const potMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.7 });
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.3, 12), potMat);
  pot.position.set(x, 0.15, z);
  pot.castShadow = true;
  group.add(pot);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4f7a4a, roughness: 0.8 });
  const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), leafMat);
  leaves.position.set(x, 0.68, z);
  leaves.scale.set(1, 1.3, 1);
  leaves.castShadow = true;
  group.add(leaves);
}

/* ---------------- camera / navigation ---------------- */

function setOrthoFrustum(halfH) {
  const wrap = document.getElementById('canvas-wrap');
  const aspect = wrap.clientWidth / wrap.clientHeight;
  const halfW = halfH * aspect;
  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();
}

function frameOffice(key) {
  const group = officeGroups[key];
  const { w, d } = group.userData.size;
  const { x: cx, z: cz } = group.userData.center;
  const maxDim = Math.max(w, d);
  const target = new THREE.Vector3(cx, 0.3, cz);
  camera.position.copy(target).addScaledVector(ISO_DIR, maxDim * 1.8);
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  currentHalfH = maxDim * 0.64;
  setOrthoFrustum(currentHalfH);
  controls.target.copy(target);
  controls.update();
  highlightRing.visible = false;
  selectedSeat = null;
}

function setActiveOffice(key, resetCamera) {
  currentOffice = key;
  Object.keys(officeGroups).forEach((k) => (officeGroups[k].visible = k === key));
  const office = DATA.offices[key];
  document.getElementById('office-address').textContent = `${office.name} · ${office.address}`;
  document.getElementById('roster-title').textContent = `${office.name} 인원 현황`;
  renderLegend();
  renderRoster(key, '');
  if (resetCamera) frameOffice(key);
}

function renderLegend() {
  const legend = document.getElementById('legend');
  legend.innerHTML = '';
  Object.keys(TEAM_LABEL).forEach((teamKey) => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<span class="legend-dot" style="background:${TEAM_COLOR[teamKey]}"></span>${TEAM_LABEL[teamKey]}`;
    legend.appendChild(item);
  });
}

function renderRoster(key, filter) {
  const list = document.getElementById('roster-list');
  list.innerHTML = '';
  const seats = DATA.offices[key].seats.filter((s) => s.occupied);
  const filtered = filter
    ? seats.filter((s) => s.name.includes(filter) || (s.title || '').includes(filter))
    : seats;

  if (!filtered.length) {
    list.innerHTML = '<li class="roster-empty">검색 결과가 없습니다.</li>';
    return;
  }

  filtered
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    .forEach((seat, i) => {
      const li = document.createElement('li');
      li.className = 'roster-item';
      li.innerHTML = `
        <span class="roster-idx">${String(i + 1).padStart(2, '0')}</span>
        <span class="roster-dot" style="background:${TEAM_COLOR[seat.team] || TEAM_COLOR.other}"></span>
        <span class="roster-text">
          <span class="roster-name">${seat.name}</span>
          <span class="roster-title">${seat.title || ''}</span>
        </span>`;
      li.addEventListener('click', () => focusSeat(key, seat));
      list.appendChild(li);
    });
}

function focusSeat(key, seat) {
  if (key !== currentOffice) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.office === key));
    setActiveOffice(key, false);
  }
  const target = new THREE.Vector3(seat.x, 0.4, seat.z);
  camera.position.copy(target).addScaledVector(ISO_DIR, 9);
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  currentHalfH = 3.4;
  setOrthoFrustum(currentHalfH);
  controls.target.copy(target);
  controls.update();

  selectHighlight(seat);
}

function selectHighlight(seat) {
  selectedSeat = seat;
  highlightRing.scale.set(seat.w * 0.85, seat.d * 0.85, 1);
  highlightRing.position.set(seat.x, 0.03, seat.z);
  highlightRing.visible = true;
}

function onResize() {
  const wrap = document.getElementById('canvas-wrap');
  setOrthoFrustum(currentHalfH);
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
}

function onPointerMove(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(seatHitboxes[currentOffice] || []);
  if (hits.length) {
    const seat = hits[0].object.userData.seat;
    hoveredSeat = seat;
    setTooltip(seat, e.clientX, e.clientY);
    renderer.domElement.style.cursor = 'pointer';
  } else {
    hoveredSeat = null;
    setTooltip(null);
    renderer.domElement.style.cursor = 'default';
  }
}

function onClick() {
  if (hoveredSeat && hoveredSeat.occupied) {
    selectHighlight(hoveredSeat);
  }
}

function setTooltip(seat, x, y) {
  const el = document.getElementById('tooltip');
  if (!seat) {
    el.classList.add('hidden');
    return;
  }
  const wrapRect = document.getElementById('canvas-wrap').getBoundingClientRect();
  el.style.left = `${x - wrapRect.left}px`;
  el.style.top = `${y - wrapRect.top}px`;
  if (seat.occupied) {
    el.innerHTML = `<div class="name">${seat.name}</div><div class="title">${seat.title || ''}</div><div class="team">${TEAM_LABEL[seat.team] || ''}</div>`;
  } else {
    el.innerHTML = `<div class="name">공석</div>`;
  }
  el.classList.remove('hidden');
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  for (let i = 0; i < avatarBillboards.length; i++) {
    avatarBillboards[i].quaternion.copy(camera.quaternion);
  }
  renderer.render(scene, camera);
}

init();
animate();
