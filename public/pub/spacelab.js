/* SATA ROBO · SPACE LAB — cảnh 3D chủ đạo cho hero trang chủ.
   Một canvas WebGL duy nhất: robot linh vật (GLB) trên bệ năng lượng, 2 vòng quỹ đạo mang linh kiện
   (bánh răng, bánh xe, chip, cảm biến) + ký hiệu kiến thức ({ }, AI, if, ▶), nền sao 2 lớp, cột hạt năng lượng,
   quầng sáng giả bloom bằng sprite cộng màu (không cần EffectComposer).
   - Robot được "neo" vào phần tử opts.anchor bằng lens-shift → chữ/CTA HTML không bao giờ bị che.
   - Pointer (chuột) → nghiêng camera nhẹ + robot nhìn theo. Cuộn trang → linh kiện bung ra, vòng quỹ đạo nghiêng,
     camera tiến vào (tiến trình 0→1 theo chiều cao hero).
   - Dừng render khi canvas ra khỏi màn hình hoặc tab ẩn; DPR ≤ 1.75 (mobile ≤ 1.25); tự hạ chất lượng khi khung hình chậm.
   - prefers-reduced-motion: không vòng lặp, chỉ vẽ tĩnh khi tải/resize.
   API: sataSpaceLab(canvas, url | 'b64:...', { anchor, textures, baseYaw, onLoad, onError, time, progress }) → { dispose } */
function sataSpaceLab(canvas, url, opts) {
  opts = opts || {};
  var THREE = window.THREE, W = window;
  var reduce = W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fixedT = opts.time, fixedP = opts.progress;
  var small = Math.min(W.innerWidth || 1200, W.screen ? W.screen.width : 1200) < 760;
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !small, alpha: true, powerPreference: 'high-performance' });
  var maxDpr = small ? 1.25 : 1.75, dpr = Math.min(W.devicePixelRatio || 1, maxDpr);
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setClearColor(0x000000, 0);

  var scene = new THREE.Scene();
  var pm = new THREE.PMREMGenerator(renderer);
  var envTex = pm.fromScene(new W.RoomEnvironment(), 0.04).texture; scene.environment = envTex; pm.dispose();
  var camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);

  /* ---------- ánh sáng: key trắng + viền cam/tím + fill xanh ngọc từ bệ ---------- */
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2a1340, 0.55));
  var key = new THREE.DirectionalLight(0xffffff, 1.35); key.position.set(2, 3, 3); scene.add(key);
  var rimO = new THREE.PointLight(0xfe8f2d, 7, 7, 1.4); rimO.position.set(-1.5, 0.9, -1); scene.add(rimO);
  var rimP = new THREE.PointLight(0xb84be8, 7, 7, 1.4); rimP.position.set(1.5, 0.6, -1.1); scene.add(rimP);
  var fill = new THREE.PointLight(0x4fd1b5, 2.2, 3, 1.6); fill.position.set(0, -0.35, 0.6); scene.add(fill);

  /* ---------- texture phát sáng dùng chung (radial gradient) ---------- */
  function glowTex(stops) {
    var c = document.createElement('canvas'); c.width = c.height = 128; var g = c.getContext('2d');
    var gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    stops.forEach(function (s) { gr.addColorStop(s[0], s[1]); });
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  var TEX = {
    soft: glowTex([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]),
    dot: glowTex([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.9)'], [0.6, 'rgba(255,255,255,.25)'], [1, 'rgba(255,255,255,0)']])
  };
  var disposables = [TEX.soft, TEX.dot];
  function glowSprite(color, size, opacity) {
    var m = new THREE.SpriteMaterial({ map: TEX.soft, color: color, transparent: true, opacity: opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    var s = new THREE.Sprite(m); s.scale.set(size, size, 1); disposables.push(m); return s;
  }

  var root = new THREE.Group(); scene.add(root);

  /* ---------- nền sao 2 lớp + tinh vân ---------- */
  function starLayer(n, rMin, rMax, size, palette) {
    var g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), c = new Float32Array(n * 3), col = new THREE.Color();
    for (var i = 0; i < n; i++) {
      var r = rMin + Math.random() * (rMax - rMin), th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      p[i * 3] = r * Math.sin(ph) * Math.cos(th); p[i * 3 + 1] = r * Math.cos(ph) * 0.7; p[i * 3 + 2] = -Math.abs(r * Math.sin(ph) * Math.sin(th)) - 1.5;
      col.set(palette[(Math.random() * palette.length) | 0]).multiplyScalar(0.55 + Math.random() * 0.45);
      c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    var m = new THREE.PointsMaterial({ size: size, map: TEX.dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false });
    disposables.push(g, m); return new THREE.Points(g, m);
  }
  var nStar = small ? 260 : 700;
  var stars1 = starLayer(nStar, 5, 12, 0.07, ['#ffffff', '#e9ddff', '#ffd3a8']);
  var stars2 = starLayer(Math.round(nStar * 0.45), 3, 6, 0.06, ['#4fd1b5', '#b84be8', '#fe8f2d', '#ffffff']);
  scene.add(stars1); scene.add(stars2);
  var neb1 = glowSprite(0x7a2bd1, 7.5, 0.22); neb1.position.set(-1.8, 0.8, -6); scene.add(neb1);
  var neb2 = glowSprite(0xfe8f2d, 6, 0.13); neb2.position.set(2.2, -0.6, -5.5); scene.add(neb2);

  /* ---------- bệ năng lượng ---------- */
  var lab = new THREE.Group(); root.add(lab);
  var pedMat = new THREE.MeshPhysicalMaterial({ color: 0x1b1029, roughness: 0.28, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.15 });
  var pedGeo = new THREE.CylinderGeometry(0.46, 0.52, 0.11, 64), ped = new THREE.Mesh(pedGeo, pedMat); ped.position.y = -0.56; lab.add(ped);
  var ped2Geo = new THREE.CylinderGeometry(0.6, 0.66, 0.05, 64), ped2 = new THREE.Mesh(ped2Geo, pedMat); ped2.position.y = -0.64; lab.add(ped2);
  disposables.push(pedMat, pedGeo, ped2Geo);
  function ringMesh(r, tube, color) {
    var g = new THREE.TorusGeometry(r, tube, 8, 160), m = new THREE.MeshBasicMaterial({ color: color, toneMapped: false });
    disposables.push(g, m); var o = new THREE.Mesh(g, m); o.rotation.x = Math.PI / 2; return o;
  }
  var pedRing = ringMesh(0.47, 0.008, 0xfe8f2d); pedRing.position.y = -0.5; lab.add(pedRing);
  var pedRing2 = ringMesh(0.62, 0.005, 0x4fd1b5); pedRing2.position.y = -0.615; lab.add(pedRing2);
  // đĩa sáng dưới chân (giả bloom)
  var discMat = new THREE.MeshBasicMaterial({ map: TEX.soft, color: 0x4fd1b5, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  var discGeo = new THREE.PlaneGeometry(1.7, 1.7), disc = new THREE.Mesh(discGeo, discMat); disc.rotation.x = -Math.PI / 2; disc.position.y = -0.495; lab.add(disc);
  disposables.push(discMat, discGeo);
  var halo = glowSprite(0xb84be8, 2.3, 0.32); halo.position.set(0, 0.02, -0.55); lab.add(halo);
  var haloO = glowSprite(0xfe8f2d, 1.3, 0.22); haloO.position.set(-0.25, -0.25, -0.4); lab.add(haloO);

  /* ---------- cột hạt năng lượng bốc lên từ bệ ---------- */
  var nCol = small ? 70 : 160, colGeo = new THREE.BufferGeometry(), colPos = new Float32Array(nCol * 3), colCol = new Float32Array(nCol * 3), colSeed = [];
  for (var i = 0; i < nCol; i++) { colSeed.push({ a: Math.random() * 6.283, r: 0.12 + Math.random() * 0.34, v: 0.18 + Math.random() * 0.35, y: Math.random(), hue: Math.random() < 0.7 ? 0 : 1 }); }
  colGeo.setAttribute('position', new THREE.BufferAttribute(colPos, 3)); colGeo.setAttribute('color', new THREE.BufferAttribute(colCol, 3));
  var colMat = new THREE.PointsMaterial({ size: 0.035, map: TEX.dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  var column = new THREE.Points(colGeo, colMat); lab.add(column); disposables.push(colGeo, colMat);
  var cTeal = new THREE.Color(0x4fd1b5), cOr = new THREE.Color(0xfe8f2d);
  function updColumn(t, power) {
    for (var i = 0; i < nCol; i++) {
      var s = colSeed[i], y = (s.y + t * s.v * 0.35) % 1, a = s.a + t * 0.4;
      colPos[i * 3] = Math.cos(a) * s.r * (1 - y * 0.35); colPos[i * 3 + 1] = -0.5 + y * 1.25; colPos[i * 3 + 2] = Math.sin(a) * s.r * (1 - y * 0.35);
      var k = TH.light ? 1 : Math.sin(Math.PI * y) * power, c = s.hue ? cOr : cTeal;
      colCol[i * 3] = c.r * k; colCol[i * 3 + 1] = c.g * k; colCol[i * 3 + 2] = c.b * k;
    }
    colGeo.attributes.position.needsUpdate = true; colGeo.attributes.color.needsUpdate = true;
  }

  /* ---------- 2 vòng quỹ đạo ---------- */
  var orbitA = new THREE.Group(), orbitB = new THREE.Group(); lab.add(orbitA); lab.add(orbitB);
  orbitA.position.y = 0.0; orbitB.position.y = 0.05;
  function orbitLine(r, color, opacity) {
    var pts = []; for (var k = 0; k <= 160; k++) { var a = k / 160 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
    var g = new THREE.BufferGeometry().setFromPoints(pts), m = new THREE.LineDashedMaterial({ color: color, transparent: true, opacity: opacity, dashSize: 0.05, gapSize: 0.035, toneMapped: false });
    var l = new THREE.Line(g, m); l.computeLineDistances(); disposables.push(g, m); return l;
  }
  var lineA = orbitLine(0.62, 0xfe8f2d, 0.55), lineB = orbitLine(0.74, 0x4fd1b5, 0.45);
  orbitA.add(lineA); orbitB.add(lineB);

  /* ---------- linh kiện 3D ---------- */
  var M_OR = new THREE.MeshStandardMaterial({ color: 0xfe8f2d, roughness: 0.35, metalness: 0.35, emissive: 0x5a2200, emissiveIntensity: 0.4 });
  var M_PU = new THREE.MeshStandardMaterial({ color: 0x8e3cc4, roughness: 0.3, metalness: 0.4, emissive: 0x2a0a40, emissiveIntensity: 0.5 });
  var M_TE = new THREE.MeshStandardMaterial({ color: 0x4fd1b5, roughness: 0.25, metalness: 0.2, emissive: 0x4fd1b5, emissiveIntensity: 0.7 });
  var M_DK = new THREE.MeshStandardMaterial({ color: 0x241133, roughness: 0.4, metalness: 0.6 });
  var M_WH = new THREE.MeshStandardMaterial({ color: 0xf6f2fc, roughness: 0.35, metalness: 0.1 });
  disposables.push(M_OR, M_PU, M_TE, M_DK, M_WH);
  function geo(g) { disposables.push(g); return g; }
  function gear() {
    var sh = new THREE.Shape(), teeth = 10, R = 0.085, r = 0.066;
    for (var k = 0; k < teeth * 4; k++) { var a = k / (teeth * 4) * Math.PI * 2, rr = (k % 4 < 2) ? R : r; if (k === 0) sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    var hole = new THREE.Path(); hole.absarc(0, 0, 0.026, 0, Math.PI * 2, true); sh.holes.push(hole);
    var g = new THREE.Group(); g.add(new THREE.Mesh(geo(new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 })), M_OR)); return g;
  }
  function wheel() {
    var g = new THREE.Group();
    var tire = new THREE.Mesh(geo(new THREE.TorusGeometry(0.06, 0.026, 12, 28)), M_DK); g.add(tire);
    var hub = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 20)), M_PU); hub.rotation.x = Math.PI / 2; g.add(hub);
    return g;
  }
  function chip() {
    var g = new THREE.Group(); g.add(new THREE.Mesh(geo(new THREE.BoxGeometry(0.13, 0.13, 0.025)), M_DK));
    var core = new THREE.Mesh(geo(new THREE.BoxGeometry(0.06, 0.06, 0.03)), M_TE); g.add(core);
    var pinG = geo(new THREE.BoxGeometry(0.012, 0.03, 0.01));
    for (var k = -2; k <= 2; k++) { [[k * 0.024, 0.078], [k * 0.024, -0.078]].forEach(function (p) { var m = new THREE.Mesh(pinG, M_OR); m.position.set(p[0], p[1], 0); g.add(m); }); var m2 = new THREE.Mesh(pinG, M_OR); m2.rotation.z = Math.PI / 2; m2.position.set(0.078, k * 0.024, 0); g.add(m2); var m3 = m2.clone(); m3.position.x = -0.078; g.add(m3); }
    return g;
  }
  function sensor() {
    var g = new THREE.Group(); g.add(new THREE.Mesh(geo(new THREE.BoxGeometry(0.17, 0.07, 0.03)), M_PU));
    var eg = geo(new THREE.CylinderGeometry(0.028, 0.028, 0.04, 20));
    [-0.045, 0.045].forEach(function (x) { var e = new THREE.Mesh(eg, M_WH); e.rotation.x = Math.PI / 2; e.position.set(x, 0, 0.02); g.add(e); var c = new THREE.Mesh(geo(new THREE.CircleGeometry(0.017, 16)), M_TE); c.position.set(x, 0, 0.041); g.add(c); });
    return g;
  }
  function glyphTex(text, color, bg, ink) {
    var c = document.createElement('canvas'); c.width = 192; c.height = 128; var g = c.getContext('2d');
    g.fillStyle = bg; g.strokeStyle = color; g.lineWidth = 6;
    g.beginPath(); if (g.roundRect) g.roundRect(8, 8, 176, 112, 26); else g.rect(8, 8, 176, 112); g.fill(); g.stroke();
    g.fillStyle = ink || color; g.font = '700 58px "Space Mono", ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 96, 68);
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; disposables.push(t); return t;
  }
  function glyph(text, color, inkLight) {
    var tD = glyphTex(text, color, 'rgba(20,8,40,.72)'), tL = glyphTex(text, color, 'rgba(255,255,255,.92)', inkLight);
    var m = new THREE.SpriteMaterial({ map: tD, transparent: true, depthWrite: false, toneMapped: false });
    disposables.push(m); var s = new THREE.Sprite(m); s.scale.set(0.15, 0.1, 1); s.userData.tex = { dark: tD, light: tL }; return s;
  }
  // [đối tượng, vòng, góc pha, tốc độ tự quay]
  var parts = [
    { o: gear(), ring: orbitA, a: 0.2, spin: 1.2 }, { o: chip(), ring: orbitA, a: 2.3, spin: 0.6 }, { o: wheel(), ring: orbitA, a: 4.3, spin: 1.6 },
    { o: sensor(), ring: orbitB, a: 1.1, spin: 0.5 }, { o: glyph('{ }', '#fe8f2d', '#c2570c'), ring: orbitB, a: 3.0, sprite: 1 },
    { o: glyph('AI', '#4fd1b5', '#0f766e'), ring: orbitB, a: 5.0, sprite: 1 }, { o: glyph('if', '#b84be8', '#6b21a8'), ring: orbitA, a: 5.6, sprite: 1 },
    { o: glyph('▶', '#fe8f2d', '#c2570c'), ring: orbitB, a: 6.1 - 4, sprite: 1 }
  ];
  parts.forEach(function (p, idx) {
    p.r = p.ring === orbitA ? 0.62 : 0.74;
    var gl = glowSprite(p.sprite ? 0xb84be8 : 0xfe8f2d, 0.32, 0.35); p.glow = gl;
    p.wrap = new THREE.Group(); p.wrap.add(gl); p.wrap.add(p.o); p.o.scale.multiplyScalar(p.sprite ? 1.25 : 1.45); p.ring.add(p.wrap);
    p.idx = idx;
  });

  /* ---------- giao diện sáng / tối ---------- */
  var TH = { light: false, glowK: 1, lineK: 1 };
  function blend(m, light) { m.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending; m.needsUpdate = true; }
  function applyTheme(t) {
    var L = TH.light = t === 'light';
    renderer.toneMappingExposure = L ? 1.0 : 1.12;
    [stars1.material, stars2.material].forEach(function (m) { blend(m, L); m.color.set(L ? 0x8a4fc4 : 0xffffff); });
    stars1.material.opacity = L ? 0.45 : 1; stars1.material.size = L ? 0.055 : 0.07;
    blend(neb1.material, L); neb1.material.color.set(L ? 0xd9bdf7 : 0x7a2bd1); neb1.material.opacity = L ? 0.35 : 0.22;
    blend(neb2.material, L); neb2.material.color.set(L ? 0xffd2ad : 0xfe8f2d); neb2.material.opacity = L ? 0.3 : 0.13;
    blend(halo.material, L); halo.material.color.set(L ? 0xe2c6ff : 0xb84be8);
    blend(haloO.material, L); haloO.material.color.set(L ? 0xffd7b3 : 0xfe8f2d); haloO.material.opacity = L ? 0.35 : 0.22;
    blend(discMat, L); discMat.color.set(L ? 0x7fe3cf : 0x4fd1b5);
    blend(colMat, L); colMat.opacity = L ? 0.75 : 1;
    pedMat.color.set(L ? 0xf1e9fb : 0x1b1029); pedMat.metalness = L ? 0.2 : 0.55; pedMat.roughness = L ? 0.3 : 0.28;
    lineA.material.color.set(L ? 0xe0701a : 0xfe8f2d); lineB.material.color.set(L ? 0x0f9e86 : 0x4fd1b5);
    parts.forEach(function (q) { blend(q.glow.material, L); q.glow.material.color.set(L ? 0xe9d4ff : (q.sprite ? 0xb84be8 : 0xfe8f2d)); if (q.sprite) { q.o.material.map = q.o.userData.tex[L ? 'light' : 'dark']; q.o.material.needsUpdate = true; } });
    TH.glowK = L ? 0.8 : 1; TH.lineK = L ? 1.3 : 1;
  }

  /* ---------- robot ---------- */
  var holder = new THREE.Group(); lab.add(holder);
  var model = null, born = null;
  var loader = new W.GLTFLoader(); if (W.MeshoptDecoder) loader.setMeshoptDecoder(W.MeshoptDecoder);
  function onGltf(g) {
    model = g.scene;
    var box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    var s = 1.0 / size.y; model.scale.setScalar(s);
    model.position.set(-c.x * s, -box.min.y * s - 0.5, -c.z * s);
    var tl = new THREE.TextureLoader(), tx = opts.textures || {};
    function tex(u, srgb) { if (!u) return null; var t = tl.load(u, function () { if (reduce) draw(); }); t.flipY = false; if (srgb) t.colorSpace = THREE.SRGBColorSpace; disposables.push(t); return t; }
    var mapT = tex(tx.map, true), mrT = tex(tx.metalRough, false);
    model.traverse(function (o) {
      if (o.isMesh && o.material) {
        var m = o.material;
        if (mapT) { m.map = mapT; m.color.set(0xffffff); }
        if (mrT) { m.metalnessMap = mrT; m.roughnessMap = mrT; }
        m.envMapIntensity = 0.6; m.needsUpdate = true;
        disposables.push(o.geometry, m);
      }
    });
    holder.add(model); born = performance.now();
    if (opts.onLoad) opts.onLoad();
    draw();
  }
  function onErr(e) { if (opts.onError) opts.onError(e); }
  if (typeof url === 'string' && url.indexOf('b64:') === 0) {
    try { var bin = atob(url.slice(4)), buf = new Uint8Array(bin.length); for (var bi = 0; bi < bin.length; bi++) buf[bi] = bin.charCodeAt(bi); loader.parse(buf.buffer, '', onGltf, onErr); } catch (e) { onErr(e); }
  } else if (url) { loader.load(url, onGltf, undefined, onErr); }

  /* ---------- bố cục: neo robot vào opts.anchor (lens shift) ---------- */
  var view = { w: 1, h: 1, d: 4, sx: 0, sy: 0 };
  var FOV = 30, TAN = Math.tan(FOV * Math.PI / 360);
  function layout() {
    var cr = canvas.getBoundingClientRect(), w = Math.max(1, cr.width), h = Math.max(1, cr.height);
    var ar = opts.anchor && opts.anchor.getBoundingClientRect ? opts.anchor.getBoundingClientRect() : null;
    var ax = w / 2, ay = h / 2, aw = w, ah = h;
    if (ar && ar.width > 10 && ar.height > 10) { ax = ar.left - cr.left + ar.width / 2; ay = ar.top - cr.top + ar.height / 2; aw = ar.width; ah = ar.height; }
    // khối cần hiển thị: cao ~1.5 (bệ → đầu + linh kiện), rộng ~2.25 (vòng quỹ đạo)
    var narrow = w < 700, ppw = narrow ? Math.min(0.9 * ah / 1.45, 0.98 * aw / 1.9) : Math.min(0.94 * ah / 1.34, 1.04 * aw / 1.8);
    if (narrow) ay += ah * 0.03;
    view.w = w; view.h = h; view.d = (h / ppw) / (2 * TAN);
    view.sx = (ax / w) * 2 - 1; view.sy = -((ay / h) * 2 - 1);
    renderer.setSize(w, h, false); camera.aspect = w / h;
  }
  var ro = W.ResizeObserver ? new ResizeObserver(function () { layout(); draw(); }) : null;
  if (ro) { ro.observe(canvas); if (opts.anchor) ro.observe(opts.anchor); }
  layout();
  applyTheme(opts.theme || 'dark');

  /* ---------- input ---------- */
  var target = { x: 0, y: 0 }, ptr = { x: 0, y: 0 };
  function onMove(e) { if (e.pointerType && e.pointerType !== 'mouse') return; target.x = (e.clientX / (W.innerWidth || 1)) * 2 - 1; target.y = (e.clientY / (W.innerHeight || 1)) * 2 - 1; wake(); }
  W.addEventListener('pointermove', onMove, { passive: true });
  function progress() {
    if (fixedP != null) return fixedP;
    var r = canvas.getBoundingClientRect(); return Math.max(0, Math.min(1, -r.top / Math.max(1, r.height * 0.75)));
  }
  var prog = progress(), progS = prog;
  function onScroll() { prog = progress(); if (reduce) draw(); else wake(); }
  W.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- vòng lặp + chất lượng thích ứng ---------- */
  var raf = 0, visible = true, t0 = performance.now(), last = t0, ema = 16, slowFor = 0, level = 0, alive = true;
  function easeOut(x) { return 1 - Math.pow(1 - x, 3); }
  function easeBack(x) { var c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  function degrade() {
    level++;
    if (level === 1) { dpr = 1; renderer.setPixelRatio(1); layout(); }
    if (level === 2) { stars2.visible = false; column.visible = false; }
  }
  function draw(now) {
    if (!alive) return;
    now = now || performance.now();
    var t = fixedT != null ? fixedT : (now - t0) / 1000, idle = (reduce || level >= 3) ? 0 : 1;
    ptr.x += (target.x - ptr.x) * 0.06; ptr.y += (target.y - ptr.y) * 0.06;
    progS += (prog - progS) * (reduce || fixedP != null ? 1 : 0.12);
    var p = progS, ep = p * p * (3 - 2 * p);
    var intro = born ? Math.min((now - born) / 1500, 1) : 0; if (fixedT != null || reduce) intro = born ? 1 : 0;
    var ei = easeBack(intro);

    // camera: dolly-in theo cuộn + nghiêng theo chuột, robot luôn nằm giữa anchor nhờ lens-shift
    var d = view.d * (1 - 0.1 * ep);
    camera.position.set(ptr.x * 0.16 * idle, 0.16 - ptr.y * 0.08 * idle + ep * 0.12, d);
    camera.lookAt(0, -0.02 + ep * 0.05, 0);
    camera.updateProjectionMatrix();
    var e = camera.projectionMatrix.elements; e[8] = -view.sx; e[9] = -view.sy;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

    // robot: trồi lên từ bệ + bật nhẹ, nhìn theo chuột, xoay thêm khi cuộn
    holder.position.y = (1 - Math.min(intro * 1.4, 1)) * -0.45 + Math.sin(t * 1.5) * 0.025 * idle + ep * 0.04;
    holder.rotation.y = (1 - easeOut(intro)) * -2.6 + (opts.baseYaw == null ? -0.25 : opts.baseYaw) + ptr.x * 0.4 * idle + ep * 0.9 + Math.sin(t * 0.4) * 0.1 * idle;
    holder.rotation.x = ptr.y * 0.07 * idle;
    holder.rotation.z = Math.sin(t * 1.1) * 0.02 * idle;
    holder.scale.setScalar(0.6 + 0.4 * Math.max(0, ei));

    // quỹ đạo: nghiêng dần + bung linh kiện ra xa khi cuộn
    orbitA.rotation.set(0.32 + ep * 0.32, t * 0.22 * idle, -0.12 + ptr.x * 0.05);
    orbitB.rotation.set(-0.22 - ep * 0.26, -t * 0.16 * idle + 1, 0.18);
    var spread = 1 + ep * 0.16, appear = born ? Math.min(Math.max((intro - 0.35) / 0.65, 0), 1) : (fixedT != null ? 1 : 0.0);
    parts.forEach(function (q, k) {
      var a = q.a + (q.ring === orbitA ? 0 : 0), r = q.r * spread * (0.4 + 0.6 * easeOut(appear));
      q.wrap.position.set(Math.cos(a) * r, Math.sin(t * 1.3 + k) * 0.03 * idle, Math.sin(a) * r);
      q.wrap.scale.setScalar(Math.max(0.001, easeOut(appear)));
      if (!q.sprite) { q.o.rotation.x = t * q.spin * 0.6 * idle + k; q.o.rotation.y = t * q.spin * idle + k * 0.7; }
      q.glow.material.opacity = (0.28 + 0.12 * Math.sin(t * 2 + k)) * TH.glowK;
    });
    lineA.material.opacity = Math.min(1, (0.35 + 0.3 * appear) * TH.lineK); lineB.material.opacity = Math.min(1, (0.25 + 0.3 * appear) * TH.lineK);

    // năng lượng
    var pw = born ? (0.55 + 0.45 * Math.sin(t * 2.2) * idle) * (intro < 1 ? 1.6 - intro * 0.6 : 1) : 0.4;
    if (column.visible) updColumn(t, Math.min(pw, 1.2));
    discMat.opacity = (0.35 + 0.25 * pw) * (TH.light ? 0.7 : 1); halo.material.opacity = (0.26 + 0.08 * Math.sin(t * 0.9)) * (TH.light ? 1.6 : 1);
    pedRing.material.color.setHSL(((t * 0.05) % 1 + 0.06) % 1, 0.95, 0.6);
    stars1.rotation.y = t * 0.004 * idle + ptr.x * 0.02; stars2.rotation.y = t * 0.01 * idle + ptr.x * 0.05;
    stars2.material.opacity = (0.75 + 0.25 * Math.sin(t * 1.7)) * (TH.light ? 0.6 : 1);

    renderer.render(scene, camera);
  }
  function loop(now) {
    raf = 0; if (!alive || !visible) return;
    var dt = now - last; last = now;
    if (dt < 200) { ema = ema * 0.94 + dt * 0.06; if (ema > 26) { slowFor += dt; if (slowFor > 1600 && level < 3) { degrade(); slowFor = 0; ema = 16; } } else slowFor = Math.max(0, slowFor - dt); }
    draw(now);
    if (level >= 3) return; // thiết bị quá yếu: chỉ vẽ khi có cuộn/chuột
    raf = requestAnimationFrame(loop);
  }
  function wake() { if (!reduce && alive && visible && !raf) { last = performance.now(); raf = requestAnimationFrame(loop); } }
  var io = W.IntersectionObserver ? new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) wake(); }, { threshold: 0 }) : null;
  if (io) io.observe(canvas);
  function onVis() { visible = !document.hidden; if (visible) wake(); }
  document.addEventListener('visibilitychange', onVis);
  function onLost(ev) { ev.preventDefault(); alive = false; if (raf) cancelAnimationFrame(raf); onErr(new Error('webglcontextlost')); }
  canvas.addEventListener('webglcontextlost', onLost);
  if (reduce || fixedT != null) draw(); else wake();

  return {
    draw: draw,
    setTheme: function (t) { if ((t === 'light') !== TH.light) { applyTheme(t); draw(); } },
    dispose: function () {
      alive = false; if (raf) cancelAnimationFrame(raf);
      W.removeEventListener('pointermove', onMove); W.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVis); canvas.removeEventListener('webglcontextlost', onLost);
      if (ro) ro.disconnect(); if (io) io.disconnect();
      disposables.forEach(function (x) { try { x.dispose(); } catch (e) {} });
      envTex.dispose(); renderer.dispose();
    }
  };
}
window.sataSpaceLab = sataSpaceLab;
