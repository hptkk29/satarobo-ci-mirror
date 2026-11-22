function sataMascotGLB2(canvas, url, opts) {
  opts = opts || {};
  var THREE = window.THREE;
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  var scene = new THREE.Scene();
  var pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new window.RoomEnvironment(), 0.04).texture;
  var camera = new THREE.PerspectiveCamera(26, 1, 0.01, 50);
  var camZ = opts.cameraZ || 2.75; camera.position.set(0, 0.22, camZ); camera.lookAt(0, -0.02, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x2a1340, 0.6));
  var key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(2, 3, 3); scene.add(key);
  var rimO = new THREE.PointLight(0xfe8f2d, 6, 6, 1.4); rimO.position.set(-1.4, 0.8, -1); scene.add(rimO);
  var rimP = new THREE.PointLight(0xb84be8, 6, 6, 1.4); rimP.position.set(1.4, 0.5, -1.1); scene.add(rimP);

  var root = new THREE.Group(); scene.add(root);
  var holder = new THREE.Group(); root.add(holder);

  // pedestal + glowing rings
  var ped = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.49, 0.1, 64), new THREE.MeshPhysicalMaterial({ color: 0x1b1029, roughness: 0.25, metalness: 0.5, clearcoat: 1 }));
  ped.position.y = -0.55; if (opts.pedestal !== false) root.add(ped);
  var ringMat = new THREE.MeshBasicMaterial({ color: 0xfe8f2d });
  var ring = new THREE.Mesh(new THREE.TorusGeometry(0.455, 0.007, 8, 128), ringMat); ring.rotation.x = Math.PI / 2; ring.position.y = -0.5; if (opts.pedestal !== false) root.add(ring);
  var ring2Mat = new THREE.MeshBasicMaterial({ color: 0xb84be8 });
  var ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.004, 8, 128), ring2Mat); ring2.rotation.x = Math.PI / 2; ring2.position.y = -0.6; if (opts.pedestal !== false) root.add(ring2);

  var model = null, born = null;
  var loader = new window.GLTFLoader(); loader.setMeshoptDecoder(window.MeshoptDecoder);
  function onGltf(g) {
    model = g.scene;
    var box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    var s = 1.0 / size.y; model.scale.setScalar(s);
    model.position.set(-c.x * s, -box.min.y * s - 0.5, -c.z * s);
    var tl = new THREE.TextureLoader(), tx = opts.textures || {};
    function tex(u, srgb) { if (!u) return null; var t = tl.load(u); t.flipY = false; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }
    var mapT = tex(tx.map, true), mrT = tex(tx.metalRough, false);
    model.traverse(function (o) {
      if (o.isMesh && o.material) {
        var m = o.material;
        if (mapT) { m.map = mapT; m.color.set(0xffffff); }
        if (mrT) { m.metalnessMap = mrT; m.roughnessMap = mrT; }
        m.envMapIntensity = 0.55; m.needsUpdate = true;
      }
    });
    holder.add(model); born = performance.now();
    if (opts.onLoad) opts.onLoad();
  }
  function onErr(e) { if (opts.onError) opts.onError(e); }
  if (typeof url === 'string' && url.indexOf('b64:') === 0) {
    try { var bin = atob(url.slice(4)), buf = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i); loader.parse(buf.buffer, '', onGltf, onErr); } catch (e) { onErr(e); }
  } else { loader.load(url, onGltf, undefined, onErr); }

  var target = { x: 0, y: 0 }, pointer = { x: 0, y: 0 };
  function onMove(e) { target.x = (e.clientX / (window.innerWidth || 1)) * 2 - 1; target.y = (e.clientY / (window.innerHeight || 1)) * 2 - 1; }
  window.addEventListener('pointermove', onMove, { passive: true });
  function resize() { var w = canvas.clientWidth || 400, h = canvas.clientHeight || 400; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  var ro = window.ResizeObserver ? new ResizeObserver(resize) : null; if (ro) ro.observe(canvas); resize();
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var raf = 0, t0 = performance.now(), fixedT = opts.time;
  function easeOut(x) { return 1 - Math.pow(1 - x, 3); }
  function frame(now) {
    var t = fixedT != null ? fixedT : (now - t0) / 1000, idle = reduce ? 0 : 1;
    pointer.x += (target.x - pointer.x) * 0.06; pointer.y += (target.y - pointer.y) * 0.06;
    var sp = opts.scrollSpin === false ? 0 : Math.min((window.scrollY || 0) / 900, 1);
    var intro = born ? Math.min((now - born) / 1400, 1) : 0; if (fixedT != null) intro = 1;
    var e = easeOut(intro);
    holder.position.y = (opts.lift || 0) + (1 - e) * -0.35 + Math.sin(t * 1.5) * 0.025 * idle;
    holder.rotation.y = (1 - e) * -2.4 + (opts.baseYaw == null ? -0.25 : opts.baseYaw) + pointer.x * 0.45 + sp * 1.6 + Math.sin(t * 0.4) * 0.12 * idle;
    holder.rotation.x = pointer.y * 0.08;
    holder.scale.setScalar(0.85 + 0.15 * e);
    ringMat.color.setHSL(((t * 0.05) % 1 + 0.06) % 1, 0.95, 0.6);
    ring2Mat.color.setHSL((t * 0.05 + 0.5) % 1, 0.85, 0.62);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return { dispose: function () { cancelAnimationFrame(raf); window.removeEventListener('pointermove', onMove); if (ro) ro.disconnect(); renderer.dispose(); } };
}
