// ===== 场景：山林古寺 · 黑风山 =====
const World = (() => {
  const ARENA_R = 25, CORR_HX = 4.5, CORR_Z0 = 20, CORR_Z1 = 84;
  const ENTRY_Z = 21.5; // 进入此线（z 更小）且在圆场内即开战

  // ---------- 噪声与随机 ----------
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash2(x, y) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoiseP(x, y, p) { // 可平铺
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const m = (a) => p ? ((a % p) + p) % p : a;
    const a = hash2(m(xi), m(yi)), b = hash2(m(xi + 1), m(yi)), c = hash2(m(xi), m(yi + 1)), d = hash2(m(xi + 1), m(yi + 1));
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, o = 4, p = 0) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < o; i++) { s += a * vnoiseP(x * f, y * f, p ? p * f : 0); n += a; a *= 0.5; f *= 2; }
    return s / n;
  }
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // ---------- 可玩区域 ----------
  function playDist(x, z) {
    const dDisc = Math.max(0, Math.hypot(x, z) - ARENA_R);
    const dx = Math.max(0, Math.abs(x) - CORR_HX), dz = Math.max(0, CORR_Z0 - z, z - CORR_Z1);
    return Math.min(dDisc, Math.hypot(dx, dz));
  }
  function heightAt(x, z) {
    const d = playDist(x, z);
    if (d <= 1.2) return 0;
    const k = smooth(1.2, 16, d);
    const n = fbm(x * 0.018 + 50, z * 0.018 + 50, 4);
    return k * (2.5 + n * 18 + d * 0.16) + (fbm(x * 0.2, z * 0.2, 2) - 0.5) * 0.8 * k;
  }

  // ---------- 程序化纹理 ----------
  function canvasPair(size) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const b = document.createElement('canvas'); b.width = b.height = size;
    return [c, c.getContext('2d'), b, b.getContext('2d')];
  }
  function toTex(canvas, srgb, rep) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.encoding = THREE.sRGBEncoding;
    if (rep) t.repeat.set(rep[0], rep[1]);
    t.anisotropy = 8;
    return t;
  }
  function noiseFill(ctx, size, period, fn) {
    const img = ctx.createImageData(size, size), d = img.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const n = fbm(x / size * period, y / size * period, 5, period);
      const n2 = fbm(x / size * period * 2 + 7.7, y / size * period * 2 + 3.1, 3, period * 2);
      const [r, g, b] = fn(n, n2, x, y);
      const i = (y * size + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  function wrapRect(ctxs, x, y, w, h, size, fills) {
    for (const ox of [0, -size, size]) for (const oy of [0, -size, size]) {
      ctxs.forEach((c, i) => { c.fillStyle = fills[i]; c.fillRect(x + ox, y + oy, w, h); });
    }
  }
  function stoneSlabTex() {
    const S = 512, [c, cx, b, bx] = canvasPair(S), R = rng(11);
    noiseFill(cx, S, 8, (n, n2) => { const v = 92 + n * 70 + n2 * 20; return [v * 1.0, v * 0.97, v * 0.9]; });
    noiseFill(bx, S, 8, (n, n2) => { const v = 150 + n * 70 + n2 * 30; return [v, v, v]; });
    const rows = [96, 128, 80, 112, 96]; let y = 0;
    for (const rh of rows) {
      let x = R() * 120;
      const end = x + S;
      while (x < end) {
        const w = 90 + R() * 110, tone = (R() - 0.5) * 40;
        const a = Math.abs(tone) / 255;
        wrapRect([cx, bx], x, y, w, rh, S, [tone > 0 ? `rgba(255,245,225,${a * 1.6})` : `rgba(10,10,0,${a * 1.6})`, `rgba(${tone > 0 ? 255 : 0},${tone > 0 ? 255 : 0},${tone > 0 ? 255 : 0},${a})`]);
        // 灰缝
        wrapRect([cx, bx], x - 2, y, 4, rh, S, ['rgba(28,26,20,0.85)', 'rgba(0,0,0,1)']);
        if (R() < 0.35) { // 裂纹
          cx.strokeStyle = 'rgba(25,22,18,0.7)'; bx.strokeStyle = 'rgba(20,20,20,1)'; cx.lineWidth = bx.lineWidth = 1.5;
          let px = x + R() * w, py = y + R() * rh; cx.beginPath(); bx.beginPath(); cx.moveTo(px, py); bx.moveTo(px, py);
          for (let k = 0; k < 5; k++) { px += (R() - 0.5) * 40; py += (R() - 0.5) * 40; cx.lineTo(px, py); bx.lineTo(px, py); }
          cx.stroke(); bx.stroke();
        }
        x += w;
      }
      wrapRect([cx, bx], 0, y - 2, S, 4, S, ['rgba(28,26,20,0.85)', 'rgba(0,0,0,1)']);
      y += rh;
    }
    // 苔藓与落叶
    for (let i = 0; i < 260; i++) {
      const x = R() * S, yy = R() * S, r = 2 + R() * 10;
      cx.fillStyle = R() < 0.8 ? `rgba(${60 + R() * 30},${80 + R() * 30},${30},${0.12 + R() * 0.15})` : `rgba(${150 + R() * 60},${60 + R() * 40},20,0.5)`;
      cx.beginPath(); cx.ellipse(x, yy, r, r * 0.6, R() * 3, 0, 7); cx.fill();
    }
    return [toTex(c, true), toTex(b, false)];
  }
  function grassTex() {
    const S = 512, [c, cx, b, bx] = canvasPair(S), R = rng(5);
    noiseFill(cx, S, 6, (n, n2) => {
      const g = smooth(0.35, 0.65, n);
      const dirt = [96, 78, 54], grass = [66, 76, 40];
      const v = 0.75 + n2 * 0.5;
      return [(dirt[0] + (grass[0] - dirt[0]) * g) * v, (dirt[1] + (grass[1] - dirt[1]) * g) * v, (dirt[2] + (grass[2] - dirt[2]) * g) * v];
    });
    noiseFill(bx, S, 6, (n, n2) => { const v = 90 + n * 100 + n2 * 60; return [v, v, v]; });
    for (let i = 0; i < 700; i++) {
      const x = R() * S, y = R() * S, r = 1.5 + R() * 3.5, t = R();
      cx.fillStyle = t < 0.45 ? `rgba(${120 + R() * 50},${45 + R() * 35},${18},0.55)` : t < 0.8 ? `rgba(38,46,20,0.5)` : `rgba(95,88,76,0.35)`;
      cx.beginPath(); cx.ellipse(x, y, r * 1.6, r, R() * 3, 0, 7); cx.fill();
      bx.fillStyle = 'rgba(255,255,255,0.18)'; bx.beginPath(); bx.ellipse(x, y, r * 1.6, r, 0, 0, 7); bx.fill();
    }
    return [toTex(c, true), toTex(b, false)];
  }
  function barkTex() {
    const S = 256, [c, cx] = canvasPair(S);
    noiseFill(cx, S, 4, (n, n2, x, y) => {
      const s = fbm(x / S * 24, y / S * 3, 3, 0) * 0.6 + n * 0.4;
      const v = 40 + s * 70;
      return [v * 1.05, v * 0.82, v * 0.62];
    });
    return toTex(c, true);
  }
  function rockTex() {
    const S = 256, [c, cx, b, bx] = canvasPair(S);
    noiseFill(cx, S, 5, (n, n2) => {
      const m = smooth(0.58, 0.7, n2);
      const v = 70 + n * 80;
      return [v * (1 - m) + 62 * m, v * 0.98 * (1 - m) + 78 * m, v * 0.92 * (1 - m) + 38 * m];
    });
    noiseFill(bx, S, 5, (n, n2) => { const v = 60 + n * 150 + n2 * 40; return [v, v, v]; });
    return [toTex(c, true), toTex(b, false)];
  }
  function plasterTex() {
    const S = 512, [c, cx] = canvasPair(S), R = rng(3);
    noiseFill(cx, S, 6, (n, n2, x, y) => {
      const v = 0.75 + n * 0.45, st = smooth(0.6, 0.75, n2) * 0.35;
      return [128 * v * (1 - st) + 70 * st, 46 * v * (1 - st) + 45 * st, 36 * v * (1 - st) + 35 * st];
    });
    for (let i = 0; i < 9; i++) { // 剥落露出的砖
      const x = R() * S, y = R() * S, w = 26 + R() * 50, h = 18 + R() * 34;
      cx.fillStyle = 'rgb(92,86,80)'; cx.beginPath(); cx.ellipse(x, y, w / 2, h / 2, R(), 0, 7); cx.fill();
      cx.save(); cx.clip();
      cx.strokeStyle = 'rgba(40,36,32,0.7)'; cx.lineWidth = 1.2;
      for (let yy = y - h; yy < y + h; yy += 7) { cx.beginPath(); cx.moveTo(x - w, yy); cx.lineTo(x + w, yy); cx.stroke(); for (let xx = x - w + (Math.round(yy / 7) % 2) * 8; xx < x + w; xx += 16) { cx.beginPath(); cx.moveTo(xx, yy); cx.lineTo(xx, yy + 7); cx.stroke(); } }
      cx.restore();
    }
    for (let i = 0; i < 40; i++) { cx.fillStyle = `rgba(30,25,20,${0.05 + R() * 0.1})`; cx.fillRect(R() * S, 0, 2 + R() * 8, S); }
    return toTex(c, true);
  }
  function tileTex() {
    const S = 256, [c, cx] = canvasPair(S);
    noiseFill(cx, S, 4, (n, n2, x, y) => {
      const s = 0.55 + 0.45 * Math.abs(Math.sin(x / S * Math.PI * 16));
      const r = (y % 32) < 3 ? 0.6 : 1;
      const v = (38 + n * 40) * s * r + 10;
      return [v * 0.95, v, v * 1.05];
    });
    return toTex(c, true);
  }
  function woodTex() {
    const S = 256, [c, cx] = canvasPair(S);
    noiseFill(cx, S, 4, (n, n2, x, y) => {
      const w = smooth(0.62, 0.8, n2);
      const v = 0.7 + n * 0.5;
      return [(120 * v) * (1 - w) + 70 * w, (32 * v) * (1 - w) + 50 * w, (24 * v) * (1 - w) + 38 * w];
    });
    return toTex(c, true);
  }
  function plaqueTex() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 160;
    const x = c.getContext('2d');
    x.fillStyle = '#1b1410'; x.fillRect(0, 0, 512, 160);
    x.strokeStyle = '#b8862e'; x.lineWidth = 10; x.strokeRect(10, 10, 492, 140);
    x.fillStyle = '#d9a441'; x.font = 'bold 96px "STKaiti","KaiTi","Kaiti SC","Songti SC",serif';
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('黑 风 山', 256, 84);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
  }

  // ---------- 几何合并（世界坐标 UV） ----------
  const buckets = {};
  function addGeo(key, geo, m) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    // 按空间分块合并，便于视锥裁剪与镜头射线检测
    const ck = key + '|' + Math.floor(m.elements[12] / 22) + ',' + Math.floor(m.elements[14] / 22);
    (buckets[ck] = buckets[ck] || []).push(g);
  }
  function mat4(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
    return m;
  }
  const BOX = new THREE.BoxGeometry(1, 1, 1);
  function box(key, w, h, d, x, y, z, ry = 0, rx = 0, rz = 0) { addGeo(key, BOX, mat4(x, y, z, rx, ry, rz, w, h, d)); }
  function cyl(key, rt, rb, h, seg, x, y, z, ry = 0, sx = 1, sz = 1) { addGeo(key, new THREE.CylinderGeometry(rt, rb, h, seg), mat4(x, y, z, 0, ry, 0, sx, 1, sz)); }
  function roof(key, w, d, h, x, y, z, ry = 0, top = 0.28) {
    const g = new THREE.CylinderGeometry(top, 1, 1, 4, 1); g.rotateY(Math.PI / 4);
    const k = 1 / Math.SQRT1_2;
    addGeo(key, g, mat4(x, y, z, 0, ry, 0, w / 2 * k, h, d / 2 * k));
  }
  function mergeBucket(key, scale) {
    const list = buckets[key]; if (!list || !list.length) return null;
    let n = 0; list.forEach(g => n += g.attributes.position.count);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3();
    list.forEach(g => {
      const p = g.attributes.position.array, nn = g.attributes.normal.array, cnt = g.attributes.position.count;
      pos.set(p, o * 3); nor.set(nn, o * 3);
      for (let i = 0; i < cnt; i += 3) {
        a.fromArray(p, i * 3); b.fromArray(p, i * 3 + 3); c.fromArray(p, i * 3 + 6);
        fn.subVectors(c, b).cross(a.clone().sub(b)).normalize();
        const ax = Math.abs(fn.x), ay = Math.abs(fn.y), az = Math.abs(fn.z);
        for (let j = 0; j < 3; j++) {
          const vx = p[(i + j) * 3], vy = p[(i + j) * 3 + 1], vz = p[(i + j) * 3 + 2];
          let u, v;
          if (ay >= ax && ay >= az) { u = vx; v = vz; } else if (ax >= az) { u = vz; v = vy; } else { u = vx; v = vy; }
          uv[(o + i + j) * 2] = u * scale; uv[(o + i + j) * 2 + 1] = v * scale;
        }
      }
      o += cnt;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    return geo;
  }

  // ---------- 构建 ----------
  function build(scene) {
    const colliders = [];   // {x,z,r}
    const blockers = [];    // 镜头遮挡检测
    const R = rng(2026);

    const [slabC, slabB] = stoneSlabTex();
    const [grC, grB] = grassTex();
    const [rkC, rkB] = rockTex();
    const plaster = plasterTex(), tiles = tileTex(), wood = woodTex(), bark = barkTex();

    const M = {
      stone: new THREE.MeshStandardMaterial({ map: slabC, bumpMap: slabB, bumpScale: 0.6, roughness: 0.92, color: 0xb8b0a2 }),
      rough: new THREE.MeshStandardMaterial({ map: rkC, bumpMap: rkB, bumpScale: 0.8, roughness: 0.95, color: 0xb0aa9e }),
      plaster: new THREE.MeshStandardMaterial({ map: plaster, roughness: 0.92, color: 0xb09088 }),
      tile: new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.75, color: 0x9aa0a8, metalness: 0.05 }),
      wood: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.65, color: 0xffffff }),
      dark: new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.95 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xb8892f, roughness: 0.35, metalness: 0.9 }),
      glow: new THREE.MeshStandardMaterial({ color: 0xffc070, emissive: 0xff9a3a, emissiveIntensity: 2.2, roughness: 0.6 }),
    };
    slabC.repeat.set(1, 1);

    // --- 天空 ---
    const sunDir = new THREE.Vector3(-0.55, 0.32, -0.77).normalize();
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sunDir: { value: sunDir }, time: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position = p.xyww; }`,
      fragmentShader: `varying vec3 vDir; uniform vec3 sunDir; uniform float time;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fb(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=.5; } return s; }
        void main(){
          vec3 d = normalize(vDir); float y = d.y;
          vec3 hor = vec3(0.86,0.70,0.50), mid = vec3(0.62,0.62,0.62), zen = vec3(0.30,0.38,0.50), gnd = vec3(0.55,0.50,0.43);
          vec3 col = mix(hor, mid, smoothstep(0.0, 0.18, y));
          col = mix(col, zen, smoothstep(0.18, 0.75, y));
          col = mix(col, gnd, smoothstep(0.0, -0.12, y));
          float s = max(dot(d, sunDir), 0.);
          col += vec3(1.0,0.62,0.30) * pow(s, 6.) * 0.45 + vec3(1.0,0.85,0.6) * pow(s, 80.) * 0.6 + vec3(1.,.95,.85)*smoothstep(0.9993,0.9997,s)*2.0;
          if (y > 0.0) {
            vec2 uv = d.xz / (y + 0.12) * 1.6 + vec2(time*0.004, time*0.002);
            float c = smoothstep(0.48, 0.8, fb(uv));
            vec3 cc = mix(vec3(0.75,0.68,0.6), vec3(1.0,0.78,0.55), pow(s,3.));
            col = mix(col, cc, c * 0.55 * smoothstep(0.0, 0.25, y));
          }
          gl_FragColor = vec4(col, 1.);
        }`
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMat);
    sky.renderOrder = -10; sky.frustumCulled = false;
    scene.add(sky);

    // --- 地形 ---
    const TS = 520, TN = 200;
    const tg = new THREE.PlaneGeometry(TS, TS, TN, TN); tg.rotateX(-Math.PI / 2);
    const tp = tg.attributes.position, colors = new Float32Array(tp.count * 3);
    for (let i = 0; i < tp.count; i++) {
      const x = tp.getX(i), z = tp.getZ(i) + 10;
      tp.setZ(i, z);
      const h = heightAt(x, z); tp.setY(i, h);
      const d = playDist(x, z), k = smooth(0, 12, d), mn = fbm(x * 0.05, z * 0.05, 3);
      const cdirt = [0.62, 0.55, 0.45], cfor = [0.55 + mn * 0.2, 0.6, 0.42];
      colors[i * 3] = cdirt[0] + (cfor[0] - cdirt[0]) * k; colors[i * 3 + 1] = cdirt[1] + (cfor[1] - cdirt[1]) * k; colors[i * 3 + 2] = cdirt[2] + (cfor[2] - cdirt[2]) * k;
    }
    tg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    tg.computeVertexNormals();
    grC.repeat.set(70, 70); grB.repeat.set(70, 70);
    const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ map: grC, bumpMap: grB, bumpScale: 0.5, vertexColors: true, roughness: 0.97 }));
    terrain.receiveShadow = true; scene.add(terrain);

    // --- 石板地：Boss 场（圆）与通道（长条） ---
    const arenaTex = slabC.clone(); arenaTex.needsUpdate = true; arenaTex.repeat.set(9, 9);
    const arenaBump = slabB.clone(); arenaBump.needsUpdate = true; arenaBump.repeat.set(9, 9);
    const arenaFloor = new THREE.Mesh(new THREE.CircleGeometry(ARENA_R + 1.5, 72), new THREE.MeshStandardMaterial({ map: arenaTex, bumpMap: arenaBump, bumpScale: 0.7, roughness: 0.9, color: 0xc4bcae }));
    arenaFloor.rotation.x = -Math.PI / 2; arenaFloor.position.y = 0.03; arenaFloor.receiveShadow = true; scene.add(arenaFloor);
    // 中央八卦式圆纹
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x2e2b27, roughness: 0.9 });
    [[7.6, 8.2], [15.6, 16.0], [ARENA_R + 0.6, ARENA_R + 1.5]].forEach(([a, b]) => {
      const r = new THREE.Mesh(new THREE.RingGeometry(a, b, 72), ringMat); r.rotation.x = -Math.PI / 2; r.position.y = 0.045; r.receiveShadow = true; scene.add(r);
    });
    const corrTex = slabC.clone(); corrTex.needsUpdate = true; corrTex.repeat.set(1.6, 11);
    const corrBump = slabB.clone(); corrBump.needsUpdate = true; corrBump.repeat.set(1.6, 11);
    const corrFloor = new THREE.Mesh(new THREE.PlaneGeometry(CORR_HX * 2 + 0.6, CORR_Z1 - CORR_Z0 + 4), new THREE.MeshStandardMaterial({ map: corrTex, bumpMap: corrBump, bumpScale: 0.7, roughness: 0.92, color: 0xa8a090 }));
    corrFloor.rotation.x = -Math.PI / 2; corrFloor.position.set(0, 0.035, (CORR_Z0 + CORR_Z1) / 2 + 1); corrFloor.receiveShadow = true; scene.add(corrFloor);

    // --- 断墙 ---
    function wall(x0, z0, x1, z1, h, seed, broken = 0.4) {
      const r = rng(seed), dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), ang = Math.atan2(dx, dz);
      const ux = dx / L, uz = dz / L, T = 0.7, step = 0.9;
      const n = Math.max(1, Math.round(L / step)), st = L / n;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) * st, cx = x0 + ux * t, cz = z0 + uz * t;
        const bn = fbm(seed * 3.1 + i * 0.22, seed, 2);
        if (bn < 0.32 + broken * 0.1 && broken > 0.2) { // 缺口：碎石
          if (r() < 0.7) box('rough', 0.5 + r() * 0.6, 0.25 + r() * 0.4, 0.4 + r() * 0.5, cx + (r() - 0.5) * 1.2, 0.15, cz + (r() - 0.5) * 1.2, r() * 3, r() * 0.4, r() * 0.4);
          continue;
        }
        const intact = bn > 0.38 + broken * 0.35;
        const hi = intact ? h : h * (0.3 + r() * 0.55);
        box('rough', st + 0.01, 0.55, T + 0.2, cx, 0.275, cz, ang + Math.PI / 2);
        box('plaster', st + 0.01, hi - 0.55, T, cx, 0.55 + (hi - 0.55) / 2, cz, ang + Math.PI / 2);
        if (intact) {
          box('tile', st + 0.02, 0.2, T + 0.55, cx, hi + 0.08, cz, ang + Math.PI / 2);
          box('tile', st + 0.02, 0.16, 0.28, cx, hi + 0.26, cz, ang + Math.PI / 2);
        } else if (r() < 0.6) {
          box('plaster', 0.4 + r() * 0.4, 0.25, 0.35 + r() * 0.3, cx + (r() - 0.5) * 2, 0.12, cz + (r() - 0.5) * 2, r() * 3);
        }
      }
    }
    // 通道两侧
    wall(-5.6, 25.5, -5.6, 85, 3.1, 7, 0.45);
    wall(5.6, 25.5, 5.6, 85, 3.1, 13, 0.45);
    wall(-6, 86.8, 6, 86.8, 3.4, 21, 0.1);
    // Boss 场外圈（留出入口与寺前阶梯）
    const WR = ARENA_R + 2.6, segs = 26;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2, am = (a0 + a1) / 2;
      if (am < 0.42 || am > Math.PI * 2 - 0.42) continue; // 入口
      if (Math.abs(am - Math.PI) < 0.2) continue; // 寺前阶梯
      wall(Math.sin(a0) * WR, Math.cos(a0) * WR, Math.sin(a1) * WR, Math.cos(a1) * WR, 2.9 + (Math.abs(am - Math.PI) < 0.9 ? -0.8 : 0), 100 + i, 0.55);
    }

    // --- 牌坊（通道与 Boss 场分界） ---
    const GZ = 25.6;
    [-5.4, 5.4].forEach(x => {
      cyl('wood', 0.32, 0.36, 6.4, 12, x, 3.2, GZ);
      box('rough', 1.2, 0.9, 1.2, x, 0.45, GZ);
      box('rough', 0.5, 1.4, 1.6, x, 0.7, GZ);
    });
    box('wood', 12.4, 0.55, 0.5, 0, 5.4, GZ);
    box('wood', 13.2, 0.45, 0.45, 0, 6.3, GZ);
    roof('tile', 15, 2.6, 1.2, 0, 7.1, GZ);
    box('tile', 13.4, 0.25, 0.4, 0, 7.75, GZ);
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.0), new THREE.MeshStandardMaterial({ map: plaqueTex(), roughness: 0.6, metalness: 0.2 }));
    plaque.position.set(0, 5.85, GZ + 0.27); scene.add(plaque);
    const plaqueB = plaque.clone(); plaqueB.rotation.y = Math.PI; plaqueB.position.z = GZ - 0.27; scene.add(plaqueB);

    // --- 石灯 ---
    const lanternGlows = [];
    function lantern(x, z, collide = true) {
      box('rough', 0.95, 0.3, 0.95, x, 0.15, z);
      box('stone', 0.7, 0.2, 0.7, x, 0.4, z);
      cyl('stone', 0.17, 0.2, 1.0, 10, x, 1.0, z);
      box('stone', 0.85, 0.16, 0.85, x, 1.58, z);
      box('stone', 0.12, 0.55, 0.12, x - 0.28, 1.93, z - 0.28); box('stone', 0.12, 0.55, 0.12, x + 0.28, 1.93, z - 0.28);
      box('stone', 0.12, 0.55, 0.12, x - 0.28, 1.93, z + 0.28); box('stone', 0.12, 0.55, 0.12, x + 0.28, 1.93, z + 0.28);
      box('glow', 0.46, 0.42, 0.46, x, 1.92, z);
      roof('stone', 1.15, 1.15, 0.42, x, 2.42, z, 0, 0.12);
      addGeo('stone', new THREE.SphereGeometry(0.11, 8, 6), mat4(x, 2.72, z));
      lanternGlows.push(new THREE.Vector3(x, 1.92, z));
      if (collide) colliders.push({ x, z, r: 0.6 });
    }
    for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; lantern(Math.sin(a) * 22.5, Math.cos(a) * 22.5); }
    lantern(-3.8, 31); lantern(3.8, 52); lantern(-3.8, 68); lantern(3.8, 80);

    // --- 土地庙（检查点） ---
    const SH = { x: 3.7, z: 40 };
    box('rough', 1.7, 0.4, 1.5, SH.x, 0.2, SH.z);
    box('plaster', 1.4, 1.3, 1.2, SH.x + 0.1, 1.05, SH.z);
    box('dark', 0.1, 0.9, 0.8, SH.x - 0.56, 0.95, SH.z);
    roof('tile', 2.1, 1.8, 0.55, SH.x, 1.98, SH.z, 0, 0.2);
    cyl('stone', 0.28, 0.22, 0.45, 12, SH.x - 1.15, 0.225, SH.z);
    cyl('glow', 0.015, 0.015, 0.4, 4, SH.x - 1.15, 0.6, SH.z - 0.06); cyl('glow', 0.015, 0.015, 0.4, 4, SH.x - 1.15, 0.6, SH.z + 0.06); cyl('glow', 0.015, 0.015, 0.4, 4, SH.x - 1.15, 0.62, SH.z);
    colliders.push({ x: SH.x, z: SH.z, r: 1.05 }, { x: SH.x - 1.15, z: SH.z, r: 0.35 });

    // --- 古寺大殿（Boss 场北侧） ---
    const TZ = -40;
    box('rough', 34, 1.8, 18, 0, 0.9, TZ);
    for (let s = 0; s < 6; s++) box('stone', 6, (s + 1) * 0.3, 0.75, 0, (s + 1) * 0.15, -27.6 - s * 0.75);
    box('rough', 0.6, 1.9, 4.6, -3.3, 0.95, -29.5); box('rough', 0.6, 1.9, 4.6, 3.3, 0.95, -29.5);
    const colXs = [-12, -8.4, -4.2, 0, 4.2, 8.4, 12];
    colXs.forEach(x => { cyl('wood', 0.38, 0.42, 5.4, 14, x, 1.8 + 2.7, TZ + 6.2); box('rough', 1.0, 0.4, 1.0, x, 2.0, TZ + 6.2); });
    box('plaster', 27, 5.4, 0.7, 0, 1.8 + 2.7, TZ - 4.5);
    box('plaster', 0.7, 5.4, 10.6, -13.2, 1.8 + 2.7, TZ + 0.8); box('plaster', 0.7, 5.4, 10.6, 13.2, 1.8 + 2.7, TZ + 0.8);
    box('dark', 25.6, 4.6, 0.3, 0, 1.8 + 2.4, TZ + 3.0);
    for (let i = -4; i <= 4; i++) box('wood', 2.0, 3.6, 0.12, i * 2.6, 1.8 + 2.2, TZ + 3.2);
    box('wood', 28, 0.7, 0.8, 0, 7.5, TZ + 6.2);
    box('wood', 28, 0.5, 12, 0, 7.6, TZ + 0.8);
    box('gold', 28.2, 0.12, 0.84, 0, 7.15, TZ + 6.2);
    roof('tile', 34, 18, 2.3, 0, 9.0, TZ + 0.8, 0, 0.42);
    box('wood', 20, 1.2, 9, 0, 10.6, TZ + 0.8);
    roof('tile', 26, 13, 3.4, 0, 12.9, TZ + 0.8, 0, 0.18);
    box('tile', 16, 0.6, 0.6, 0, 14.6, TZ + 0.8);
    box('gold', 0.6, 1.4, 0.4, -8.2, 15.2, TZ + 0.8); box('gold', 0.6, 1.4, 0.4, 8.2, 15.2, TZ + 0.8);
    const plaque2 = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.25), plaque.material);
    plaque2.position.set(0, 9.5, TZ + 6.7); scene.add(plaque2);

    // --- 远处宝塔（山上） ---
    function pagoda(px, pz, tiers, base) {
      const py = heightAt(px, pz) - 0.5;
      box('rough', base * 1.4, 1.5, base * 1.4, px, py + 0.75, pz);
      let y = py + 1.5, w = base;
      for (let i = 0; i < tiers; i++) {
        const h = 2.6 - i * 0.12;
        box('plaster', w, h, w, px, y + h / 2, pz);
        roof('tile', w * 1.7, w * 1.7, 0.9, px, y + h + 0.4, pz, 0, 0.55);
        y += h + 0.8; w *= 0.86;
      }
      cyl('gold', 0.05, 0.25, 4, 8, px, y + 2, pz);
    }
    pagoda(-48, -78, 7, 5.5);
    pagoda(66, -120, 9, 7);

    // 合并静态几何
    const UVS = { stone: 0.5, rough: 0.45, plaster: 0.25, tile: 0.8, wood: 0.5, dark: 1, gold: 1, glow: 1 };
    Object.keys(buckets).forEach(ck => {
      const k = ck.split('|')[0];
      const g = mergeBucket(ck, UVS[k]); if (!g) return;
      const mesh = new THREE.Mesh(g, M[k]);
      mesh.castShadow = k !== 'glow'; mesh.receiveShadow = true;
      scene.add(mesh);
      if (k !== 'glow' && k !== 'gold') blockers.push(mesh);
    });

    // 灯光（少量点光源）
    const lights = [];
    [0, 2, 4, 6].forEach(i => {
      const p = lanternGlows[i]; const l = new THREE.PointLight(0xff9a48, 1.6, 11, 2);
      l.position.copy(p); scene.add(l); lights.push(l);
    });
    const shrineLight = new THREE.PointLight(0xff8a3a, 2.2, 8, 2); shrineLight.position.set(SH.x - 1.2, 1.0, SH.z); scene.add(shrineLight);
    const corrLight = new THREE.PointLight(0xff9a48, 1.4, 10, 2); corrLight.position.copy(lanternGlows[9]); scene.add(corrLight);

    // --- 岩石 ---
    const rockGeos = [];
    for (let v = 0; v < 5; v++) {
      const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position;
      const sx = 0.8 + R() * 0.6, sy = 0.55 + R() * 0.4, sz = 0.8 + R() * 0.5;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const n = fbm(x * 1.3 + v * 10 + z * 0.7, y * 1.3 + z * 1.1 - v * 4, 3);
        const s = 0.72 + n * 0.6;
        p.setXYZ(i, x * s * sx, Math.max(-0.35, y * s * sy), z * s * sz);
      }
      g.computeVertexNormals(); rockGeos.push(g);
    }
    function rock(x, z, s, collide) {
      const m = new THREE.Mesh(rockGeos[(R() * rockGeos.length) | 0], M.rough);
      const y = heightAt(x, z);
      m.position.set(x, y - s * 0.15, z); m.scale.setScalar(s); m.rotation.set(R() * 0.4, R() * 6.28, R() * 0.4);
      m.castShadow = m.receiveShadow = true; scene.add(m); blockers.push(m);
      if (collide) colliders.push({ x, z, r: s * 0.85 });
    }
    // 通道内零散岩石（可碰撞）
    [[-3.9, 44, 0.9], [4.0, 61, 1.0], [-4.1, 57, 0.7], [3.9, 73, 0.8], [-3.9, 77, 1.1], [4.1, 33, 0.75]].forEach(([x, z, s]) => rock(x, z, s, true));
    // 场边岩石
    for (let i = 0; i < 9; i++) {
      const a = 0.6 + R() * (Math.PI * 2 - 1.2); if (Math.abs(a - Math.PI) < 0.35) continue;
      const r = ARENA_R - 0.6 + R() * 0.8;
      rock(Math.sin(a) * r, Math.cos(a) * r, 0.9 + R() * 0.7, true);
    }
    // 外圈大石
    for (let i = 0; i < 70; i++) {
      const x = (R() - 0.5) * 220, z = (R() - 0.5) * 220 + 20;
      const d = playDist(x, z); if (d < 3 || (Math.abs(x) < 20 && z < -28 && z > -52)) continue;
      rock(x, z, 1.2 + R() * 3.5 * Math.min(1, d / 20), false);
    }
    // 通道外侧岩壁感
    for (let z = 28; z < 86; z += 3.2) {
      rock(-7.5 - R() * 2, z + R(), 1.6 + R() * 1.6, false);
      rock(7.5 + R() * 2, z + R(), 1.6 + R() * 1.6, false);
    }

    // --- 树木（实例化） ---
    const NT = 420;
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 1, 7); trunkGeo.translate(0, 0.5, 0);
    const coneGeo = new THREE.ConeGeometry(1, 1, 9); coneGeo.translate(0, 0.5, 0);
    const blobGeo = new THREE.IcosahedronGeometry(1, 1);
    { const p = blobGeo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const s = 0.8 + fbm(x * 2 + 3, y * 2 + z * 2, 2) * 0.45; p.setXYZ(i, x * s, y * s * 0.85, z * s); } blobGeo.computeVertexNormals(); }
    const barkMat = new THREE.MeshStandardMaterial({ map: bark, roughness: 0.95 });
    const pineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
    const trunks = new THREE.InstancedMesh(trunkGeo, barkMat, NT);
    const cones = new THREE.InstancedMesh(coneGeo, pineMat, NT * 4);
    const blobs = new THREE.InstancedMesh(blobGeo, leafMat, NT * 6);
    let nt = 0, nc = 0, nb = 0;
    const dm = new THREE.Object3D(), col = new THREE.Color();
    function placeTree(x, z, big) {
      const y = heightAt(x, z) - 0.2, pine = R() < 0.5, s = (0.8 + R() * 0.7) * (big || 1);
      const th = pine ? 7 * s : 4.5 * s;
      dm.position.set(x, y, z); dm.rotation.set((R() - 0.5) * 0.08, R() * 6.28, (R() - 0.5) * 0.08); dm.scale.set(s * (pine ? 1 : 1.3), th, s * (pine ? 1 : 1.3)); dm.updateMatrix();
      trunks.setMatrixAt(nt++, dm.matrix);
      if (pine) {
        for (let k = 0; k < 4; k++) {
          const ky = y + th * (0.32 + k * 0.17), kr = s * (2.4 - k * 0.48), kh = s * (2.6 - k * 0.25);
          dm.position.set(x, ky, z); dm.rotation.set(0, R() * 6, 0); dm.scale.set(kr, kh, kr); dm.updateMatrix();
          cones.setMatrixAt(nc, dm.matrix);
          col.setHSL(0.27 + R() * 0.06, 0.32 + R() * 0.15, 0.13 + R() * 0.07); cones.setColorAt(nc++, col);
        }
      } else {
        const hue = R(); // 秋色
        for (let k = 0; k < 6; k++) {
          const a = R() * 6.28, rr = s * (k === 0 ? 0 : 1.2 + R() * 0.8);
          dm.position.set(x + Math.cos(a) * rr, y + th + s * (0.6 + R() * 1.6), z + Math.sin(a) * rr);
          const bs = s * (1.4 + R() * 0.9); dm.scale.set(bs, bs, bs); dm.rotation.set(R(), R(), R()); dm.updateMatrix();
          blobs.setMatrixAt(nb, dm.matrix);
          if (hue < 0.45) col.setHSL(0.02 + R() * 0.05, 0.6 + R() * 0.2, 0.28 + R() * 0.1);
          else if (hue < 0.75) col.setHSL(0.08 + R() * 0.04, 0.6 + R() * 0.2, 0.33 + R() * 0.1);
          else col.setHSL(0.2 + R() * 0.06, 0.35, 0.22 + R() * 0.08);
          blobs.setColorAt(nb++, col);
        }
      }
    }
    let tries = 0;
    while (nt < NT && tries++ < 6000) {
      const x = (R() - 0.5) * 300, z = (R() - 0.5) * 300 + 25;
      const d = playDist(x, z);
      if (d < 3.2 || d > 130) continue;
      if (Math.abs(x) < 20 && z < -26 && z > -54) continue;
      if (Math.hypot(x + 48, z + 78) < 9 || Math.hypot(x - 66, z + 120) < 11) continue;
      if (d > 35 && R() < 0.45) continue;
      placeTree(x, z, d < 10 ? 1.15 : 1);
    }
    trunks.count = nt; cones.count = nc; blobs.count = nb;
    [trunks, cones, blobs].forEach(m => { m.castShadow = true; m.receiveShadow = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; scene.add(m); });
    blockers.push(trunks);

    // --- 远山（层叠剪影） ---
    function ridge(radius, base, amp, colTop, colBot, seed, freq) {
      const N = 220, pos = [], cols = [], idx = [];
      const ct = new THREE.Color(colTop), cb = new THREE.Color(colBot);
      for (let i = 0; i <= N; i++) {
        const a = i / N * Math.PI * 2;
        const nn = fbm(Math.cos(a) * freq + seed, Math.sin(a) * freq + seed, 5);
        const peak = Math.pow(nn, 1.8) * amp * 1.8 + base;
        const cx = Math.sin(a) * radius, cz = Math.cos(a) * radius + 20;
        pos.push(cx, -30, cz, cx * 0.985, peak, cz * 0.985 + 0.3);
        cols.push(cb.r, cb.g, cb.b, ct.r, ct.g, ct.b);
        if (i < N) { const j = i * 2; idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide, depthWrite: true }));
      m.renderOrder = -5; scene.add(m);
    }
    ridge(560, 30, 150, 0x9a9a92, 0xc7b496, 11, 2.2);
    ridge(430, 20, 120, 0x7c8582, 0xbca88a, 23, 2.6);
    ridge(320, 12, 85, 0x56625d, 0xae9a7e, 37, 3.1);
    ridge(240, 6, 55, 0x3d4a40, 0xa08e74, 51, 3.6);

    // --- 雾门（战斗开始后封闭入口） ---
    const mistMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 }, op: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec2 vUv; uniform float time; uniform float op;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){ vec2 p = vUv*vec2(6.,3.); float v = n(p+vec2(0.,-time*0.6))*0.6 + n(p*2.3+vec2(time*0.3,-time))*0.4;
          float edge = smoothstep(0.,0.15,vUv.x)*smoothstep(1.,0.85,vUv.x)*smoothstep(1.,0.6,vUv.y);
          vec3 c = mix(vec3(0.9,0.6,0.25), vec3(1.0,0.9,0.7), v);
          gl_FragColor = vec4(c, v*edge*op*0.8); }`
    });
    const mist = new THREE.Mesh(new THREE.PlaneGeometry(CORR_HX * 2 + 1, 5.5), mistMat);
    mist.position.set(0, 2.75, 24.2); mist.visible = false; scene.add(mist);

    // --- 落叶与浮尘 ---
    const NL = 420, lp = new Float32Array(NL * 3), lc = new Float32Array(NL * 3), lv = [];
    for (let i = 0; i < NL; i++) {
      lp[i * 3] = (R() - 0.5) * 60; lp[i * 3 + 1] = R() * 14; lp[i * 3 + 2] = (R() - 0.5) * 60;
      const t = R(); col.setHSL(t < 0.6 ? 0.03 + R() * 0.06 : 0.12, 0.7, t < 0.85 ? 0.38 : 0.75);
      if (t >= 0.85) col.setRGB(1.0, 0.85, 0.55);
      lc[i * 3] = col.r; lc[i * 3 + 1] = col.g; lc[i * 3 + 2] = col.b;
      lv.push({ s: 0.4 + R() * 0.8, ph: R() * 6.28, dust: t >= 0.85 });
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3)); lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
    const leafPts = new THREE.Points(lg, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    leafPts.frustumCulled = false; scene.add(leafPts);

    function update(t, dt, focus, fightActive) {
      skyMat.uniforms.time.value = t;
      mistMat.uniforms.time.value = t;
      const target = fightActive ? 1 : 0;
      mistMat.uniforms.op.value += (target - mistMat.uniforms.op.value) * Math.min(1, dt * 2);
      mist.visible = mistMat.uniforms.op.value > 0.01;
      for (let i = 0; i < NL; i++) {
        const v = lv[i]; let x = lp[i * 3], y = lp[i * 3 + 1], z = lp[i * 3 + 2];
        if (v.dust) { y += Math.sin(t * 0.7 + v.ph) * 0.004; x += Math.cos(t * 0.5 + v.ph) * 0.004; }
        else { y -= v.s * dt * 0.9; x += (Math.sin(t * 1.3 + v.ph) * 0.6 + 0.3) * dt; z += Math.cos(t * 0.9 + v.ph) * 0.4 * dt; }
        const dx = x - focus.x, dz = z - focus.z;
        if (y < 0.05 || Math.abs(dx) > 30 || Math.abs(dz) > 30) {
          x = focus.x + (Math.random() - 0.5) * 58; z = focus.z + (Math.random() - 0.5) * 58; y = v.dust ? 0.5 + Math.random() * 4 : 8 + Math.random() * 7;
        }
        lp[i * 3] = x; lp[i * 3 + 1] = y; lp[i * 3 + 2] = z;
      }
      lg.attributes.position.needsUpdate = true;
      lights.forEach((l, i) => l.intensity = 1.5 + Math.sin(t * 9 + i * 2) * 0.12 + Math.sin(t * 23 + i) * 0.08);
      shrineLight.intensity = 2.0 + Math.sin(t * 7) * 0.25;
    }

    // 区域约束：自由模式＝圆场∪通道；战斗模式＝仅圆场
    function constrain(p, rad, arenaOnly) {
      const R2 = ARENA_R - rad, hx = CORR_HX - rad, z1 = CORR_Z1 + 1.2 - rad;
      const d = Math.hypot(p.x, p.z);
      const inDisc = d <= R2;
      const inRect = !arenaOnly && Math.abs(p.x) <= hx && p.z >= CORR_Z0 && p.z <= z1;
      if (!inDisc && !inRect) {
        let bx = p.x, bz = p.z, bd = Infinity;
        if (d > 0.0001) { const k = R2 / d; const cx = p.x * k, cz = p.z * k; bd = Math.hypot(cx - p.x, cz - p.z); bx = cx; bz = cz; }
        if (!arenaOnly) {
          const cx = Math.max(-hx, Math.min(hx, p.x)), cz = Math.max(CORR_Z0, Math.min(z1, p.z));
          const dd = Math.hypot(cx - p.x, cz - p.z); if (dd < bd) { bd = dd; bx = cx; bz = cz; }
        }
        p.x = bx; p.z = bz;
      }
      for (const c of colliders) {
        const dx = p.x - c.x, dz = p.z - c.z, dd = Math.hypot(dx, dz), m = c.r + rad;
        if (dd < m && dd > 0.0001) { p.x = c.x + dx / dd * m; p.z = c.z + dz / dd * m; }
      }
    }

    return {
      update, constrain, heightAt, blockers, colliders, sunDir, mist,
      shrine: SH, checkpoint: new THREE.Vector3(0, 0, 37), spawn: new THREE.Vector3(0, 0, 80),
      bossHome: new THREE.Vector3(0, 0, -14), ARENA_R, ENTRY_Z,
      inArena: (p) => Math.hypot(p.x, p.z) < ARENA_R - 0.3 && p.z < ENTRY_Z,
    };
  }
  return { build };
})();
