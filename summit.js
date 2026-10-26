/* The Summit: the Overview's hero in the new design. Your sixteen years as a terrain — age runs left to
   right, the corpus is the height. The front edge is a bad run of markets (1 in 10 do worse), the back edge a
   good one (1 in 10 do better), and the bright path along the crest is the likely way up, all from the plan's
   own 2,000-run simulation. The target is a layer of violet cloud; the flag is retirement. Stars and an aurora fill the sky. A marker climbs from
   today to retirement when the page opens; the age slider takes it anywhere in between.
   Loaded only in the new design (index.html); app.js hands it the numbers. */
import * as THREE from 'three';

let live = null;   // {sig, canvas, api}

function mount(box, d){
  const sig = JSON.stringify([d.ages, d.p50, d.p10, d.p90, d.targetLow, d.targetHigh, d.start]);
  const fresh = box.querySelector('canvas');
  if(live && live.sig === sig){ fresh.replaceWith(live.canvas); live.api.rebind(box); return live.api; }
  if(live) live.api.dispose();
  const canvas = fresh;
  let R;
  try{ R = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true}); }catch(e){ box.classList.add('no3d'); return null; }
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = matchMedia('(max-width: 760px)').matches;
  R.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  const world = new THREE.Group();
  scene.add(world);
  scene.add(new THREE.AmbientLight(0x2a2f6a, 1.8));
  const sun = new THREE.DirectionalLight(0xc7d2ff, 2.2); sun.position.set(-6, 10, 8); scene.add(sun);

  /* ---- the numbers, in scene units */
  const ages = [d.start.age].concat(d.ages);
  const P = k => [d.start.value].concat(d[k]);
  const p10 = P('p10'), p25 = P('p25'), p50 = P('p50'), p75 = P('p75'), p90 = P('p90');
  const a0 = ages[0], a1 = ages[ages.length - 1];
  const W = small ? 12 : 16, HMAX = 6.2, DEPTH = 5.2;
  const yMax = Math.max(p90[p90.length - 1], d.targetHigh) * 1.06 || 1;
  const X = a => ((a - a0) / Math.max(0.001, a1 - a0) - 0.5) * W;
  const Y = v => Math.max(0, v) / yMax * HMAX;
  const at = (arr, a) => {   // the value at any age, between the yearly points
    if(a <= ages[0]) return arr[0];
    for(let i = 1; i < ages.length; i++) if(a <= ages[i]){ const t = (a - ages[i - 1]) / (ages[i] - ages[i - 1]); return arr[i - 1] + (arr[i] - arr[i - 1]) * t; }
    return arr[arr.length - 1];
  };
  /* across the terrain: front (z = +D/2) the 1-in-10 bad run, back (z = -D/2) the 1-in-10 good run */
  const acrossZ = [DEPTH / 2, DEPTH / 4, 0, -DEPTH / 4, -DEPTH / 2];
  const across = [p10, p25, p50, p75, p90];
  const heightAt = (a, z) => {
    const f = (DEPTH / 2 - z) / DEPTH * 4, i = Math.min(3, Math.floor(f)), t = f - i;
    return Y(at(across[i], a) * (1 - t) + at(across[i + 1], a) * t);
  };

  /* ---- the terrain: height-shaded, aurora violet above the target, with contour lines that glow */
  const SX = small ? 70 : 110, SZ = 40;
  const geo = new THREE.PlaneGeometry(W, DEPTH, SX, SZ);
  geo.rotateX(-Math.PI / 2);
  const pa = geo.attributes.position;
  for(let i = 0; i < pa.count; i++){
    const x = pa.getX(i), z = pa.getZ(i), a = a0 + (x / W + 0.5) * (a1 - a0);
    pa.setY(i, heightAt(a, z));
  }
  geo.computeVertexNormals();
  const terrainMat = new THREE.ShaderMaterial({
    transparent: true, side: THREE.DoubleSide,
    uniforms: {uLow: {value: Y(d.targetLow)}, uReveal: {value: calm ? 1 : 0}, uW: {value: W}, uT: {value: 0}},
    vertexShader: `varying vec3 vP; varying vec3 vN; void main(){ vP = position; vN = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uLow; uniform float uReveal; uniform float uW; uniform float uT; varying vec3 vP; varying vec3 vN;
      void main(){
        float edge = (vP.x / uW + 0.5);
        if(edge > uReveal + 0.002) discard;                                   // drawn left to right on opening
        float h = vP.y / max(uLow, 0.001);
        vec3 deep = vec3(.07, .08, .26), mid = vec3(.22, .45, .86);
        vec3 c = mix(deep, mid, clamp(h, 0.0, 1.0));
        c = mix(c, vec3(.66, .42, .95), smoothstep(.96, 1.04, h));             // above the target: aurora violet
        float light = .55 + .45 * max(dot(vN, normalize(vec3(-.4, .9, .5))), 0.0);
        c *= light;
        float k = fract(vP.y * 2.2 - uT * .15);                                // contour lines, drifting upward
        float line = smoothstep(.42, .5, abs(k - .5));                         // 1 on a thin line, 0 between lines
        c += line * mix(vec3(.37, .91, 1.0), vec3(1.0, .82, 1.0), step(1.0, h)) * .6;
        float rim = smoothstep(uReveal - .02, uReveal, edge) * (1.0 - step(.999, uReveal));
        c += vec3(.37, .91, 1.0) * rim * 1.5;                                   // a bright seam where it is being drawn
        gl_FragColor = vec4(c, .93);
      }`,
  });
  const terrain = new THREE.Mesh(geo, terrainMat);
  world.add(terrain);
  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.PlaneGeometry(W, DEPTH, Math.round(SX / 5), 8).rotateX(-Math.PI / 2)),
    new THREE.LineBasicMaterial({color: 0x9fb4ff, transparent: true, opacity: 0.0, depthWrite: false}));
  { const wp = wire.geometry.attributes.position;
    for(let i = 0; i < wp.count; i++){ const x = wp.getX(i), z = wp.getZ(i), a = a0 + (x / W + 0.5) * (a1 - a0); wp.setY(i, heightAt(a, z) + 0.01); } }
  world.add(wire);

  /* ---- the floor, and an age every few years */
  const floor = new THREE.GridHelper(W * 1.3, 26, 0x3b3f9e, 0x1c1f4a);
  floor.material.transparent = true; floor.material.opacity = 0.35;
  world.add(floor);

  /* ---- the sky: stars that twinkle, and an aurora rippling behind the terrain */
  const STARS = small ? 220 : 420, sp = new Float32Array(STARS * 3), sph = new Float32Array(STARS);
  for(let i = 0; i < STARS; i++){ sp.set([(Math.random() - .5) * 60, 1 + Math.random() * 18, -10 - Math.random() * 18], i * 3); sph[i] = Math.random() * 6.28; }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('aPh', new THREE.BufferAttribute(sph, 1));
  const starMat = new THREE.ShaderMaterial({transparent: true, depthWrite: false, uniforms: {uT: {value: 0}, uPR: {value: R.getPixelRatio()}},
    vertexShader: 'attribute float aPh; uniform float uT; uniform float uPR; varying float vA; void main(){ vA = .35 + .65 * (.5 + .5 * sin(uT * 1.6 + aPh * 3.0)); vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = (1.2 + 1.6 * fract(aPh)) * uPR * 18.0 / -mv.z; }',
    fragmentShader: 'varying float vA; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, 0.0, d); gl_FragColor = vec4(vec3(.85, .9, 1.0), a * vA); }'});
  const stars = new THREE.Points(sg, starMat); stars.frustumCulled = false; scene.add(stars);
  const auroraMat = new THREE.ShaderMaterial({transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: {uT: {value: 0}, uO: {value: 0}},
    vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uT; uniform float uO; varying vec2 vU;
      void main(){
        float x = vU.x * 6.2832;
        float ridge = .55 + .14 * sin(x * 1.3 + uT * .25) + .08 * sin(x * 3.1 - uT * .4) + .04 * sin(x * 7.0 + uT * .9);
        float band = smoothstep(ridge - .32, ridge, vU.y) * (1.0 - smoothstep(ridge, ridge + .06, vU.y));      // a curtain that hangs down from the ridge
        float rays = .65 + .35 * sin(vU.x * 90.0 + sin(uT * .5 + vU.x * 8.0) * 3.0);                         // fine vertical rays
        vec3 col = mix(vec3(.25, 1.0, .75), vec3(.37, .91, 1.0), smoothstep(.0, .5, vU.x));
        col = mix(col, vec3(.70, .52, 1.0), smoothstep(.45, 1.0, vU.x));
        col = mix(col, vec3(1.0, .55, .85), smoothstep(ridge - .05, ridge + .04, vU.y) * .6);
        float a = band * rays * (.55 + .45 * sin(x * .7 + uT * .3)) * uO * .55;
        gl_FragColor = vec4(col, a); }`});
  const aurora = new THREE.Mesh(new THREE.PlaneGeometry(56, 16), auroraMat);
  aurora.position.set(0, 9, -16); scene.add(aurora);

  /* ---- the target: a layer of violet cloud between the low and the high target */
  const yLo = Y(d.targetLow), yHi = Y(d.targetHigh);
  const cloudMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: {uT: {value: 0}, uO: {value: 0}},
    vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uT; uniform float uO; varying vec2 vU;
      void main(){ float n = sin(vU.x * 18.0 + uT * .6) * sin(vU.y * 11.0 - uT * .4) * .5 + .5;
        float edge = smoothstep(0.0, .12, vU.x) * smoothstep(1.0, .88, vU.x) * smoothstep(0.0, .15, vU.y) * smoothstep(1.0, .85, vU.y);
        gl_FragColor = vec4(vec3(.78, .66, 1.0), (.12 + .10 * n) * edge * uO); }`,   // soft lavender, see-through: the page shows behind it
  });
  const cloudGroup = new THREE.Group();
  [yLo, (yLo + yHi) / 2, yHi].forEach((y, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.08, DEPTH * 1.15), cloudMat); m.rotation.x = -Math.PI / 2; m.position.y = y; cloudGroup.add(m);
    if(i !== 1){ const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(W * 1.08, DEPTH * 1.15)), new THREE.LineDashedMaterial({color: 0xc4b5fd, dashSize: .25, gapSize: .18, transparent: true, opacity: 0}));
      e.computeLineDistances(); e.rotation.x = -Math.PI / 2; e.position.y = y; cloudGroup.add(e); }
  });
  world.add(cloudGroup);

  /* ---- the likely path, along the crest, as a glowing tube */
  const pts = []; for(let i = 0; i <= 160; i++){ const a = a0 + (a1 - a0) * i / 160; pts.push(new THREE.Vector3(X(a), Y(at(p50, a)) + 0.06, 0)); }
  const curve = new THREE.CatmullRomCurve3(pts);
  const tubeGeo = new THREE.TubeGeometry(curve, 220, 0.045, 8, false);
  const tubeMat = new THREE.MeshBasicMaterial({color: 0xbff4ff});
  const tube = new THREE.Mesh(tubeGeo, tubeMat);
  tube.geometry.setDrawRange(0, 0);
  world.add(tube);
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.3, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const glow = (c, s, o) => { const m = new THREE.Sprite(new THREE.SpriteMaterial({map: glowTex, color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false})); m.scale.setScalar(s); return m; };

  /* ---- the flag at retirement */
  const flag = new THREE.Group();
  const top = Y(p50[p50.length - 1]);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 1.3, 8), new THREE.MeshStandardMaterial({color: 0xf3f1e8, metalness: .4, roughness: .3}));
  pole.position.y = .65; flag.add(pole);
  const flagShape = new THREE.Shape(); flagShape.moveTo(0, 0); flagShape.lineTo(.62, -.2); flagShape.lineTo(0, -.4);
  const cloth = new THREE.Mesh(new THREE.ShapeGeometry(flagShape), new THREE.MeshBasicMaterial({color: 0xc4b5fd, side: THREE.DoubleSide}));
  cloth.position.y = 1.3; flag.add(cloth);
  const flagGlow = glow(0xa78bfa, 2.4, .8); flagGlow.position.y = 1.1; flag.add(flagGlow);
  flag.position.set(X(a1), top, 0); flag.scale.setScalar(0.001);
  world.add(flag);

  /* ---- you: a marker on the path, a beam to the floor, and SIP coins rising into it */
  const you = new THREE.Group();
  const orb = new THREE.Mesh(new THREE.SphereGeometry(.13, 24, 16), new THREE.MeshBasicMaterial({color: 0xffffff}));
  you.add(orb);
  const halo = glow(0x5ee7ff, 1.5, .9); you.add(halo);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, 1, 6), new THREE.MeshBasicMaterial({color: 0x5ee7ff, transparent: true, opacity: .45}));
  world.add(beam);
  world.add(you);
  const COINS = small ? 40 : 70, cp = new Float32Array(COINS * 3), cph = Array.from({length: COINS}, () => Math.random());
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(cp, 3));
  const coins = new THREE.Points(cg, new THREE.PointsMaterial({color: 0x9ff0ff, size: .09, map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending}));
  coins.frustumCulled = false;
  world.add(coins);

  /* ---- labels pinned in the scene: ages on the floor, and the readout over the marker */
  let tags = [], readout = null, slider = null, play = null, lastRead = '';
  const tagAges = []; { const step = (a1 - a0) > 14 ? 4 : (a1 - a0) > 7 ? 2 : 1; for(let a = Math.ceil(a0); a <= Math.floor(a1); a += step) tagAges.push(a); if(tagAges[tagAges.length - 1] !== Math.round(a1)) tagAges.push(Math.round(a1)); }

  /* ---- age: the marker's place; the opening time-lapse plays it from today to retirement */
  let age = a0, playing = !calm, t0 = performance.now() + 900, intro = 0;   // intro: when the opening (re)started, on the scene clock
  const LAPSE = 5200;
  const setAge = (a, fromUser) => { age = Math.max(a0, Math.min(a1, a)); if(fromUser) playing = false; };

  let alive = true, vis = true, px = 0, py = 0, tx = 0, ty = 0;
  const onMove = e => { const r = canvas.getBoundingClientRect(); tx = (e.clientX - r.left) / r.width - .5; ty = (e.clientY - r.top) / r.height - .5; };
  const onLeave = () => { tx = ty = 0; };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  const io = new IntersectionObserver(e => { vis = e[0].isIntersecting; }); io.observe(canvas);
  const resize = () => { const w = canvas.clientWidth, h = canvas.clientHeight; if(!w || !h) return; R.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  addEventListener('resize', resize);

  function rebind(b){
    box = b;
    tags = tagAges.map(a => { const el = document.createElement('span'); el.className = 'sm-age'; el.textContent = a; b.querySelector('.sm-tags').appendChild(el); return {a, el}; });
    readout = b.querySelector('.sm-read');
    const hero = b.closest('.sm-hero') || b;           // the slider and Replay sit under the stage, in the hero
    slider = hero.querySelector('.sm-slider');
    play = hero.querySelector('.sm-play');
    lastRead = '';
    if(slider){ slider.min = a0; slider.max = a1; slider.step = 0.1; slider.value = age;
      slider.oninput = () => setAge(Number(slider.value), true); }
    if(play) play.onclick = () => {
      if(playing){ playing = false; return; }                         // pause
      if(age >= a1 - .05 || age <= a0 + .05){                          // from the start: the whole opening again
        intro = clock.elapsedTime; flag.scale.setScalar(.001); age = a0; t0 = performance.now() + 900;
      } else t0 = performance.now() - (age - a0) / (a1 - a0) * LAPSE;  // carry on from where it was paused
      playing = true;
    };
    resize();
  }
  rebind(box);

  const V = new THREE.Vector3(), clock = new THREE.Clock();
  const ease = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  function frame(){
    if(!alive) return;
    requestAnimationFrame(frame);
    if(!vis || !canvas.isConnected) return;
    const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
    /* opening: the terrain draws in, the cloud gathers, then the marker climbs */
    const ti = t - intro;
    const reveal = calm ? 1 : Math.min(1, ti / 1.6);
    terrainMat.uniforms.uReveal.value = ease(reveal);
    terrainMat.uniforms.uT.value = t;
    wire.material.opacity = .06 * reveal;
    cloudMat.uniforms.uT.value = t;
    starMat.uniforms.uT.value = t; auroraMat.uniforms.uT.value = t; auroraMat.uniforms.uO.value = calm ? 1 : Math.min(1, ti / 2.5); cloudMat.uniforms.uO.value = calm ? 1 : Math.min(1, Math.max(0, (ti - .8) / 1.2));
    cloudGroup.children.forEach(c => { if(c.material.opacity !== undefined && c.isLineSegments) c.material.opacity = .55 * cloudMat.uniforms.uO.value; });
    if(playing){
      const k = Math.min(1, Math.max(0, (performance.now() - t0) / LAPSE));
      age = a0 + (a1 - a0) * k;
      if(k >= 1) playing = false;
    }
    if(play){ const label = playing ? '❚❚ Pause' : age >= a1 - .05 ? '↺ Replay the climb' : '▶ Play'; if(play.textContent !== label) play.textContent = label; }
    const prog = (age - a0) / Math.max(.001, a1 - a0);
    tube.geometry.setDrawRange(0, Math.floor(tube.geometry.index.count * Math.max(prog, calm ? 1 : 0)));
    const yNow = Y(at(p50, age)) + .06, xNow = X(age);
    you.position.set(xNow, yNow, 0);
    halo.scale.setScalar(1.4 + Math.sin(t * 3) * .12);
    beam.scale.y = Math.max(.001, yNow); beam.position.set(xNow, yNow / 2, 0);
    const reach = prog > .985;
    flag.scale.setScalar(THREE.MathUtils.lerp(flag.scale.x, reach ? 1 : .001, .08));
    cloth.rotation.y = Math.sin(t * 2.4) * .25;
    // SIP coins: rising from the floor under the marker into it, while there is still a SIP to pay
    for(let i = 0; i < COINS; i++){
      const u = (cph[i] + t * .35) % 1, ang = cph[i] * 40;
      cp[i * 3] = xNow + Math.cos(ang) * .35 * (1 - u); cp[i * 3 + 1] = yNow * u; cp[i * 3 + 2] = Math.sin(ang) * .35 * (1 - u);
    }
    cg.attributes.position.needsUpdate = true;
    coins.material.opacity = age < d.retireAge ? .9 : Math.max(0, coins.material.opacity - dt);
    /* the camera: a three-quarter view that drifts with the marker and leans with the pointer */
    px += (tx - px) * .05; py += (ty - py) * .05;
    const follow = THREE.MathUtils.clamp(xNow * .35, -W * .2, W * .2);
    const narrow = canvas.clientWidth / Math.max(1, canvas.clientHeight) < 1.4;
    cam.position.set(follow * (narrow ? .3 : 1) - 3.2 + px * 3, 6.4 - py * 1.5, narrow ? 19 : 13.2);
    cam.lookAt(follow * .6, HMAX * .38, 0);
    world.rotation.y = -.08 + px * .12;
    R.render(scene, cam);
    /* labels */
    world.updateMatrixWorld();
    const W2 = canvas.clientWidth, H2 = canvas.clientHeight;
    tags.forEach(({a, el}) => { V.set(X(a), 0, DEPTH / 2 + .35).applyMatrix4(world.matrixWorld).project(cam);
      el.style.transform = `translate(${((V.x + 1) / 2 * W2).toFixed(1)}px, ${((1 - V.y) / 2 * H2).toFixed(1)}px) translate(-50%, 0)`; });
    if(readout){
      V.set(xNow, yNow + .35, 0).applyMatrix4(world.matrixWorld).project(cam);
      // kept inside the stage, so it never runs off an edge at today or at retirement
      const rw = readout.offsetWidth / 2 + 8, rx = Math.min(W2 - rw, Math.max(rw, (V.x + 1) / 2 * W2));
      readout.style.transform = `translate(${rx.toFixed(1)}px, ${Math.max(readout.offsetHeight + 8, (1 - V.y) / 2 * H2).toFixed(1)}px) translate(-50%, -100%)`;
      const key = age.toFixed(1);
      if(key !== lastRead){
        lastRead = key;
        readout.innerHTML = d.readout(age, at(p50, age), at(p10, age), at(p90, age));
        if(slider && document.activeElement !== slider) slider.value = age;
      }
    }
  }
  requestAnimationFrame(frame);

  const api = {
    rebind,
    dispose(){ alive = false; io.disconnect(); removeEventListener('resize', resize); R.dispose(); geo.dispose(); tubeGeo.dispose(); live = null; },
  };
  live = {sig, canvas, api};
  return api;
}

window.LedgerSummit = {mount};
if(window.__summitPending){ const p = window.__summitPending; window.__summitPending = null; mount(p.box, p.data); }
