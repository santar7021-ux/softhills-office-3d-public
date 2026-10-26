/* 3D 자리 배치도 — Three.js 렌더러
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

let scene, camera, renderer, controls, raycaster, pointer;
const officeGroups = {}; // key -> THREE.Group
const seatMeshes = {};   // key -> [mesh,...]
let currentOffice = 'seoul';
let hoveredMesh = null;
let selectedMesh = null;

init();
animate();

function init() {
  const wrap = document.getElementById('canvas-wrap');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0e12);
  scene.fog = new THREE.Fog(0x0c0e12, 40, 90);

  camera = new THREE.PerspectiveCamera(42, wrap.clientWidth / wrap.clientHeight, 0.1, 500);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputEncoding = THREE.sRGBEncoding;
  wrap.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.minDistance = 5;
  controls.maxDistance = 80;

  const hemi = new THREE.HemisphereLight(0xdfe6f0, 0x1a1d22, 0.55);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xfff2de, 0.65);
  dir.position.set(18, 28, 14);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.camera.left = -40;
  dir.shadow.camera.right = 40;
  dir.shadow.camera.top = 40;
  dir.shadow.camera.bottom = -40;
  scene.add(dir);
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));

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

  document.getElementById('reset-view').addEventListener('click', () => frameOffice(currentOffice, true));

  document.getElementById('roster-search').addEventListener('input', (e) => {
    renderRoster(currentOffice, e.target.value.trim());
  });
}

function makeLabelSprite(text, { fontSize = 46, color = '#e8eaed', bg = 'rgba(15,18,22,0.0)', weight = 600 } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${weight} ${fontSize}px "Apple SD Gothic Neo","Malgun Gothic",sans-serif`;
  const padX = 24;
  const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
  const h = fontSize + 28;
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
  const scale = 0.011;
  sprite.scale.set(w * scale, h * scale, 1);
  return sprite;
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
  const floorGeo = new THREE.BoxGeometry(office.floor.w, 0.2, office.floor.d);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xcfc7b4, roughness: 0.95 });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.position.set(cx, -0.1, cz);
  floorMesh.receiveShadow = true;
  group.add(floorMesh);

  // perimeter walls (low, with a gap as an opening)
  const wallH = 1.6;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a4250, transparent: true, opacity: 0.35 });
  const wallThickness = 0.12;
  const gap = Math.min(office.floor.w, office.floor.d) * 0.22;

  function addWallSegment(x1, z1, x2, z2) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.05) return;
    const geo = new THREE.BoxGeometry(len, wallH, wallThickness);
    const mesh = new THREE.Mesh(geo, wallMat);
    mesh.position.set((x1 + x2) / 2, wallH / 2, (z1 + z2) / 2);
    mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    group.add(mesh);
  }
  const w = office.floor.w, d = office.floor.d;
  // back wall (full)
  addWallSegment(0, 0, w, 0);
  // left wall (full)
  addWallSegment(0, 0, 0, d);
  // right wall (full)
  addWallSegment(w, 0, w, d);
  // front wall with a center gap (entrance)
  const frontMid = w / 2;
  addWallSegment(0, d, frontMid - gap / 2, d);
  addWallSegment(frontMid + gap / 2, d, w, d);

  // rooms (meeting rooms, pillar, etc.)
  (office.rooms || []).forEach((room) => {
    if (room.type === 'pillar') {
      const r = Math.min(room.w, room.d) / 2;
      const geo = new THREE.CylinderGeometry(r, r, 2.6, 24);
      const mat = new THREE.MeshStandardMaterial({ color: 0x555b66, roughness: 0.6 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(room.x + room.w / 2, 1.3, room.z + room.d / 2);
      mesh.castShadow = true;
      group.add(mesh);
      const label = makeLabelSprite(room.label, { fontSize: 32, color: '#aab0bb' });
      label.position.set(room.x + room.w / 2, 2.9, room.z + room.d / 2);
      group.add(label);
    } else {
      const wallGeo = new THREE.BoxGeometry(room.w, 1.9, room.d);
      const edges = new THREE.EdgesGeometry(wallGeo);
      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x7fb3e0 }));
      line.position.set(room.x + room.w / 2, 0.95, room.z + room.d / 2);
      group.add(line);
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x7fb3e0, transparent: true, opacity: 0.12, roughness: 0.2 });
      const glass = new THREE.Mesh(wallGeo, glassMat);
      glass.position.copy(line.position);
      group.add(glass);

      // simple meeting table inside
      const tableGeo = new THREE.BoxGeometry(room.w * 0.55, 0.72, room.d * 0.4);
      const tableMat = new THREE.MeshStandardMaterial({ color: 0x8a6b4a, roughness: 0.6 });
      const table = new THREE.Mesh(tableGeo, tableMat);
      table.position.set(room.x + room.w / 2, 0.36, room.z + room.d / 2);
      table.castShadow = true;
      group.add(table);

      const label = makeLabelSprite(room.label, { fontSize: 34, color: '#cfe3f5' });
      label.position.set(room.x + room.w / 2, 2.2, room.z + room.d / 2);
      group.add(label);
    }
  });

  // zone labels (floating overhead team markers)
  (office.zones || []).forEach((zone) => {
    const label = makeLabelSprite(zone.label, { fontSize: 30, color: '#7b8290' });
    label.position.set(zone.x, 3.4, zone.z);
    group.add(label);
  });

  // seats
  const meshes = [];
  (office.seats || []).forEach((seat) => {
    const deskW = seat.w * 0.82;
    const deskD = seat.d * 0.82;
    const color = new THREE.Color(TEAM_COLOR[seat.team] || TEAM_COLOR.other);

    const deskGeo = new THREE.BoxGeometry(deskW, 0.72, deskD);
    const deskMat = new THREE.MeshStandardMaterial({
      color: seat.occupied ? 0xcdb89a : 0x4a4f58,
      roughness: 0.75,
      transparent: !seat.occupied,
      opacity: seat.occupied ? 1 : 0.35,
    });
    const desk = new THREE.Mesh(deskGeo, deskMat);
    desk.position.set(seat.x, 0.36, seat.z);
    desk.castShadow = seat.occupied;
    desk.receiveShadow = true;
    desk.userData = { seat, baseColor: deskMat.color.clone(), office: key };
    group.add(desk);
    meshes.push(desk);

    // team accent strip along the front edge
    const accentGeo = new THREE.BoxGeometry(deskW * 0.9, 0.06, Math.min(0.08, deskD * 0.15));
    const accentMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: seat.occupied ? 0.35 : 0.05 });
    const accent = new THREE.Mesh(accentGeo, accentMat);
    accent.position.set(seat.x, 0.73, seat.z + deskD / 2 - 0.05);
    group.add(accent);

    if (seat.occupied) {
      // chair
      const chairGeo = new THREE.CylinderGeometry(deskW * 0.22, deskW * 0.26, 0.55, 12);
      const chairMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.8 });
      const chair = new THREE.Mesh(chairGeo, chairMat);
      chair.position.set(seat.x, 0.27, seat.z + deskD / 2 + 0.35);
      chair.castShadow = true;
      group.add(chair);

      // monitor accent
      const monGeo = new THREE.BoxGeometry(deskW * 0.35, 0.28, 0.04);
      const monMat = new THREE.MeshStandardMaterial({ color: 0x1b1d22 });
      const mon = new THREE.Mesh(monGeo, monMat);
      mon.position.set(seat.x, 0.72 + 0.16, seat.z - deskD / 2 + 0.08);
      group.add(mon);

      const nameTag = makeLabelSprite(`${seat.name}`, { fontSize: 36, color: '#f3f5f8' });
      nameTag.position.set(seat.x, 1.55, seat.z);
      group.add(nameTag);
    }
  });

  seatMeshes[key] = meshes;
  officeGroups[key] = group;
  scene.add(group);
}

function frameOffice(key, animateCam) {
  const group = officeGroups[key];
  const { w, d } = group.userData.size;
  const { x: cx, z: cz } = group.userData.center;
  const maxDim = Math.max(w, d);
  const target = new THREE.Vector3(cx, 0, cz);
  const pos = new THREE.Vector3(cx + maxDim * 0.75, maxDim * 0.85, cz + maxDim * 0.95);
  controls.target.copy(target);
  camera.position.copy(pos);
  camera.updateProjectionMatrix();
}

function setActiveOffice(key, resetCamera) {
  currentOffice = key;
  Object.keys(officeGroups).forEach((k) => (officeGroups[k].visible = k === key));
  const office = DATA.offices[key];
  document.getElementById('office-address').textContent = `${office.name} · ${office.address}`;
  document.getElementById('roster-title').textContent = `${office.name} 인원 현황`;
  renderLegend();
  renderRoster(key, '');
  if (resetCamera) frameOffice(key, true);
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
    .forEach((seat) => {
      const li = document.createElement('li');
      li.className = 'roster-item';
      li.innerHTML = `
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
  const target = new THREE.Vector3(seat.x, 0, seat.z);
  controls.target.lerp(target, 1);
  const dist = 11;
  camera.position.set(seat.x + dist * 0.7, dist * 0.8, seat.z + dist * 0.9);
  camera.updateProjectionMatrix();

  const mesh = seatMeshes[key].find((m) => m.userData.seat === seat);
  selectHighlight(mesh);
}

function selectHighlight(mesh) {
  if (selectedMesh && selectedMesh !== mesh) {
    selectedMesh.material.emissive && selectedMesh.material.emissive.set(0x000000);
  }
  selectedMesh = mesh;
  if (mesh && mesh.material.emissive) {
    mesh.material.emissive.set(0x3b6fb5);
    mesh.material.emissiveIntensity = 0.35;
  }
}

function onResize() {
  const wrap = document.getElementById('canvas-wrap');
  camera.aspect = wrap.clientWidth / wrap.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
}

function onPointerMove(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(seatMeshes[currentOffice] || []);
  if (hits.length) {
    const mesh = hits[0].object;
    hoveredMesh = mesh;
    setTooltip(mesh.userData.seat, e.clientX, e.clientY);
    renderer.domElement.style.cursor = 'pointer';
  } else {
    hoveredMesh = null;
    setTooltip(null);
    renderer.domElement.style.cursor = 'default';
  }
}

function onClick() {
  if (hoveredMesh && hoveredMesh.userData.seat.occupied) {
    selectHighlight(hoveredMesh);
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
  renderer.render(scene, camera);
}
