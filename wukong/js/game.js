// ===== 黑神话：悟空 · 黑风山 Boss 战 =====
(() => {
  const $ = (id) => document.getElementById(id);
  const V3 = THREE.Vector3;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
  const turnTo = (cur, tgt, step) => cur + clamp(angDiff(cur, tgt), -step, step);
  const fwdOf = (a) => new V3(Math.sin(a), 0, Math.cos(a));
  const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const ease = Chars.ease;
  const rad = (d) => d * Math.PI / 180;

  // ---------- 渲染器 ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('game').appendChild(renderer.domElement);
  const canvas = renderer.domElement;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xae9c80, 0.0098);
  const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 2000);

  const WORLDS = { heifeng: World.build(scene), sea: SeaWorld.build(scene) };
  WORLDS.heifeng.group = WORLDS.heifeng.group || null;
  let world = WORLDS.heifeng;
  // 黑风山场景物体（World.build 直接加到 scene 上）：记录下来以便切换时隐藏
  const heifengObjs = scene.children.filter(o => o !== WORLDS.sea.group);
  // 环境光照（IBL）：每个关卡一张天光环境图，让金属/冰晶正确反射天色
  const ENVS = {};
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const mk = (sunDir, hor, zen, gnd, sunC) => {
      const envScene = new THREE.Scene();
      const envMat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, uniforms: { sunDir: { value: sunDir }, hor: { value: new THREE.Color(...hor) }, zen: { value: new THREE.Color(...zen) }, gnd: { value: new THREE.Color(...gnd) }, sunC: { value: new THREE.Color(...sunC) } },
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
        fragmentShader: `varying vec3 vDir; uniform vec3 sunDir; uniform vec3 hor; uniform vec3 zen; uniform vec3 gnd; uniform vec3 sunC; void main(){ vec3 d = normalize(vDir); float y = d.y;
          vec3 c = mix(hor, zen, smoothstep(0.0, 0.7, y)); c = mix(c, gnd, smoothstep(0.02, -0.2, y));
          float s = max(dot(d, sunDir), 0.); c += sunC * pow(s, 12.) * 1.2 + sunC*pow(s,200.)*6.;
          gl_FragColor = vec4(c, 1.); }`,
      });
      envScene.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), envMat));
      return pmrem.fromScene(envScene, 0.03).texture;
    };
    ENVS.heifeng = mk(WORLDS.heifeng.sunDir, [0.72, 0.45, 0.22], [0.09, 0.14, 0.24], [0.10, 0.08, 0.06], [1.0, 0.6, 0.3]);
    ENVS.sea = mk(WORLDS.sea.sunDir, [0.45, 0.58, 0.62], [0.08, 0.14, 0.22], [0.02, 0.08, 0.10], [0.9, 0.95, 1.0]);
    scene.environment = ENVS.heifeng;
  }
  const hemi = new THREE.HemisphereLight(0xffe0b5, 0x3a3226, 0.35); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd29a, 2.1);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 220;
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
  scene.add(sun); scene.add(sun.target);
  const fill = new THREE.DirectionalLight(0x8fa6c8, 0.35); fill.position.set(40, 30, 60); scene.add(fill);

  // ---------- 状态 ----------
  const G = {
    mode: 'title', paused: false, fight: false, fightT: 0, hits: 0, perfects: 0, gourdUsed: 0, attempts: 1,
    slowT: 0, slowScale: 1, hitStop: 0, shake: 0, lock: false, checkpointLit: false, noLock: false, t: 0, bossDefeated: false,
  };
  const PR = 0.42, PERFECT_WIN = 0.25; let BR = 1.25;

  const P = {
    rig: null, pos: world.spawn.clone(), facing: Math.PI, hp: 300, maxHp: 300, hpTrail: 300,
    st: 100, maxSt: 100, stDelay: 0, exhausted: false, state: 'idle', t: 0, combo: 0, comboTimer: 0, queued: false,
    atk: null, hitDone: false, charge: 0, level: 0, gourds: 4, maxGourds: 4, spellCD: 0, spellMax: 22,
    invuln: 0, dodgeDir: new V3(), sprinting: false, ph: 0, pose: Chars.zeroPose(), knock: new V3(), hurtDur: 0.4,
    healed: false, cast: false, stepT: 0, tiredT: 0,
    y: 0, vy: 0, vel: new V3(), rollDir: new V3(0, 0, 1), rollFace: 0, rollSpeed: 10, rollAir: false, backstep: false, flipAng: 0, flipBase: 0, flipEnd: 0,
  };
  // ---------- 可选角色 ----------
  const CHARS = {
    wukong: { id: 'wukong', name: '天命人', title: '悟空', game: '黑神话：悟空', spell: '定身术', spellChar: '定', banner: '定！', trail: 0xffcf7a, jumpV: 8.4, speedMul: 1, glide: false, tint: [0.55, 0.4, 0.08], ring: 0xffd070 },
    nezha: { id: 'nezha', name: '哪吒', title: '哪吒', game: '黑神话：哪吒', spell: '混天绫·缚', spellChar: '缚', banner: '缚！', trail: 0xff5a20, jumpV: 9.8, speedMul: 1.12, glide: true, tint: [0.4, 0.05, 0.02], ring: 0xff3a20 },
  };
  const rigs = { wukong: Chars.buildPlayer(), nezha: Chars.buildNezha() };
  let CH = CHARS.wukong;
  P.rig = rigs.wukong; scene.add(P.rig.root, P.rig.fx);
  // Boss 定义：同一套 AI/预警框架，不同外观、名字、配色与二阶段表现
  const BOSS_DEF = {
    heifeng: { name: '黑风大王', sub: '黑风山 · 观音禅院旧址', p2Name: '黑风大王 · 怒焰现形', p2Tag: '· 贰 · 怒焰', p2Msg: '黑风大王习得新招：烈焰震地 · 连环突进 · 焚风横扫',
      tele: [0xe8200c, 0xff4a00], p2Color: 0xff5a10, fxCols: [[1, 0.45, 0.05], [1, 0.8, 0.3]], hp: 1800, br: 1.25, chest: 2.3, camR: 1.9, lockY: 2.6, roarFx: 0xbfa888, hazard: 'fire', speed: [3.6, 4.6] },
    sea: { name: '东海三太子 · 敖丙', sub: '东海 · 镇海台', p2Name: '敖丙 · 龙化 · 万龙甲', p2Tag: '· 贰 · 龙化', p2Msg: '敖丙龙化：冰棱震地 · 寒潮连突 · 万龙甲横扫',
      tele: [0xe8200c, 0xff4a00], p2Color: 0x6ae8ff, teleEdge: 0x8af0ff, fxCols: [[0.55, 0.95, 1], [0.85, 1, 1]], hp: 2000, br: 1.2, chest: 3.3, camR: 2.0, lockY: 3.8, roarFx: 0x8ad8ff, hazard: 'ice', speed: [4.0, 5.2] },
  };
  const bossRigs = { heifeng: Chars.buildBoss(), sea: Chars.buildAoBing() };
  let BD = BOSS_DEF.heifeng;
  const B = {
    rig: bossRigs.heifeng, pos: world.bossHome.clone(), facing: 0, hp: 1800, maxHp: 1800, hpTrail: 1800, phase: 1,
    state: 'dormant', t: 0, atk: null, cd: 1.5, freeze: 0, poise: 0, poiseMax: 130, poiseT: 0, flash: 0, alive: true,
    pose: Chars.zeroPose(), spin: 0, lift: 0, tilt: 0, ph: 0, strafe: 1, strafeT: 0, last: [], tele: null, aura: 0, dissolve: 0,
  };
  scene.add(B.rig.root);
  // 锁定目标：Boss 或小怪（拥有 pos/alive 字段的对象）
  let LT = null;
  const lockAlive = () => G.lock && LT && LT.alive;
  const lockPos = () => LT.pos;

  // ---------- 特效：粒子 ----------
  class Particles {
    constructor(max, additive) {
      this.max = max; this.n = 0;
      this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
      this.c = new Float32Array(max * 3); this.s = new Float32Array(max); this.a = new Float32Array(max);
      this.life = new Float32Array(max); this.ml = new Float32Array(max); this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
      this.g = new Float32Array(max); this.dr = new Float32Array(max);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
      geo.setAttribute('pcolor', new THREE.BufferAttribute(this.c, 3));
      geo.setAttribute('psize', new THREE.BufferAttribute(this.s, 1));
      geo.setAttribute('palpha', new THREE.BufferAttribute(this.a, 1));
      this.geo = geo;
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        vertexShader: `attribute vec3 pcolor; attribute float psize; attribute float palpha; varying vec3 vc; varying float va;
          void main(){ vc = pcolor; va = palpha; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = psize * 320. / -mv.z; gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `varying vec3 vc; varying float va; void main(){ float d = length(gl_PointCoord-.5); float a = smoothstep(.5, .05, d)*va; if(a<0.01) discard; gl_FragColor = vec4(vc, a); }`,
      });
      this.pts = new THREE.Points(geo, mat); this.pts.frustumCulled = false; scene.add(this.pts);
    }
    emit(pos, o) {
      const cnt = o.count || 10;
      for (let k = 0; k < cnt; k++) {
        if (this.n >= this.max) return;
        const i = this.n++;
        const sp = (o.speed || 3) * (0.4 + Math.random() * 0.8);
        let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
        if (o.dir) { dx = o.dir.x + dx * (o.spread ?? 0.5); dy = o.dir.y + dy * (o.spread ?? 0.5); dz = o.dir.z + dz * (o.spread ?? 0.5); }
        const l = Math.hypot(dx, dy, dz) || 1;
        const r = o.radius || 0;
        this.p[i * 3] = pos.x + (Math.random() - 0.5) * r; this.p[i * 3 + 1] = pos.y + (Math.random() - 0.5) * r * (o.flat ? 0.1 : 1); this.p[i * 3 + 2] = pos.z + (Math.random() - 0.5) * r;
        this.v[i * 3] = dx / l * sp; this.v[i * 3 + 1] = dy / l * sp + (o.up || 0); this.v[i * 3 + 2] = dz / l * sp;
        const col = o.colors ? o.colors[(Math.random() * o.colors.length) | 0] : (o.color || [1, 0.8, 0.4]);
        this.c[i * 3] = col[0]; this.c[i * 3 + 1] = col[1]; this.c[i * 3 + 2] = col[2];
        this.ml[i] = this.life[i] = (o.life || 0.6) * (0.6 + Math.random() * 0.6);
        this.s0[i] = (o.size || 0.15) * (0.6 + Math.random() * 0.8); this.s1[i] = o.sizeEnd ?? this.s0[i] * 0.3;
        this.g[i] = o.gravity ?? 0; this.dr[i] = o.drag ?? 1.5;
        this.a[i] = o.alpha ?? 1;
      }
    }
    update(dt) {
      let i = 0;
      while (i < this.n) {
        this.life[i] -= dt;
        if (this.life[i] <= 0) { this.swap(i, --this.n); continue; }
        const f = Math.exp(-this.dr[i] * dt);
        this.v[i * 3] *= f; this.v[i * 3 + 1] = this.v[i * 3 + 1] * f - this.g[i] * dt; this.v[i * 3 + 2] *= f;
        this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
        if (this.p[i * 3 + 1] < 0.03) { this.p[i * 3 + 1] = 0.03; this.v[i * 3 + 1] *= -0.3; }
        const u = 1 - this.life[i] / this.ml[i];
        this.s[i] = lerp(this.s0[i], this.s1[i], u);
        this.a[i] = (u < 0.1 ? u / 0.1 : 1 - (u - 0.1) / 0.9);
        i++;
      }
      this.geo.setDrawRange(0, this.n);
      ['position', 'pcolor', 'psize', 'palpha'].forEach(k => this.geo.attributes[k].needsUpdate = true);
    }
    swap(i, j) {
      for (const arr of [this.p, this.v, this.c]) { arr[i * 3] = arr[j * 3]; arr[i * 3 + 1] = arr[j * 3 + 1]; arr[i * 3 + 2] = arr[j * 3 + 2]; }
      for (const arr of [this.s, this.a, this.life, this.ml, this.s0, this.s1, this.g, this.dr]) arr[i] = arr[j];
    }
    clear() { this.n = 0; }
  }
  const FX = new Particles(2500, true);
  const SMOKE = new Particles(1200, false);

  // 武器拖尾
  class Trail {
    constructor(color, life = 0.16, N = 16) {
      this.N = N; this.life = life; this.samples = []; this.active = false;
      this.pos = new Float32Array(N * 2 * 3); this.al = new Float32Array(N * 2);
      const idx = [];
      for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('tal', new THREE.BufferAttribute(this.al, 1)); g.setIndex(idx);
      this.geo = g;
      this.mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: { col: { value: new THREE.Color(color) }, k: { value: 1 } },
        vertexShader: `attribute float tal; varying float va; void main(){ va = tal; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
        fragmentShader: `uniform vec3 col; uniform float k; varying float va; void main(){ gl_FragColor = vec4(col*k, va*0.85); }`,
      });
      this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; scene.add(this.mesh);
    }
    update(dt, a, b) {
      this.samples.forEach(s => s.age += dt);
      if (this.active) this.samples.unshift({ a: a.clone(), b: b.clone(), age: 0 });
      this.samples = this.samples.filter(s => s.age < this.life).slice(0, this.N);
      const n = this.samples.length;
      for (let i = 0; i < n; i++) {
        const s = this.samples[i], f = (1 - s.age / this.life) * (1 - i / this.N);
        s.a.toArray(this.pos, i * 6); s.b.toArray(this.pos, i * 6 + 3);
        this.al[i * 2] = f; this.al[i * 2 + 1] = f * 0.15;
      }
      this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
      this.geo.attributes.position.needsUpdate = true; this.geo.attributes.tal.needsUpdate = true;
    }
  }
  const pTrail = new Trail(0xffcf7a, 0.15);
  const bTrail = new Trail(0xff5a2a, 0.2);

  // 地面效果（冲击波、灼痕）
  const effects = [];
  function shockwave(pos, color = 0xffd08a, maxR = 4, life = 0.5, opacity = 0.8) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(pos.x, 0.12, pos.z); scene.add(m);
    effects.push({ t: 0, life, update(u) { const r = 0.5 + maxR * ease(u); m.scale.set(r, r, r); m.material.opacity = opacity * (1 - u); }, dispose() { scene.remove(m); m.geometry.dispose(); m.material.dispose(); } });
  }
  function vRing(pos, color, maxR, life, h = 3) { // 立体光环（定身、转阶段）
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, h, 48, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(pos.x, h / 2, pos.z); scene.add(m);
    effects.push({ t: 0, life, update(u) { const r = 0.5 + maxR * ease(u); m.scale.set(r, 1 - u * 0.5, r); m.material.opacity = 0.6 * (1 - u); }, dispose() { scene.remove(m); m.geometry.dispose(); m.material.dispose(); } });
  }
  function ghost() { // 完美闪避残影
    const g = P.rig.model.clone(true);
    const mat = new THREE.MeshBasicMaterial({ color: 0x7fe8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    g.traverse(o => { if (o.isMesh) { o.material = mat; o.castShadow = false; } });
    const holder = new THREE.Group(); holder.position.copy(P.rig.root.position); holder.rotation.copy(P.rig.root.rotation); holder.add(g); scene.add(holder);
    effects.push({ t: 0, life: 0.7, update(u) { mat.opacity = 0.55 * (1 - u); holder.scale.setScalar(1 + u * 0.08); }, dispose() { scene.remove(holder); mat.dispose(); } });
  }
  function updateEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i]; e.t += dt; const u = e.t / e.life;
      if (u >= 1) { e.dispose(); effects.splice(i, 1); } else e.update(u);
    }
  }
  // 星形闪光（Boss 出招预兆）
  const glintTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.15, 'rgba(255,170,90,0.9)'); g.addColorStop(1, 'rgba(255,60,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    x.fillStyle = 'rgba(255,240,220,0.9)'; x.beginPath(); x.moveTo(64, 0); x.lineTo(70, 58); x.lineTo(128, 64); x.lineTo(70, 70); x.lineTo(64, 128); x.lineTo(58, 70); x.lineTo(0, 64); x.lineTo(58, 58); x.fill();
    return new THREE.CanvasTexture(c);
  })();
  const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: 0 }));
  glint.scale.set(1.6, 1.6, 1); scene.add(glint);

  // ---------- 危险区域预兆 ----------
  function makeTele(kind, prm) {
    const g = new THREE.Group(); let geo, edgeGeo;
    const color = B.phase === 2 ? BD.tele[1] : BD.tele[0];
    if (kind === 'cone') {
      const a = rad(prm.arc), s = -Math.PI / 2 - a / 2;
      geo = new THREE.RingGeometry(0.4, prm.range, 48, 1, s, a); edgeGeo = new THREE.RingGeometry(prm.range - 0.14, prm.range, 48, 1, s, a);
    } else if (kind === 'circle') {
      geo = new THREE.CircleGeometry(prm.radius, 56); edgeGeo = new THREE.RingGeometry(prm.radius - 0.16, prm.radius, 56);
    } else {
      geo = new THREE.PlaneGeometry(prm.width, prm.len); geo.translate(0, -prm.len / 2, 0);
      edgeGeo = new THREE.PlaneGeometry(prm.width, 0.2); edgeGeo.translate(0, -prm.len + 0.1, 0);
    }
    const mk = (op) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const base = new THREE.Mesh(geo, mk(0.3)), fillM = new THREE.Mesh(geo, mk(0.55)), edge = new THREE.Mesh(edgeGeo, mk(0.95));
    if (BD.teleEdge) edge.material.color.setHex(BD.teleEdge);
    [base, fillM, edge].forEach((m, i) => { m.rotation.x = -Math.PI / 2; m.position.y = 0.07 + i * 0.004; m.renderOrder = 2; g.add(m); });
    if (kind === 'line') { // 两侧边线
      [-1, 1].forEach(sd => { const sg = new THREE.PlaneGeometry(0.14, prm.len); sg.translate(sd * (prm.width / 2 - 0.07), -prm.len / 2, 0); const m = new THREE.Mesh(sg, mk(0.6)); m.rotation.x = -Math.PI / 2; m.position.y = 0.08; g.add(m); });
    }
    scene.add(g);
    return {
      g, kind,
      set(p, danger) {
        if (kind === 'line') fillM.scale.set(1, Math.max(0.001, p), 1); else fillM.scale.set(Math.max(0.001, p), Math.max(0.001, p), 1);
        const pulse = danger ? 0.5 + 0.5 * Math.sin(G.t * 40) : 0;
        fillM.material.opacity = 0.38 + pulse * 0.3; edge.material.opacity = 0.75 + pulse * 0.25;
        if (danger) fillM.material.color.setHex(pulse > 0.5 ? 0xffd0a0 : color); else fillM.material.color.setHex(color);
      },
      dispose() { scene.remove(g); g.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); },
    };
  }
  function clearTele() { if (B.tele) { B.tele.dispose(); B.tele = null; } }

  // 火环危险物（第二阶段）
  const hazards = [];
  const flameMat = () => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, op: { value: 1 }, ice: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec2 vUv; uniform float time; uniform float op; uniform float ice;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main(){ float fl = n(vec2(vUv.x*60., vUv.y*3. - time*6.))*0.6 + n(vec2(vUv.x*130., vUv.y*6. - time*9.))*0.4;
        float a = smoothstep(fl, fl - 0.35, vUv.y*1.15) * op;
        vec3 c = mix(vec3(1.0,0.25,0.02), vec3(1.0,0.85,0.4), (1.-vUv.y)*fl);
        if (ice > 0.5) c = mix(vec3(0.15,0.55,1.0), vec3(0.85,1.0,1.0), (1.-vUv.y)*fl);
        gl_FragColor = vec4(c, a); }`,
  });
  function spawnFireRing(c, maxR, speed, dmg) {
    const mat = flameMat();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.6, 96, 1, true), mat);
    m.position.set(c.x, 0.8, c.z); scene.add(m);
    mat.uniforms.ice.value = BD.hazard === 'ice' ? 1 : 0;
    hazards.push({ c: c.clone(), r: 1, maxR, speed, dmg, done: false, m, mat });
    if (BD.hazard === 'ice') AudioSys.S.ice(); else AudioSys.S.fire();
  }
  function updateHazards(dt) {
    for (let i = hazards.length - 1; i >= 0; i--) {
      const h = hazards[i];
      h.r += h.speed * dt; h.mat.uniforms.time.value = G.t;
      const u = h.r / h.maxR; h.mat.uniforms.op.value = u < 0.8 ? 1 : 1 - (u - 0.8) / 0.2;
      h.m.scale.set(h.r, 1, h.r);
      if (Math.random() < 0.9) { const a = Math.random() * TAU; FX.emit(new V3(h.c.x + Math.sin(a) * h.r, 0.3, h.c.z + Math.cos(a) * h.r), { count: 3, speed: 1, up: 2.5, life: 0.6, size: 0.35, colors: BD.fxCols, drag: 2 }); }
      if (!h.done && P.state !== 'dead') {
        const d = flatDist(P.pos, h.c);
        if (Math.abs(d - h.r) < 0.55 && P.y < 0.7) { const r = resolvePlayerHit(h.dmg, false, h.c); if (r !== 'none') h.done = true; }
      }
      if (h.r >= h.maxR) { scene.remove(h.m); h.m.geometry.dispose(); h.mat.dispose(); hazards.splice(i, 1); }
    }
  }
  function clearHazards() { hazards.forEach(h => { scene.remove(h.m); h.m.geometry.dispose(); h.mat.dispose(); }); hazards.length = 0; }

  // ---------- HUD 工具 ----------
  let msgTimer = 0;
  function msg(text, dur = 2.6) { const m = $('msg'); m.textContent = text; m.classList.add('show'); msgTimer = dur; }
  let bannerTimer = 0;
  function banner(text, cls = '', dur = 1.2) { const b = $('banner'); b.className = 'show ' + cls; b.innerHTML = text; bannerTimer = dur; }
  function flash(cls) { const v = $('vignette'); v.className = ''; void v.offsetWidth; v.className = cls; }
  const dmgNums = [];
  function dmgNum(pos, text, cls = '') {
    const el = document.createElement('div'); el.className = 'dmg ' + cls; el.textContent = text; $('dmgLayer').appendChild(el);
    dmgNums.push({ el, pos: pos.clone().add(new V3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)), t: 0 });
  }
  const tmpV = new V3();
  function toScreen(p) { tmpV.copy(p).project(camera); return { x: (tmpV.x * 0.5 + 0.5) * innerWidth, y: (-tmpV.y * 0.5 + 0.5) * innerHeight, vis: tmpV.z < 1 && tmpV.z > -1 }; }
  function slowmo(scale, dur) { G.slowScale = scale; G.slowT = dur; }

  // ---------- 输入 ----------
  const keys = {}; let mouseR = false;
  const cam = { yaw: Math.PI, pitch: 0.3, dist: 5.4, cur: 5.4, look: new V3(), sens: 1, py: 0 };
  function locked() { return document.pointerLockElement === canvas; }
  function requestLock() { if (G.noLock) return; try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => { G.noLock = true; }); } catch (e) { G.noLock = true; } }
  document.addEventListener('pointerlockerror', () => { G.noLock = true; });
  document.addEventListener('pointerlockchange', () => {
    if (!locked() && G.mode === 'play' && !G.noLock) { G.paused = true; $('pause').classList.add('show'); }
  });
  addEventListener('keydown', (e) => {
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlLeft', 'ControlRight'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys[e.code] = true;
    if (G.mode === 'dead' && (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space')) { if (deathReady) retry(); return; }
    if (G.mode !== 'play' || G.paused) return;
    switch (e.code) {
      case 'Space': tryRoll(); break;
      case 'ControlLeft': case 'ControlRight': case 'KeyF': tryJump(); break;
      case 'KeyR': toggleLock(); break;
      case 'KeyQ': tryDrink(); break;
      case 'Digit1': case 'Numpad1': trySpell(); break;
      case 'Digit2': case 'Digit3': case 'Digit4': msg('此法术尚未习得 · 当前可用：1 ' + CH.spell); break;
      case 'KeyH': $('controls').classList.toggle('hide'); break;
      case 'KeyB': toggleBossBarPos(); break;
      case 'KeyM': { const m = AudioSys.toggleMute(); msg(m ? '已静音' : '已开启声音', 1.2); break; }
      case 'KeyJ': onLight(); break;
      case 'KeyK': onHeavyDown(); break;
    }
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code === 'KeyK') onHeavyUp(); });
  canvas.addEventListener('mousedown', (e) => {
    if (G.mode !== 'play') return;
    if (G.paused) return;
    if (!locked() && !G.noLock) { requestLock(); return; }
    if (e.button === 0) onLight();
    if (e.button === 2) { mouseR = true; onHeavyDown(); }
  });
  addEventListener('mouseup', (e) => { if (e.button === 2) { mouseR = false; onHeavyUp(); } });
  addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('mousemove', (e) => {
    if (G.mode !== 'play' || G.paused) return;
    if (!locked() && !G.noLock) return;
    cam.yaw -= e.movementX * 0.0024 * cam.sens;
    cam.pitch = clamp(cam.pitch + e.movementY * 0.002 * cam.sens, -0.3, 1.1);
  });
  $('pause').addEventListener('click', () => { G.paused = false; $('pause').classList.remove('show'); requestLock(); });
  // 失焦时清空按键，避免“粘键”导致角色自己跑
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseR = false; });

  function inputDir() {
    const ix = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), iz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    if (!ix && !iz) return new V3();
    const f = fwdOf(cam.yaw), r = new V3(-f.z, 0, f.x); // 屏幕右方 = (-cos yaw, 0, sin yaw)
    return f.multiplyScalar(iz).add(r.multiplyScalar(ix)).normalize();
  }
  function toggleBossBarPos(silent) {
    const top = !document.body.classList.contains('bossTop');
    document.body.classList.toggle('bossTop', top);
    try { localStorage.setItem('wukong_bossbar', top ? 'top' : 'bottom'); } catch (e) { }
    if (!silent) msg(top ? 'Boss 血条：屏幕上方' : 'Boss 血条：屏幕下方（原作布局）', 1.6);
  }
  { let pref = 'top'; try { pref = localStorage.getItem('wukong_bossbar') || 'top'; } catch (e) { } document.body.classList.toggle('bossTop', pref === 'top'); }

  // ---------- 玩家动作 ----------
  const P_IDLE = { hipY: -0.04, tX: 0.12, rsX: -0.45, rsZ: -0.15, reX: -0.9, wX: 1.65, wZ: 0.45, lsX: -0.55, lsZ: -0.25, leX: -1.0, lhX: -0.15, rhX: 0.2, lkX: 0.25, rkX: 0.3 };
  const L1a = { tY: -0.9, tX: 0.1, rsX: -0.35, rsZ: -1.25, reX: -0.3, wX: 1.57, wZ: 0, lsX: -0.4, lsZ: 0.7, leX: -0.4, hipY: -0.08, lhX: -0.45, lkX: 0.5, rhX: 0.35, rkX: 0.25 };
  const L1b = { tY: 1.05, tX: 0.2, rsX: -0.2, rsZ: -1.2, reX: -0.2, wX: 1.57, wZ: 0, lsX: -0.2, lsZ: 0.9, leX: -0.4, hipY: -0.14, lhX: -0.6, lkX: 0.6, rhX: 0.4, rkX: 0.3 };
  const L2a = { tY: 1.0, tX: 0.1, rsX: -1.3, rsZ: 0.55, reX: -0.3, wX: 1.4, wZ: 0, lsX: -0.3, lsZ: 0.2, leX: -0.6, hipY: -0.08, lhX: 0.3, lkX: 0.25, rhX: -0.45, rkX: 0.5 };
  const L2b = { tY: -1.05, tX: 0.2, rsX: -0.3, rsZ: -1.3, reX: -0.2, wX: 1.57, wZ: 0, lsX: -0.3, lsZ: 0.5, leX: -0.5, hipY: -0.14, lhX: 0.35, lkX: 0.3, rhX: -0.6, rkX: 0.6 };
  const L3a = { tX: -0.25, hX: -0.2, rsX: -2.85, rsZ: -0.15, reX: -0.5, wX: 2.05, wZ: 0, lsX: -2.6, lsZ: -0.2, leX: -0.6, hipY: -0.02, lhX: -0.2, lkX: 0.2, rhX: 0.2, rkX: 0.2 };
  const L3b = { tX: 0.5, hX: 0.15, rsX: -0.95, rsZ: -0.1, reX: -0.2, wX: 3.3, wZ: 0, lsX: -1.1, lsZ: -0.3, leX: -0.4, hipY: -0.28, lhX: -0.7, lkX: 0.8, rhX: 0.45, rkX: 0.5 };
  const L4a = { tY: -0.4, tX: 0.2, rsX: -0.1, rsZ: -1.45, reX: 0, wX: Math.PI, wZ: 0, lsX: -0.2, lsZ: 1.2, leX: -0.2, hipY: -0.16, lhX: -0.4, lkX: 0.5, rhX: 0.3, rkX: 0.4 };
  const HC = { tX: -0.2, hX: -0.1, rsX: -2.9, rsZ: -0.15, reX: -0.4, wX: 2.3, wZ: 0, lsX: -2.7, lsZ: -0.2, leX: -0.5, hipY: -0.18, lhX: -0.6, lkX: 0.75, rhX: 0.45, rkX: 0.55 };
  const HR = { tX: 0.6, hX: 0.2, rsX: -0.85, rsZ: -0.1, reX: -0.15, wX: 3.4, wZ: 0, lsX: -1.0, lsZ: -0.3, leX: -0.3, hipY: -0.38, lhX: -0.85, lkX: 1.0, rhX: 0.5, rkX: 0.6 };
  const relax = (o) => Object.assign({}, P_IDLE, o);
  const LIGHT = [
    { dur: 0.52, h0: 0.15, h1: 0.29, chain: 0.3, cancel: 0.32, range: 2.9, arc: 150, dmg: 28, st: 11, lunge: 1.5, poise: 10, swing: 0.8, kf: [[0, L1a], [0.28, { ...L1a, tY: -1.1 }], [0.56, L1b], [1, relax({ tY: 0.3, rsZ: -0.4 })]] },
    { dur: 0.52, h0: 0.15, h1: 0.29, chain: 0.3, cancel: 0.32, range: 2.9, arc: 150, dmg: 30, st: 11, lunge: 1.5, poise: 10, swing: 0.8, kf: [[0, L2a], [0.28, { ...L2a, tY: 1.15 }], [0.56, L2b], [1, relax({ tY: -0.3 })]] },
    { dur: 0.66, h0: 0.25, h1: 0.35, chain: 0.4, cancel: 0.42, range: 3.2, arc: 80, dmg: 40, st: 13, lunge: 2.0, poise: 16, swing: 1, slam: true, kf: [[0, L3a], [0.3, { ...L3a, rsX: -3.05, tX: -0.3 }], [0.5, L3b], [0.75, L3b], [1, relax({ tX: 0.3 })]] },
    { dur: 0.8, h0: 0.2, h1: 0.5, chain: 99, cancel: 0.55, range: 3.5, arc: 360, dmg: 50, st: 16, lunge: 1.2, poise: 22, swing: 1.2, spin: true, kf: [[0, L4a], [0.22, { ...L4a, tY: -0.6 }], [0.65, { ...L4a, tY: 0.2 }], [1, relax({})]] },
  ];
  const ROLL_T = 0.5, GRAV = 24, JUMP_V = 8.4;
  const ROLL_TUCK = { hipY: -0.3, tX: 1.05, tY: 0, hX: 0.6, rsX: -1.3, rsZ: -0.1, reX: -1.7, wX: 0.5, wZ: 0, lsX: -1.3, lsZ: -0.2, leX: -1.7, lhX: -1.9, lkX: 2.5, rhX: -1.9, rkX: 2.5 };
  const JUMP_UP = { hipY: -0.04, tX: 0.28, hX: -0.1, rsX: 0.5, rsZ: -0.35, reX: -0.6, wX: -1.9, wZ: 0.2, lsX: -1.5, lsZ: 0.5, leX: -0.7, lhX: -1.25, lkX: 1.7, rhX: -0.15, rkX: 0.7 };
  const JUMP_DOWN = { hipY: -0.02, tX: 0.12, hX: 0.05, rsX: 0.1, rsZ: -0.45, reX: -0.5, wX: -1.6, wZ: 0.2, lsX: -0.6, lsZ: 0.7, leX: -0.5, lhX: -0.55, lkX: 0.6, rhX: 0.15, rkX: 0.35 };
  const airborne = () => P.y > 0.001 || P.vy > 0.001;
  const canFree = () => P.state === 'idle' || P.state === 'move' || (P.state === 'land' && P.t >= 0);
  const canCancel = () => (P.state === 'attack' || P.state === 'heavy') && P.t >= P.atk.cancel;
  // 翻滚后半段可直接接任何动作（无硬直）
  const rollOut = () => P.state === 'roll' && P.t > 0.26 && !airborne();
  function useSt(c) { if (P.st < c) return false; P.st -= c; P.stDelay = 0.85; return true; }
  function tired() { if (P.tiredT > 0) return; P.tiredT = 0.4; AudioSys.S.tired(); $('pSt').parentElement.classList.remove('warn'); void $('pSt').offsetWidth; $('pSt').parentElement.classList.add('warn'); msg('气力不足', 1.0); }
  function faceTarget(rate, dt) {
    if (lockAlive()) { const L = lockPos(); const a = Math.atan2(L.x - P.pos.x, L.z - P.pos.z); P.facing = turnTo(P.facing, a, rate * dt); }
    else { const mv = inputDir(); if (mv.lengthSq()) P.facing = turnTo(P.facing, Math.atan2(mv.x, mv.z), rate * dt); }
  }
  function startLight(i) {
    const a = LIGHT[i];
    if (!useSt(a.st)) { tired(); return false; }
    P.state = 'attack'; P.t = 0; P.atk = a; P.combo = i; P.hitDone = false; P.hitSet = null; P.queued = false; P.swung = false;
    P.vel.multiplyScalar(0.3);
    // 起手立即朝向
    if (lockAlive()) { const L = lockPos(); P.facing = Math.atan2(L.x - P.pos.x, L.z - P.pos.z); }
    else { const mv = inputDir(); if (mv.lengthSq()) P.facing = Math.atan2(mv.x, mv.z); }
    return true;
  }
  function onLight() {
    if (G.mode !== 'play' || G.paused) return;
    if (P.state === 'jump' || (P.state === 'roll' && airborne() && P.t > 0.18)) { tryAirAttack(); return; }
    if (canFree() || rollOut()) startLight(P.comboTimer > 0 && P.state !== 'roll' ? (P.combo + 1) % 4 : 0);
    else if (P.state === 'attack') P.queued = true;
    else if (P.state === 'heavy' && P.t >= P.atk.cancel) startLight(0);
  }
  function onHeavyDown() {
    if (G.mode !== 'play' || G.paused) return;
    if (!(canFree() || canCancel() || rollOut())) return;
    if (P.st < 18) { tired(); return; }
    P.state = 'charge'; P.t = 0; P.charge = 0; P.level = 0; P.queued = false;
    AudioSys.S.charge(0);
  }
  function onHeavyUp() {
    if (P.state !== 'charge') return;
    const lv = P.level, frac = clamp(P.charge / 1.5, 0, 1);
    P.st = Math.max(0, P.st - (18 + lv * 12)); P.stDelay = 1.0;
    P.state = 'heavy'; P.t = 0; P.hitDone = false; P.hitSet = null; P.swung = false; P.slammed = false;
    P.atk = { dur: 0.82, h0: 0.26, h1: 0.36, cancel: 0.6, range: 3.3 + lv * 0.45, arc: 110 + lv * 15, dmg: Math.round(52 + lv * 36 + frac * 20), poise: 28 + lv * 28, lunge: 1.4 + lv * 0.5, level: lv, swing: 1.3 + lv * 0.2,
      kf: [[0, HC], [0.18, { ...HC, rsX: -3.15, tX: -0.35 }], [0.36, HR], [0.7, HR], [1, relax({ tX: 0.3 })]] };
    if (lockAlive()) { const L = lockPos(); P.facing = Math.atan2(L.x - P.pos.x, L.z - P.pos.z); }
    P.rig.gold.emissive.setRGB(0, 0, 0);
  }
  // 翻滚（地面翻滚 / 空中翻身），可连续翻滚、可接跳跃
  function tryRoll() {
    // 翻滚可在任何时刻取消任何动作（攻击前摇/后摇、蓄力、重击、跳劈、饮酒、施法、受击、翻滚中），只有阵亡时不可
    if (P.state === 'dead' || G.mode !== 'play') return;
    // 气力：够 15 正常扣除；不足 15 但仍有余量也允许滚（扣到 0），彻底见底才滚不出
    if (P.st <= 0.5) { tired(); return; }
    const lowSt = P.st < 15;
    P.st = Math.max(0, P.st - 15); P.stDelay = lowSt ? 1.3 : 0.85;
    // 清理被打断动作的残留状态
    const prev = P.state, prevT = P.t;
    if (prev === 'charge') P.rig.gold.emissive.setRGB(0, 0, 0);
    if (prev === 'drink') { P.rig.gourdHand.visible = false; P.rig.gourdWaist.visible = true; } // 未喝到则不消耗葫芦
    pTrail.active = false; P.queued = false; P.hitDone = true; P.comboTimer = 0;
    P.knock.set(0, 0, 0);
    // 防止狂按：上一次翻滚开始不足 0.2s 又滚，这一次不给完美闪避判定
    P.noPerfect = prev === 'roll' && prevT < 0.2;
    const mv = inputDir();
    P.backstep = !mv.lengthSq() && !airborne();
    const dir = mv.lengthSq() ? mv : (airborne() && P.vel.lengthSq() > 1 ? P.vel.clone().setY(0).normalize() : fwdOf(P.facing).negate());
    if (!mv.lengthSq() && airborne()) P.backstep = false;
    P.rollDir.copy(dir);
    P.rollFace = P.backstep ? P.facing : Math.atan2(dir.x, dir.z);
    const fast = P.sprinting || P.vel.length() > 6.5;
    P.rollSpeed = P.backstep ? 8.5 : (fast ? 11.5 : 10);
    // 速度承接：疾奔中翻滚，翻滚全程不低于进入时的奔跑速度（避免末段减速断档）
    P.rollCarry = !P.backstep && fast ? Math.min(P.vel.length(), 8.4 * CH.speedMul) : 0;
    P.rollAir = airborne();
    if (P.rollAir) { // 跳翻滚：空中翻身，补一点升力并向输入方向加速
      P.vy = Math.max(P.vy, 3.4);
      const sp = Math.max(P.vel.length(), 7.5);
      P.vel.copy(dir).multiplyScalar(sp);
    }
    // 连续翻滚/跳中翻滚：从当前角度接续，转到下一个整圈，避免姿态跳变
    P.flipBase = P.flipAng;
    P.flipEnd = P.backstep ? Math.floor(P.flipAng / TAU - 0.5) * TAU : Math.ceil(P.flipAng / TAU + 0.5) * TAU;
    P.state = 'roll'; P.t = 0; P.queued = false;
    AudioSys.S.roll();
    if (!P.rollAir) SMOKE.emit(P.pos.clone().setY(0.1), { count: 10, speed: 1.5, life: 0.7, size: 0.5, sizeEnd: 1.2, color: [0.55, 0.5, 0.42], drag: 3, up: 0.4, radius: 0.5, flat: true });
  }
  // 跳跃：可从站立/奔跑/翻滚中起跳，继承当前水平速度（翻滚跳＝远跳）
  function tryJump() {
    const ok = canFree() || canCancel() || P.state === 'land' || (P.state === 'roll' && P.t > 0.06);
    if (!ok || airborne()) return;
    if (!useSt(10)) { tired(); return; }
    const mv = inputDir();
    if (P.state === 'roll') { const keep = Math.max(P.vel.length(), 6); P.vel.copy(mv.lengthSq() ? mv : P.rollDir).multiplyScalar(keep * 1.05); }
    else if (mv.lengthSq() && P.vel.lengthSq() < 4) P.vel.copy(mv).multiplyScalar(4.6);
    P.vy = CH.jumpV; P.y = 0.001;
    if (CH.glide) FX.emit(P.pos.clone().setY(0.2), { count: 16, speed: 2.5, life: 0.5, size: 0.25, colors: [[1, 0.45, 0.08], [1, 0.75, 0.25]], drag: 3, flat: true, radius: 0.4 });
    P.state = 'jump'; P.t = 0; P.queued = false;
    AudioSys.S.jump();
    SMOKE.emit(P.pos.clone().setY(0.1), { count: 8, speed: 1.2, life: 0.6, size: 0.45, sizeEnd: 1.0, color: [0.55, 0.5, 0.42], drag: 3, flat: true, radius: 0.4 });
  }
  // 跳劈：空中左键，滞空后下砸
  function tryAirAttack() {
    if (!useSt(14)) { tired(); return; }
    P.state = 'airatk'; P.t = 0; P.hitDone = false; P.hitSet = null; P.slammed = false; P.swung = false;
    P.vy = Math.max(P.vy, 2.2);
    if (lockAlive()) { const L = lockPos(); P.facing = Math.atan2(L.x - P.pos.x, L.z - P.pos.z); }
    else { const mv = inputDir(); if (mv.lengthSq()) P.facing = Math.atan2(mv.x, mv.z); }
  }
  function tryDrink() {
    if (!(canFree() || canCancel())) return;
    if (P.gourds <= 0) { AudioSys.S.empty(); msg('葫芦已空，无法再饮'); $('gourd').classList.add('empty'); return; }
    if (P.hp >= P.maxHp) { msg('气血已满', 1.2); return; }
    P.state = 'drink'; P.t = 0; P.healed = false; P.gulped = false;
    P.rig.gourdHand.visible = true; P.rig.gourdWaist.visible = false;
  }
  function trySpell() {
    if (!(canFree() || canCancel())) return;
    if (P.spellCD > 0) { AudioSys.S.empty(); msg(`${CH.spell}冷却中 · ${Math.ceil(P.spellCD)} 秒`, 1.2); return; }
    if (!G.fight || !B.alive) { AudioSys.S.empty(); msg('附近没有可定身的目标', 1.4); return; }
    if (flatDist(P.pos, B.pos) > 22) { AudioSys.S.empty(); msg('目标太远，' + CH.spell + '无法触及', 1.4); return; }
    if (B.state === 'transform') { AudioSys.S.empty(); msg('妖王正在蜕变，法术无效', 1.4); return; }
    P.state = 'cast'; P.t = 0; P.cast = false;
    P.facing = Math.atan2(B.pos.x - P.pos.x, B.pos.z - P.pos.z);
  }
  function toggleLock() { return toggleLock2(); }
  function toggleLock_old() {
    if (G.lock) { G.lock = false; AudioSys.S.lock(false); return; }
    if (!B.alive || B.state === 'dying') return;
    if (!G.fight) { msg('尚无可锁定的目标', 1.2); return; }
    if (flatDist(P.pos, B.pos) > 35) { msg('目标过远', 1.2); return; }
    G.lock = true; AudioSys.S.lock(true);
  }

  // 玩家攻击判定
  function playerHitCheck(a, forceLv) {
    if (P.hitDone) return;
    const lv = forceLv ? a.level : (P.state === 'heavy' ? a.level + 1 : 0);
    // 小怪：一次挥击可同时命中多只（每只单独判定一次）
    P.hitSet = P.hitSet || new Set();
    let hitMob = false;
    Mobs.list().forEach(m => {
      if (!m.alive || P.hitSet.has(m)) return;
      const d = flatDist(P.pos, m.pos) - m.r;
      if (d > a.range) return;
      if (a.arc < 360) { const ang = Math.atan2(m.pos.x - P.pos.x, m.pos.z - P.pos.z); if (Math.abs(angDiff(P.facing, ang)) > rad(a.arc / 2) + (d < 0.4 ? 0.5 : 0)) return; }
      P.hitSet.add(m); hitMob = true;
      Mobs.damage(m, a.dmg, a.poise, lv);
    });
    if (!B.alive || B.state === 'dying' || B.rig.root.visible === false || !G.fight) { if (hitMob && P.state !== 'attack') P.hitDone = true; return; }
    if (B.lift > 1.6) return;
    const d = flatDist(P.pos, B.pos) - BR;
    if (d > a.range) return;
    if (a.arc < 360) {
      const ang = Math.atan2(B.pos.x - P.pos.x, B.pos.z - P.pos.z);
      if (Math.abs(angDiff(P.facing, ang)) > rad(a.arc / 2) + (d < 0.4 ? 0.5 : 0)) return;
    }
    P.hitDone = true;
    const hp = B.pos.clone().add(new V3(P.pos.x - B.pos.x, 0, P.pos.z - B.pos.z).normalize().multiplyScalar(BR * 0.8)).setY(BD.chest - 0.4 + Math.random() * 0.8);
    damageBoss(a.dmg, a.poise, hp, lv);
  }

  // ---------- 冰棱（敖丙专属地面危险物：先预警、后破土、短暂停留） ----------
  const spikes = [];
  const spikeGeo = new THREE.ConeGeometry(0.28, 1.6, 5); spikeGeo.translate(0, 0.8, 0);
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0xc8f6ff, emissive: 0x2a9aff, emissiveIntensity: 0.8, roughness: 0.1, transparent: true, opacity: 0.9 });
  function iceSpikes(c, radius) {
    const n = 7 + Math.floor(radius);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, r = 1.5 + Math.random() * (radius + 3);
      const p = new V3(c.x + Math.sin(a) * r, 0, c.z + Math.cos(a) * r);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 20), new THREE.MeshBasicMaterial({ color: 0x6af0ff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, 0.08, p.z); scene.add(ring);
      const m = new THREE.Mesh(spikeGeo, spikeMat); m.position.copy(p); m.scale.set(1, 0.001, 1); m.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * TAU, (Math.random() - 0.5) * 0.4); m.castShadow = true; scene.add(m);
      spikes.push({ p, m, ring, t: -0.15 * Math.random(), warn: 0.55, done: false });
    }
  }
  function updateSpikes(dt) {
    for (let i = spikes.length - 1; i >= 0; i--) {
      const s = spikes[i]; s.t += dt;
      if (s.t < s.warn) { s.ring.material.opacity = 0.4 + 0.5 * Math.abs(Math.sin(G.t * 18)); s.ring.scale.setScalar(1 - s.t / s.warn * 0.4); continue; }
      const u = s.t - s.warn;
      s.ring.visible = false;
      s.m.scale.y = Math.min(1, u / 0.08) * (u > 1.1 ? Math.max(0.001, 1 - (u - 1.1) / 0.3) : 1);
      if (!s.done && u < 0.15 && flatDist(P.pos, s.p) < 0.8 && P.y < 1.2) { const r = resolvePlayerHit(26, false, s.p); if (r !== 'none') s.done = true; }
      if (u < 0.05) FX.emit(s.p.clone().setY(0.3), { count: 4, speed: 3, up: 2, life: 0.4, size: 0.12, colors: [[0.7, 0.95, 1], [1, 1, 1]], gravity: 8 });
      if (u > 1.4) { scene.remove(s.m); scene.remove(s.ring); s.ring.geometry.dispose(); s.ring.material.dispose(); spikes.splice(i, 1); }
    }
  }
  function clearSpikes() { spikes.forEach(s => { scene.remove(s.m); scene.remove(s.ring); }); spikes.length = 0; }

  // ---------- 小怪：巡海夜叉 ----------
  // 状态机：patrol（巡逻呼吸）→ alert（发现玩家，吼叫，0.6s）→ approach（保持 2.5~4m 间距绕行）→
  //         attack（前摇有红光+地面扇形预警 → 出手 → 后摇可被惩罚）→ hurt（受击硬直）→ dead（倒地消散）
  // 群体规则：同一时刻最多 1 只出手（攻击令牌），其余绕圈施压，避免不公平的同时夹击。
  const Mobs = (() => {
    const list = []; let token = null;
    const M_IDLE = { hipY: -0.1, tX: 0.35, hX: -0.2, rsX: -0.6, reX: -0.9, wX: 1.4, lsX: -0.4, lsZ: -0.3, leX: -0.8, lhX: -0.4, lkX: 0.7, rhX: 0.2, rkX: 0.5 };
    const M_WIND = { hipY: -0.2, tX: -0.1, tY: -0.6, hX: -0.1, rsX: -2.7, rsZ: -0.3, reX: -0.4, wX: 2.1, lsX: -0.9, lsZ: 0.4, lhX: -0.7, lkX: 1.0, rhX: 0.5, rkX: 0.6 };
    const M_STAB = { hipY: -0.25, tX: 0.6, tY: 0.3, rsX: -1.4, rsZ: -0.1, reX: -0.05, wX: 3.0, lsX: 0.3, lhX: -1.0, lkX: 0.6, rhX: 0.6, rkX: 0.3 };
    const M_HURT = { hipY: -0.15, tX: -0.5, hX: -0.4, rsX: 0.3, lsX: 0.4, lhX: -0.3, lkX: 0.6 };
    function spawn(x, z, seed) {
      const rig = Chars.buildYaksha(seed); scene.add(rig.root);
      const m = { rig, pos: new V3(x, 0, z), home: new V3(x, 0, z), facing: Math.PI, hp: 150, maxHp: 150, alive: true, state: 'patrol', t: Math.random() * 2, r: 0.55, pose: Chars.zeroPose(), cd: 1 + Math.random(), flash: 0, poise: 0, orbit: Math.random() < 0.5 ? 1 : -1, ph: 0, tele: null, hitDone: false, bar: null };
      Object.assign(m.pose, M_IDLE);
      const bar = document.createElement('div'); bar.className = 'mobBar'; bar.innerHTML = '<i></i>'; $('dmgLayer').appendChild(bar); m.bar = bar;
      list.push(m); return m;
    }
    function clear() { list.forEach(m => { scene.remove(m.rig.root); if (m.tele) { scene.remove(m.tele); } m.bar.remove(); }); list.length = 0; token = null; }
    function damage(m, dmg, poise, lv) {
      const v = Math.round(dmg * (0.92 + Math.random() * 0.16) * (m.state === 'hurt' ? 1.2 : 1));
      m.hp = Math.max(0, m.hp - v); m.flash = 1;
      const at = m.pos.clone().setY(1.3);
      dmgNum(at, v, lv ? 'heavy' : ''); AudioSys.S.hit(lv ? 1 : 0);
      FX.emit(at, { count: 14, speed: 5, life: 0.35, size: 0.1, colors: [[0.6, 1, 0.8], [1, 1, 0.9]], gravity: 6, drag: 2 });
      G.hitStop = Math.max(G.hitStop, lv ? 0.07 : 0.035); G.shake = Math.max(G.shake, lv ? 0.2 : 0.08);
      // 被打断：前摇中受重击或累积韧性被破则打断出手
      m.poise += poise;
      if (m.state !== 'attack' || m.poise > 25 || lv) {
        m.state = 'hurt'; m.t = 0; m.poise = 0; if (m.tele) { scene.remove(m.tele); m.tele = null; } if (token === m) token = null;
        const away = new V3(m.pos.x - P.pos.x, 0, m.pos.z - P.pos.z).normalize(); m.knock = away.multiplyScalar(lv ? 7 : 3.5);
      }
      if (m.hp <= 0) { m.alive = false; m.state = 'dead'; m.t = 0; if (token === m) token = null; if (LT === m) { G.lock = false; LT = null; } AudioSys.S.growl(0); m.bar.style.display = 'none'; G.mobKills = (G.mobKills || 0) + 1; }
    }
    function makeTele(m) {
      const g = new THREE.Mesh(new THREE.RingGeometry(0.3, 3.0, 32, 1, -Math.PI / 2 - 0.45, 0.9), new THREE.MeshBasicMaterial({ color: 0xff3010, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }));
      g.rotation.x = -Math.PI / 2; scene.add(g); return g;
    }
    function update(dt) {
      for (const m of list) {
        m.t += dt; m.flash = Math.max(0, m.flash - dt * 6);
        const to = new V3(P.pos.x - m.pos.x, 0, P.pos.z - m.pos.z), dist = to.length(), ang = Math.atan2(to.x, to.z);
        let tgt = M_IDLE, rate = 12, walk = 0, extra = {};
        const playerOK = P.state !== 'dead' && G.mode === 'play';
        switch (m.state) {
          case 'patrol':
            m.facing = turnTo(m.facing, Math.atan2(m.home.x - m.pos.x + Math.sin(m.t * 0.4) * 2, m.home.z - m.pos.z - 3) , 1 * dt);
            tgt = Object.assign({}, M_IDLE, { tX: 0.35 + Math.sin(m.t * 1.8) * 0.05, hY: Math.sin(m.t * 0.7) * 0.4 });
            if (playerOK && dist < 13) { m.state = 'alert'; m.t = 0; AudioSys.S.growl(0); }
            break;
          case 'alert':
            m.facing = turnTo(m.facing, ang, 8 * dt);
            tgt = Object.assign({}, M_IDLE, { tX: -0.3, hX: -0.6, rsX: -1.2, lsX: -1.2, lsZ: 0.8 });
            if (m.t > 0.7) { m.state = 'approach'; m.t = 0; }
            break;
          case 'approach': {
            if (!playerOK) { m.state = 'patrol'; break; }
            m.facing = turnTo(m.facing, ang, 5 * dt);
            m.cd -= dt;
            const want = token === null || token === m ? 2.4 : 4.2;
            let mv = new V3();
            if (dist > want + 0.4) mv.copy(to).normalize().multiplyScalar(dist > 8 ? 4.2 : 3.0);
            else if (dist < want - 0.6) mv.copy(to).normalize().multiplyScalar(-2.0);
            mv.add(new V3(to.z, 0, -to.x).normalize().multiplyScalar(m.orbit * 1.6)); // 绕行
            // 与同伴保持间距
            list.forEach(o => { if (o !== m && o.alive) { const dd = m.pos.distanceTo(o.pos); if (dd < 1.6) mv.add(m.pos.clone().sub(o.pos).normalize().multiplyScalar(2.5)); } });
            m.pos.addScaledVector(mv, dt); walk = mv.length();
            if (m.cd <= 0 && dist < 3.2 && (token === null || token === m)) { token = m; m.state = 'attack'; m.t = 0; m.hitDone = false; m.tele = makeTele(m); AudioSys.S.growl(0); }
            if (Math.random() < dt * 0.3) m.orbit *= -1;
            break;
          }
          case 'attack': {
            const W = 0.75, A = 0.18, REC = 0.7;
            if (m.t < W - 0.2) m.facing = turnTo(m.facing, ang, 5 * dt);
            if (m.tele) { m.tele.position.set(m.pos.x, 0.07, m.pos.z); m.tele.rotation.z = m.facing; const k = Math.min(1, m.t / W); m.tele.material.opacity = 0.25 + k * 0.4 + (W - m.t < 0.2 ? Math.abs(Math.sin(G.t * 30)) * 0.3 : 0); }
            if (m.t < W) { tgt = Chars.keyframes(M_IDLE, [[0, M_IDLE], [1, M_WIND]], m.t / W); m.rig.eyeM.emissiveIntensity = 2.5 + m.t / W * 6; }
            else if (m.t < W + A) {
              tgt = M_STAB; rate = 30; m.pos.addScaledVector(fwdOf(m.facing), 7 * dt);
              if (!m.hitDone) { m.hitDone = true; AudioSys.S.swing(0.9); if (m.tele) { scene.remove(m.tele); m.tele = null; }
                if (dist < 3.3 && P.y < 1.4) { const a2 = Math.abs(angDiff(m.facing, ang)); if (a2 < 0.6) resolvePlayerHit(24, false, m.pos.clone()); } }
            } else { tgt = Chars.keyframes(M_STAB, [[0, M_STAB], [1, M_IDLE]], (m.t - W - A) / REC); m.rig.eyeM.emissiveIntensity = 2.5; }
            if (m.t > W + A + REC) { m.state = 'approach'; m.t = 0; m.cd = 1.4 + Math.random() * 1.2; token = null; }
            break;
          }
          case 'hurt':
            tgt = M_HURT; rate = 20;
            if (m.knock) { m.pos.addScaledVector(m.knock, dt); m.knock.multiplyScalar(Math.exp(-dt * 8)); }
            if (m.t > 0.45) { m.state = 'approach'; m.t = 0; m.cd = 0.6 + Math.random(); }
            break;
          case 'dead': {
            tgt = M_HURT; rate = 8;
            extra.tilt = -Math.min(1, m.t / 0.6) * 1.4;
            if (m.t > 1.0) { const k = Math.min(1, (m.t - 1.0) / 1.0); m.rig.root.scale.setScalar(Math.max(0.01, 1 - k)); if (Math.random() < 0.5) SMOKE.emit(m.pos.clone().setY(0.6), { count: 2, speed: 0.8, up: 1.5, life: 1, size: 0.5, sizeEnd: 1.2, color: [0.2, 0.35, 0.35] }); }
            if (m.t > 2.0) m.rig.root.visible = false;
            break;
          }
        }
        if (m.state !== 'dead') { world.constrain(m.pos, m.r, false); const dd = flatDist(m.pos, P.pos); if (dd < m.r + PR && dd > 0.01) { const n = new V3(P.pos.x - m.pos.x, 0, P.pos.z - m.pos.z).normalize(); P.pos.x = m.pos.x + n.x * (m.r + PR); P.pos.z = m.pos.z + n.z * (m.r + PR); } }
        if (walk > 0.2) { m.ph += walk * dt * 2.4; const s = Math.sin(m.ph), c = Math.cos(m.ph); tgt = Object.assign({}, tgt, { lhX: -0.4 - s * 0.5, rhX: 0.2 + s * 0.5, lkX: 0.7 + Math.max(0, c) * 0.5, rkX: 0.5 + Math.max(0, -c) * 0.5 }); }
        Chars.blendPose(m.pose, tgt, 1 - Math.exp(-dt * rate));
        Chars.applyPose(m.rig, m.pose, extra);
        m.rig.root.position.set(m.pos.x, 0, m.pos.z); m.rig.root.rotation.y = m.facing;
        m.rig.flashMats.forEach(mt => mt.emissive.setRGB(m.flash * 0.6 + (m.state === 'attack' && m.t < 0.75 ? 0.15 : 0), m.flash * 0.6, m.flash * 0.5));
        // 头顶血条
        if (m.alive && m.state !== 'patrol') {
          const s = toScreen(m.pos.clone().setY(2.25));
          m.bar.style.display = s.vis ? 'block' : 'none'; m.bar.style.transform = `translate(${s.x - 30}px, ${s.y}px)`; m.bar.firstChild.style.width = (m.hp / m.maxHp * 100) + '%';
        } else if (m.alive) m.bar.style.display = 'none';
      }
    }
    return { list: () => list, spawn, clear, damage, update, alive: () => list.filter(m => m.alive).length };
  })();

  function hurtPlayer(dmg, src, heavy) {
    P.hp = Math.max(0, P.hp - dmg); G.hits++;
    P.invuln = 0.6;
    if (P.state === 'charge') P.rig.gold.emissive.setRGB(0, 0, 0);
    P.rig.gourdHand.visible = false; P.rig.gourdWaist.visible = true;
    P.state = 'hurt'; P.t = 0; P.hurtDur = heavy ? 0.75 : 0.42;
    const dir = new V3(P.pos.x - src.x, 0, P.pos.z - src.z); if (dir.lengthSq() < 0.001) dir.copy(fwdOf(P.facing)).negate(); dir.normalize();
    P.knock.copy(dir).multiplyScalar(heavy ? 9 : 4);
    P.facing = Math.atan2(-dir.x, -dir.z);
    G.shake = Math.max(G.shake, heavy ? 0.55 : 0.32);
    G.hitStop = heavy ? 0.09 : 0.05;
    flash('hurt');
    AudioSys.S.hurt(heavy);
    FX.emit(P.pos.clone().setY(1.2), { count: 18, speed: 5, life: 0.4, size: 0.12, colors: [[0.7, 0.05, 0.02], [1, 0.3, 0.1]], gravity: 9, drag: 2 });
    dmgNum(P.pos.clone().setY(2.1), '-' + Math.round(dmg), 'player');
    if (P.hp <= 0) die();
  }
  function resolvePlayerHit(dmg, heavy, src) {
    if (P.state === 'dead' || G.mode !== 'play') return 'none';
    if (P.state === 'roll' && P.t < PERFECT_WIN && !P.noPerfect) { perfectDodge(src); return 'perfect'; }
    if (P.invuln > 0) return 'none';
    hurtPlayer(Math.round(dmg * (B.phase === 2 ? 1.12 : 1)), src, heavy);
    return 'hit';
  }
  function perfectDodge() {
    G.perfects++;
    P.invuln = 0.45;
    P.st = Math.min(P.maxSt, P.st + 25);
    P.spellCD = Math.max(0, P.spellCD - 2);
    slowmo(0.22, 0.55);
    ghost();
    flash('perfect');
    banner('完美闪避', 'perfect', 0.9);
    AudioSys.S.perfect();
    FX.emit(P.pos.clone().setY(1.0), { count: 40, speed: 4, life: 0.6, size: 0.12, colors: [[0.6, 0.95, 1], [1, 1, 1]], drag: 3, radius: 0.8 });
  }
  let deathReady = false;
  function die() {
    P.state = 'dead'; P.t = 0; G.lock = false; LT = null; G.mode = 'dead'; deathReady = false;
    AudioSys.setMode('none'); AudioSys.S.death();
    slowmo(0.4, 1.2);
    setTimeout(() => {
      $('death').classList.add('show');
      $('deathInfo').textContent = G.fight ? `第 ${G.attempts} 次挑战 · ${BD.name}剩余气血 ${Math.ceil(B.hp / B.maxHp * 100)}%` : `第 ${G.attempts} 次挑战 · 倒在了前往镇海台的路上`;
      if (document.pointerLockElement) document.exitPointerLock();
      setTimeout(() => deathReady = true, 500);
    }, 1800);
  }

  // 锁定：优先战斗中的 Boss；否则锁定最近的存活小怪；再按一次解除
  function toggleLock2() {
    if (G.lock) { G.lock = false; LT = null; AudioSys.S.lock(false); return; }
    const cands = [];
    if (G.fight && B.alive && B.state !== 'dying') cands.push(B);
    Mobs.list().forEach(m => { if (m.alive) cands.push(m); });
    let best = null, bd = 35;
    cands.forEach(c => { const d = flatDist(P.pos, c.pos) - (c === B ? 8 : 0); if (d < bd) { bd = d; best = c; } });
    if (!best) { msg('附近没有可锁定的目标', 1.2); return; }
    LT = best; G.lock = true; AudioSys.S.lock(true);
  }

  // ---------- Boss ----------
  const B_IDLE = { hipY: -0.06, tX: 0.15, rsX: -0.5, rsZ: -0.1, reX: -0.6, wX: 1.7, lsX: -0.35, lsZ: -0.1, leX: -0.5, lhX: -0.2, rhX: 0.15, lkX: 0.3, rkX: 0.25 };
  const BA = {
    slashR: { W: { tY: -1.0, tX: -0.1, rsX: -2.5, rsZ: -0.5, reX: -0.3, wX: 2.0, lsX: -0.8, lsZ: 0.3, hipY: -0.12 }, S: { tY: 1.0, tX: 0.45, rsX: -0.7, rsZ: -0.1, reX: -0.2, wX: 2.9, lsX: -0.2, hipY: -0.2, lhX: -0.6, lkX: 0.6 } },
    slashL: { W: { tY: 0.9, tX: -0.1, rsX: -2.2, rsZ: 0.7, reX: -0.4, wX: 1.8, hipY: -0.12 }, S: { tY: -1.0, tX: 0.45, rsX: -0.6, rsZ: -0.9, reX: -0.2, wX: 2.5, hipY: -0.2, rhX: -0.6, rkX: 0.6 } },
    smash: { W: { tX: -0.35, hX: -0.3, rsX: -3.0, rsZ: -0.2, reX: -0.4, wX: 2.2, lsX: -2.8, leX: -0.5, hipY: -0.05 }, S: { tX: 0.6, hX: 0.2, rsX: -1.0, reX: -0.2, wX: 3.3, lsX: -1.2, hipY: -0.35, lhX: -0.8, lkX: 0.9, rhX: 0.3, rkX: 0.5 } },
    spin: { W: { tY: -1.3, tX: 0.2, rsX: -0.2, rsZ: -1.35, reX: 0, wX: Math.PI, lsZ: 1.0, lsX: -0.3, hipY: -0.3, lhX: -0.5, lkX: 0.7, rhX: 0.4, rkX: 0.6 }, S: { tY: 0.2, tX: 0.2, rsX: -0.2, rsZ: -1.35, reX: 0, wX: Math.PI, lsZ: 1.0, lsX: -0.3, hipY: -0.25, lhX: -0.4, lkX: 0.5, rhX: 0.3, rkX: 0.5 } },
    thrust: { W: { tY: -0.7, tX: 0.25, rsX: 0.4, rsZ: -0.2, reX: -1.7, wX: 2.9, lsX: -1.2, leX: -0.8, hipY: -0.4, lhX: -0.9, lkX: 1.0, rhX: 0.6, rkX: 0.4 }, S: { tY: 0.2, tX: 0.55, rsX: -1.45, rsZ: -0.1, reX: -0.05, wX: 3.05, lsX: 0.3, hipY: -0.3, lhX: -1.0, lkX: 0.5, rhX: 0.7, rkX: 0.3 } },
    leap: { W: { hipY: -0.6, tX: 0.5, rsX: -2.6, wX: 2.0, lsX: -2.6, lhX: -1.0, lkX: 1.4, rhX: -1.0, rkX: 1.4 }, AIR: { hipY: -0.1, tX: -0.3, rsX: -3.0, wX: 2.2, lsX: -3.0, lhX: -1.2, lkX: 1.6, rhX: -0.4, rkX: 0.9 }, S: { tX: 0.7, hX: 0.2, rsX: -0.9, reX: -0.2, wX: 3.4, lsX: -1.2, hipY: -0.6, lhX: -1.0, lkX: 1.3, rhX: 0.5, rkX: 0.8 } },
  };
  const B_ROAR = { tX: -0.5, hX: -0.7, rsX: -0.8, rsZ: -1.2, lsX: -0.8, lsZ: 1.2, reX: -0.5, leX: -0.5, hipY: -0.15, wX: 1.7 };
  const B_STAG = { hipY: -0.75, tX: 0.7, hX: 0.4, rsX: -0.2, reX: -0.3, wX: 1.0, lsX: -0.1, lhX: -1.4, lkX: 2.2, rhX: 0.3, rkX: 0.9 };
  const B_SIT = { hipY: -0.8, tX: 0.08, hX: 0.3, rsX: -0.4, reX: -0.9, wX: 1.3, lsX: -0.5, lsZ: -0.4, leX: -1.3, lhX: -1.5, lkX: 2.4, rhX: -1.5, rkX: 2.4 };

  function attackSteps(name, p2) {
    const k = p2 ? 0.78 : 1;
    switch (name) {
      case 'combo': {
        const s = [
          { anim: 'slashR', wind: 0.72 * k, act: 0.16, rec: 0.16, shape: 'cone', range: 5.6, arc: 120, dmg: 30, track: 5, adv: 3.2 },
          { anim: 'slashL', wind: 0.46 * k, act: 0.16, rec: 0.18, shape: 'cone', range: 5.6, arc: 120, dmg: 30, track: 4.5, adv: 3.2 },
          { anim: 'smash', wind: 0.62 * k, act: 0.16, rec: p2 ? 0.3 : 0.95, shape: 'cone', range: 6.3, arc: 44, dmg: 42, track: 3.5, adv: 2.4, heavy: true, slam: true },
        ];
        if (p2) s.push({ anim: 'smash', wind: 0.6, act: 0.16, rec: 1.0, shape: 'circle', radius: 4.4, front: 3.2, dmg: 46, track: 3, adv: 1.5, heavy: true, slam: true, fire: true });
        return s;
      }
      case 'sweep': {
        const s = [{ anim: 'spin', wind: 1.1 * k, act: 0.45, rec: p2 ? 0.25 : 1.0, shape: 'circle', radius: 6.6, dmg: 48, track: 1.5, heavy: true }];
        if (p2) s.push({ anim: 'spin', wind: 0.62, act: 0.45, rec: 1.0, shape: 'circle', radius: 8.4, dmg: 52, track: 1, heavy: true, fire: true });
        return s;
      }
      case 'lunge': {
        const n = p2 ? 3 : 1, s = [];
        for (let i = 0; i < n; i++) s.push({ anim: 'thrust', wind: i === 0 ? 0.95 * k : 0.55, act: 0.38, rec: i === n - 1 ? 0.95 : 0.1, shape: 'line', width: 3.0, dmg: 52, track: 6, heavy: true });
        return s;
      }
      case 'leap':
        return [{ anim: 'leap', wind: 0.55, air: 0.95, act: 0.12, rec: 1.25, shape: 'leap', radius: 4.6, dmg: 62, track: 4, heavy: true }];
    }
  }
  function chooseAttack(d) {
    const p2 = B.phase === 2, opts = [];
    if (d < 6.8) opts.push(['combo', 3], ['sweep', d < 4.8 ? 2.2 : 1]);
    if (d >= 5.5) opts.push(['lunge', d > 9 ? 3.5 : 1.0]);
    if (p2 && d > 4) opts.push(['leap', d > 8 ? 2.6 : 1.4]);
    if (!opts.length) return null;
    opts.forEach(o => { const c = B.last.filter(n => n === o[0]).length; o[1] *= Math.pow(0.35, c); });
    let sum = opts.reduce((s, o) => s + o[1], 0), r = Math.random() * sum;
    for (const o of opts) { r -= o[1]; if (r <= 0) return o[0]; }
    return opts[0][0];
  }
  function startAttack(name) {
    B.state = 'attack'; B.atk = { name, steps: attackSteps(name, B.phase === 2), i: 0 };
    B.last.unshift(name); B.last = B.last.slice(0, 2);
    AudioSys.S.growl(name === 'leap' || name === 'sweep' ? 1 : 0);
    startStep();
  }
  function curStep() { return B.atk.steps[B.atk.i]; }
  function startStep() {
    const s = curStep(); B.sp = 'wind'; B.st = 0; s.hitDone = false;
    clearTele();
    const d = flatDist(P.pos, B.pos);
    if (s.shape === 'line') { s.len = clamp(d + 4, 9, 19); B.tele = makeTele('line', { width: s.width, len: s.len }); }
    else if (s.shape === 'cone') B.tele = makeTele('cone', { range: s.range, arc: s.arc });
    else if (s.shape === 'circle' || s.shape === 'leap') B.tele = makeTele('circle', { radius: s.radius });
    if (s.shape === 'leap') { s.target = P.pos.clone(); s.from = B.pos.clone(); }
    placeTele(s);
    (window.__QA = window.__QA || { steps: [] }).steps.push({ boss: BD.name, atk: B.atk.name, i: B.atk.i, wind: s.wind, tele: !!B.tele, phase: B.phase });
  }
  function placeTele(s) {
    if (!B.tele) return;
    const g = B.tele.g;
    if (s.shape === 'leap') { g.position.set(s.target.x, 0, s.target.z); g.rotation.y = 0; return; }
    g.rotation.y = B.facing;
    if (s.front) { const f = fwdOf(B.facing).multiplyScalar(s.front); g.position.set(B.pos.x + f.x, 0, B.pos.z + f.z); }
    else g.position.set(B.pos.x, 0, B.pos.z);
  }
  function inArea(s) {
    const d = flatDist(P.pos, B.pos);
    // 跳跃可越过低位横扫与火焰；高度足够时也能躲过震地
    if (s.anim === 'spin' && P.y > 0.75) return false;
    if (s.shape === 'leap' && P.y > 1.3) return false;
    if (P.y > 2.2) return false;
    if (s.shape === 'cone') {
      if (d > s.range + PR) return false;
      const ang = Math.atan2(P.pos.x - B.pos.x, P.pos.z - B.pos.z);
      return Math.abs(angDiff(B.facing, ang)) <= rad(s.arc / 2) + (d < BR + 0.6 ? 0.6 : 0.05);
    }
    if (s.shape === 'circle') {
      const c = s.front ? B.pos.clone().add(fwdOf(B.facing).multiplyScalar(s.front)) : B.pos;
      return flatDist(P.pos, c) <= s.radius + PR;
    }
    if (s.shape === 'leap') return flatDist(P.pos, s.target) <= s.radius + PR;
    return false;
  }
  function segDist(p, a, b) {
    const abx = b.x - a.x, abz = b.z - a.z, l2 = abx * abx + abz * abz;
    let t = l2 > 0 ? ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2 : 0; t = clamp(t, 0, 1);
    return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
  }
  function bossStrikeFX(s) {
    const tip = new V3(); B.rig.tip.getWorldPosition(tip);
    if (s.slam || s.shape === 'leap') {
      const c = s.shape === 'leap' ? s.target : (s.front ? B.pos.clone().add(fwdOf(B.facing).multiplyScalar(s.front)) : tip);
      AudioSys.S.slam(1);
      shockwave(c, B.phase === 2 ? BD.p2Color : 0xd8c8a8, s.radius || 4, 0.6);
      SMOKE.emit(new V3(c.x, 0.3, c.z), { count: 30, speed: 5, life: 1.0, size: 0.9, sizeEnd: 2.4, color: [0.5, 0.45, 0.38], drag: 3, up: 1, flat: true, radius: 1.5 });
      FX.emit(new V3(c.x, 0.3, c.z), { count: 20, speed: 6, life: 0.5, size: 0.12, color: [1, 0.75, 0.4], gravity: 12 });
      G.shake = Math.max(G.shake, flatDist(P.pos, c) < 12 ? 0.45 : 0.2);
    } else AudioSys.S.swing(1.6);
    if (s.fire) {
      if (BD.hazard === 'ice') AudioSys.S.ice(); else AudioSys.S.fire();
      const c = s.front ? B.pos.clone().add(fwdOf(B.facing).multiplyScalar(s.front)) : B.pos.clone();
      for (let i = 0; i < 40; i++) { const a = Math.random() * TAU, r = Math.random() * (s.radius || 4); FX.emit(new V3(c.x + Math.sin(a) * r, 0.4, c.z + Math.cos(a) * r), { count: 2, speed: 1.5, up: 3.5, life: 0.8, size: 0.5, colors: BD.fxCols, drag: 2 }); }
      shockwave(c, BD.p2Color, s.radius || 6, 0.5, 0.9);
      if (BD.hazard === 'ice') iceSpikes(c, s.radius || 5);
    }
  }
  function updateBossAttack(dt) {
    const s = curStep(); B.st += dt;
    const angTo = Math.atan2(P.pos.x - B.pos.x, P.pos.z - B.pos.z);
    if (B.sp === 'wind') {
      if (B.st < s.wind - 0.22) B.facing = turnTo(B.facing, angTo, s.track * dt);
      if (s.shape === 'leap') { /* 起跳前锁定目标点 */ s.target.lerp(P.pos, Math.min(1, dt * 4)); }
      placeTele(s);
      const p = B.st / s.wind, danger = s.wind - B.st < 0.25;
      if (B.tele) B.tele.set(s.shape === 'leap' ? p * 0.4 : p, danger);
      if (danger) { B.rig.tip.getWorldPosition(glint.position); glint.material.opacity = 1; glint.material.rotation = G.t * 3; }
      if (B.st >= s.wind) {
        B.st = 0;
        if (s.shape === 'leap') { B.sp = 'air'; s.from = B.pos.clone(); AudioSys.S.dash(); SMOKE.emit(B.pos.clone().setY(0.2), { count: 24, speed: 4, life: 0.9, size: 0.9, sizeEnd: 2, color: [0.45, 0.4, 0.35], drag: 3, flat: true, radius: 1.5 }); }
        else {
          B.sp = 'act';
          if (s.shape === 'line') { s.from = B.pos.clone(); s.dir = fwdOf(B.facing); s.prev = B.pos.clone(); AudioSys.S.dash(); }
          bTrail.active = true;
        }
      }
    } else if (B.sp === 'air') {
      const u = B.st / s.air;
      if (u < 0.55) { const to = P.pos.clone().sub(s.target).setY(0); const l = to.length(); if (l > 0.01) s.target.add(to.multiplyScalar(Math.min(1, 6 * dt / l))); }
      const tgt = s.target.clone(); { const tmp = tgt.clone(); world.constrain(tmp, BR, true); tgt.copy(tmp); s.target.copy(tgt); }
      B.pos.x = lerp(s.from.x, s.target.x, ease(u)); B.pos.z = lerp(s.from.z, s.target.z, ease(u));
      B.lift = Math.sin(Math.min(1, u) * Math.PI) * 5.5;
      B.facing = turnTo(B.facing, Math.atan2(s.target.x - s.from.x, s.target.z - s.from.z), 6 * dt);
      placeTele(s); if (B.tele) B.tele.set(0.4 + u * 0.6, u > 0.75);
      if (u > 0.78) { B.rig.tip.getWorldPosition(glint.position); glint.material.opacity = 1; }
      if (u >= 1) { B.lift = 0; B.sp = 'act'; B.st = 0; bTrail.active = true; }
    } else if (B.sp === 'act') {
      if (s.shape === 'line') {
        const sp = s.len / s.act;
        B.pos.addScaledVector(s.dir, sp * dt);
        world.constrain(B.pos, BR, true);
        if (Math.random() < 0.8) SMOKE.emit(B.pos.clone().setY(0.2), { count: 3, speed: 1, life: 0.6, size: 0.7, sizeEnd: 1.6, color: [0.4, 0.36, 0.3], drag: 3, flat: true });
        if (B.phase === 2) FX.emit(B.pos.clone().setY(1.5), { count: 3, speed: 1, up: 1, life: 0.4, size: 0.4, colors: [BD.fxCols[0]] });
        if (!s.hitDone && segDist(P.pos, s.prev, B.pos) < s.width / 2 + PR) {
          const r = resolvePlayerHit(s.dmg, true, s.prev.clone().addScaledVector(s.dir, -2)); if (r !== 'none') s.hitDone = true;
        }
        s.prev.copy(B.pos);
        if (B.tele) B.tele.set(1, false);
      } else if (!s.hitDone && B.st >= s.act * (s.anim === 'spin' ? 0.35 : 0.45)) {
        s.hitDone = true; clearTele();
        bossStrikeFX(s);
        if (inArea(s)) resolvePlayerHit(s.dmg, !!s.heavy, B.pos.clone());
        if (s.shape === 'leap' && B.phase === 2) spawnFireRing(s.target, 17, 10.5, 34);
      }
      if (s.adv && flatDist(P.pos, B.pos) > BR + PR + 0.8) B.pos.addScaledVector(fwdOf(B.facing), s.adv / s.act * dt * (B.st < s.act * 0.6 ? 1 : 0.3));
      if (B.st >= s.act) { B.sp = 'rec'; B.st = 0; clearTele(); bTrail.active = false; }
    } else if (B.sp === 'rec') {
      if (B.st >= s.rec) {
        if (B.atk.i < B.atk.steps.length - 1) { B.atk.i++; startStep(); }
        else { B.atk = null; B.state = 'chase'; B.t = 0; B.cd = B.phase === 2 ? 0.35 + Math.random() * 0.6 : 0.8 + Math.random() * 0.9; }
      }
    }
  }
  function bossAttackPose() {
    const s = curStep(), A = BA[s.anim];
    if (B.sp === 'wind') {
      const u = ease(Math.min(1, B.st / (s.wind * 0.7)));
      const o = {}; for (const k in A.W) o[k] = lerp(B_IDLE[k] ?? 0, A.W[k], u);
      if (B.st > s.wind * 0.7) o.tX = (o.tX || 0) + Math.sin(G.t * 45) * 0.015; // 蓄势颤动
      return Object.assign({}, B_IDLE, o);
    }
    if (B.sp === 'air') return Object.assign({}, B_IDLE, A.AIR);
    if (B.sp === 'act') {
      const u = ease(Math.min(1, B.st / (s.act * 0.6)));
      const o = {}; const keys = new Set([...Object.keys(A.W), ...Object.keys(A.S)]);
      keys.forEach(k => o[k] = lerp(A.W[k] ?? B_IDLE[k] ?? 0, A.S[k] ?? B_IDLE[k] ?? 0, u));
      return Object.assign({}, B_IDLE, o);
    }
    const u = ease(Math.min(1, B.st / Math.max(0.1, s.rec)));
    const o = {}; for (const k in A.S) o[k] = lerp(A.S[k], B_IDLE[k] ?? 0, u);
    return Object.assign({}, B_IDLE, o);
  }

  function damageBoss(dmg, poise, at, heavyLv) {
    if (!B.alive || B.state === 'dying') return;
    if (B.state === 'transform') { dmgNum(at, '无效', 'immune'); AudioSys.S.hit(0); FX.emit(at, { count: 8, speed: 3, life: 0.3, size: 0.1, color: [1, 0.6, 0.3] }); return; }
    const mult = B.state === 'stagger' ? 1.35 : 1;
    const v = Math.round(dmg * mult * (0.92 + Math.random() * 0.16));
    B.hp = Math.max(0, B.hp - v); B.flash = 1;
    dmgNum(at, v, heavyLv ? 'heavy' : '');
    AudioSys.S.hit(heavyLv ? 1 : 0);
    G.hitStop = heavyLv ? 0.08 + heavyLv * 0.02 : 0.045;
    G.shake = Math.max(G.shake, heavyLv ? 0.25 + heavyLv * 0.08 : 0.1);
    FX.emit(at, { count: heavyLv ? 36 : 18, speed: heavyLv ? 8 : 5, life: 0.35, size: 0.1, colors: [[1, 0.85, 0.5], [1, 0.6, 0.2], [1, 1, 0.9]], gravity: 6, drag: 2 });
    SMOKE.emit(at, { count: 4, speed: 1.5, life: 0.6, size: 0.4, sizeEnd: 1.0, color: [0.1, 0.09, 0.08], drag: 2 });
    // 破势
    B.poiseT = 0;
    if (B.state !== 'stagger' && !(B.state === 'attack' && B.sp === 'act') && B.state !== 'intro') {
      B.poise += poise;
      if (B.poise >= B.poiseMax) {
        B.poise = 0; B.state = 'stagger'; B.t = 0; B.atk = null; clearTele(); bTrail.active = false; B.lift = 0;
        banner('破 势', 'break', 1.0); AudioSys.S.slam(0.6); G.shake = 0.4;
      }
    }
    if (B.phase === 1 && B.hp <= B.maxHp / 2 && B.hp > 0) startTransform();
    if (B.hp <= 0) bossDie();
  }
  function startTransform() {
    B.state = 'transform'; B.t = 0; B.atk = null; clearTele(); bTrail.active = false; B.lift = 0; B.poise = 0; B.roared = false;
    slowmo(0.45, 0.7);
    banner(BD.p2Name, 'phase', 2.4);
  }
  function bossDie() {
    B.state = 'dying'; B.t = 0; B.alive = false; B.atk = null; clearTele(); clearHazards(); bTrail.active = false; B.lift = 0;
    G.lock = false; LT = null; G.bossDefeated = true; G.finalT = G.fightT;
    slowmo(0.25, 1.6);
    banner('得 胜', 'victory', 3.2);
    AudioSys.setMode('victory');
    setTimeout(() => AudioSys.S.victory(), 600);
    G.shake = 0.5;
    setTimeout(showResult, 5200);
  }

  function updateBoss(dt) {
    const b = B;
    b.flash = Math.max(0, b.flash - dt * 6);
    glint.material.opacity = Math.max(0, glint.material.opacity - dt * 6);
    if (b.state === 'dormant' && b.rig.root.visible === false) return;
    if (b.freeze > 0 && b.state !== 'dying') {
      b.freeze -= dt;
      if (Math.random() < 0.5) FX.emit(b.pos.clone().setY(1 + Math.random() * 3), { count: 1, speed: 0.4, up: 0.8, life: 1, size: 0.16, color: [1, 0.85, 0.4], radius: 2.2 });
      if (b.freeze <= 0) { msg(CH.spell + '解除'); }
      const fd = flatDist(P.pos, b.pos);
      if (fd < BR + PR && fd > 0.001) { P.pos.x = b.pos.x + (P.pos.x - b.pos.x) / fd * (BR + PR); P.pos.z = b.pos.z + (P.pos.z - b.pos.z) / fd * (BR + PR); }
      tintBoss(); return;
    }
    b.t += dt;
    b.poiseT += dt; if (b.poiseT > 3) b.poise = Math.max(0, b.poise - 20 * dt);
    const to = new V3(P.pos.x - b.pos.x, 0, P.pos.z - b.pos.z), dist = to.length(), angTo = Math.atan2(to.x, to.z);
    let tgt = B_IDLE, extra = { spin: 0, lift: b.lift, tilt: 0 }, rate = 14, walking = 0;
    switch (b.state) {
      case 'dormant':
        tgt = B_SIT;
        if (G.fight) { b.state = 'intro'; b.t = 0; }
        break;
      case 'intro':
        if (b.t < 0.7) tgt = B_SIT; else if (b.t < 1.3) tgt = B_IDLE; else tgt = B_ROAR;
        b.facing = turnTo(b.facing, angTo, 2 * dt);
        if (b.t > 1.3 && !b.roared) { b.roared = true; AudioSys.S.roar(); G.shake = 0.5; shockwave(b.pos, BD.roarFx, 10, 0.9, 0.5); }
        if (b.t > 3.0) { b.state = 'chase'; b.t = 0; b.cd = 0.6; b.roared = false; }
        rate = 6;
        break;
      case 'chase': {
        if (P.state === 'dead') { b.state = 'gloat'; b.t = 0; break; }
        const tr = b.phase === 2 ? 3.6 : 2.8;
        b.facing = turnTo(b.facing, angTo, tr * dt);
        b.cd -= dt; b.strafeT -= dt;
        if (b.strafeT <= 0) { b.strafe = Math.random() < 0.5 ? -1 : 1; b.strafeT = 1.5 + Math.random() * 2; }
        const align = Math.max(0, Math.cos(angDiff(b.facing, angTo)));
        if (dist > 3.8) { const sp = (b.phase === 2 ? BD.speed[1] : BD.speed[0]) * (dist > 10 ? 1.25 : 1) * align; b.pos.addScaledVector(fwdOf(b.facing), sp * dt); walking = sp; }
        else { const side = new V3(to.z, 0, -to.x).normalize().multiplyScalar(b.strafe); b.pos.addScaledVector(side, 1.3 * dt); walking = 1.3; }
        if (b.cd <= 0) { const a = chooseAttack(dist); if (a) startAttack(a); else b.cd = 0.3; }
        break;
      }
      case 'attack':
        updateBossAttack(dt);
        if (b.state === 'attack') { tgt = bossAttackPose(); rate = 22; const s = curStep(); if (s.anim === 'spin' && b.sp === 'act') extra.spin = TAU * ease(Math.min(1, b.st / s.act)); }
        extra.lift = b.lift;
        break;
      case 'stagger':
        tgt = B_STAG; rate = 10;
        if (b.t > 2.1) { b.state = 'chase'; b.t = 0; b.cd = 0.3; }
        break;
      case 'transform':
        if (b.t < 0.8) tgt = B_STAG; else tgt = B_ROAR;
        rate = 6;
        b.facing = turnTo(b.facing, angTo, 1.5 * dt);
        if (b.t > 0.8 && !b.roared) {
          b.roared = true; AudioSys.S.roar(); AudioSys.setMode('battle2');
          G.shake = 0.8; shockwave(b.pos, BD.p2Color, 12, 1.0, 0.9); vRing(b.pos, BD.p2Color, 10, 1.0, 4);
          flash('phase');
          if (dist < 9 && P.state !== 'dead') { // 气浪击退（无伤害）
            const dir = to.clone().normalize(); P.state = 'hurt'; P.t = 0; P.hurtDur = 0.55; P.knock.copy(dir).multiplyScalar(11); P.invuln = 0.5; P.rig.gourdHand.visible = false; P.rig.gourdWaist.visible = true;
          }
        }
        b.aura = clamp((b.t - 0.8) / 1.6, 0, 1);
        if (b.t > 0.8) FX.emit(b.pos.clone().setY(1 + Math.random() * 3), { count: 4, speed: 2, up: 3, life: 0.8, size: 0.4, colors: BD.fxCols, radius: 2 });
        if (b.rig.setDragon) b.rig.setDragon(b.aura);
        if (b.t > 3.2) {
          b.phase = 2; b.state = 'chase'; b.t = 0; b.cd = 0.4; b.poiseMax = 160;
          msg(BD.p2Msg, 3.5);
        }
        break;
      case 'gloat':
        tgt = b.t < 1.5 ? B_IDLE : B_ROAR; rate = 5;
        if (b.t > 1.5 && !b.roared) { b.roared = true; AudioSys.S.growl(1); }
        break;
      case 'dying':
        if (b.t < 1.0) tgt = B_STAG; else { tgt = B_STAG; extra.tilt = Math.min(1, (b.t - 1.0) / 1.0) * 1.35; extra.lift = -Math.min(1, (b.t - 1.0) / 1.0) * 1.2; }
        rate = 6;
        if (b.t > 2.2) {
          b.dissolve = Math.min(1, (b.t - 2.2) / 2.2);
        if (b.rig.fx) b.rig.fx.visible = b.dissolve < 0.6;
          b.rig.root.scale.setScalar(Math.max(0.01, 1 - b.dissolve * 0.6));
          SMOKE.emit(b.pos.clone().setY(0.5 + Math.random() * 2), { count: 6, speed: 1.5, up: 2.5, life: 1.5, size: 0.8, sizeEnd: 2.2, color: [0.05, 0.05, 0.06], drag: 1, radius: 3 });
          FX.emit(b.pos.clone().setY(0.5 + Math.random() * 2), { count: 2, speed: 1, up: 3, life: 1.2, size: 0.15, colors: [[1, 0.6, 0.2], [1, 0.85, 0.4]], radius: 3 });
          if (b.dissolve >= 1) b.rig.root.visible = false;
        }
        break;
    }
    if (b.state !== 'dying') world.constrain(b.pos, BR, true);
    // 推开玩家
    const dd = flatDist(P.pos, b.pos);
    if (dd < BR + PR && b.lift < 1.5 && b.state !== 'dying') { const n = new V3(P.pos.x - b.pos.x, 0, P.pos.z - b.pos.z).normalize(); P.pos.x = b.pos.x + n.x * (BR + PR); P.pos.z = b.pos.z + n.z * (BR + PR); }
    // 姿势
    if (walking > 0.1 && b.state === 'chase') {
      b.ph += walking * dt * 1.6;
      const s = Math.sin(b.ph), c = Math.cos(b.ph);
      tgt = Object.assign({}, B_IDLE, { lhX: -s * 0.5, rhX: s * 0.5, lkX: 0.3 + Math.max(0, c) * 0.6, rkX: 0.3 + Math.max(0, -c) * 0.6, hipY: -0.06 - Math.abs(s) * 0.04, lsX: s * 0.35 - 0.3, tY: s * 0.08 });
    }
    Chars.blendPose(b.pose, tgt, 1 - Math.exp(-dt * rate));
    Chars.applyPose(b.rig, b.pose, extra);
    b.rig.root.position.set(b.pos.x, 0, b.pos.z);
    b.rig.root.rotation.y = b.facing;
    // 眼睛与火焰
    const ph2 = b.phase === 2 || b.state === 'transform' ? Math.max(b.aura, b.phase === 2 ? 1 : 0) : 0;
    b.rig.eyeM.emissiveIntensity = 3 + ph2 * 5 + (b.state === 'attack' && b.sp === 'wind' ? 3 : 0);
    b.rig.fireM.opacity = ph2 * (0.45 + Math.sin(G.t * 20) * 0.1);
    if (ph2 > 0.5 && b.state !== 'dying' && Math.random() < 0.35) { const t = new V3(); b.rig.tip.getWorldPosition(t); FX.emit(t, { count: 1, speed: 0.6, up: 1.5, life: 0.5, size: 0.3, colors: [BD.fxCols[0]] }); }
    if (b.rig.update && b.rig.root.visible) b.rig.update(dt, G.t);
    tintBoss();
  }
  function tintBoss() {
    const fz = B.freeze > 0 ? 1 : 0, tc = CH.tint, ph = B.phase === 2 ? 0.08 + Math.sin(G.t * 4) * 0.03 : B.aura * 0.08;
    B.rig.flashMats.forEach(m => {
      m.emissive.setRGB(B.flash * 0.6 + fz * tc[0] + ph, B.flash * 0.55 + fz * tc[1] + ph * 0.3, B.flash * 0.5 + fz * tc[2]);
    });
  }

  function onLand(vyImpact) {
    const hard = vyImpact < -9;
    AudioSys.S.land(hard ? 1 : 0.5);
    SMOKE.emit(P.pos.clone().setY(0.1), { count: hard ? 14 : 8, speed: hard ? 2.4 : 1.4, life: 0.7, size: 0.5, sizeEnd: 1.3, color: [0.55, 0.5, 0.42], drag: 3, flat: true, radius: 0.5 });
    if (P.state === 'jump') { P.state = 'land'; P.t = 0; } // 落地无硬直：land 状态可立即被任意动作打断
    else if (P.state === 'roll') { P.rollAir = false; } // 空中翻身落地后顺势继续地滚
    else if (P.state === 'airatk') airSlam();
  }
  function airSlam() {
    const c = P.pos.clone().addScaledVector(fwdOf(P.facing), 1.8);
    AudioSys.S.slam(0.7); AudioSys.S.hit(0);
    shockwave(c, 0xffd890, 3.4, 0.5);
    SMOKE.emit(c.clone().setY(0.2), { count: 18, speed: 3.5, life: 0.8, size: 0.6, sizeEnd: 1.6, color: [0.55, 0.5, 0.42], flat: true, drag: 3, radius: 0.8 });
    FX.emit(c.clone().setY(0.3), { count: 18, speed: 5, life: 0.5, size: 0.1, color: [1, 0.85, 0.5], gravity: 10 });
    G.shake = Math.max(G.shake, 0.3);
    if (!P.hitDone) playerHitCheck({ range: 3.1, arc: 150, dmg: 46, poise: 26, level: 1 }, true);
    P.state = 'land'; P.t = -0.18; P.vel.set(0, 0, 0); pTrail.active = false;
  }

  // ---------- 玩家更新 ----------
  function updatePlayer(dt) {
    const p = P; p.t += dt;
    p.invuln = Math.max(0, p.invuln - dt); p.spellCD = Math.max(0, p.spellCD - dt); p.stDelay -= dt; p.comboTimer -= dt; p.tiredT -= dt;
    const mv = inputDir(), moving = mv.lengthSq() > 0;
    const lockOn = lockAlive();
    let tgt = P_IDLE, extra = { spin: 0 }, rate = 16, regen = false;
    const sh = keys.ShiftLeft || keys.ShiftRight;

    // —— 竖直物理（跳跃 / 空中翻身 / 跳劈 / 受击时在空中都适用） ——
    if (airborne()) {
      const g = p.state === 'airatk' && p.t < 0.2 ? GRAV * 0.25 : GRAV;
      p.vy -= g * dt; p.y += p.vy * dt;
      if (p.y <= 0) { const v = p.vy; p.y = 0; p.vy = 0; onLand(v); }
    }
    const inAir = airborne();

    switch (p.state) {
      case 'idle': case 'move': case 'land': {
        if (p.state === 'land' && p.t < 0) { // 跳劈落地的短暂收势（仍可翻滚/跳跃取消）
          tgt = L3b; rate = 24; p.vel.multiplyScalar(Math.exp(-dt * 10)); p.pos.addScaledVector(p.vel, dt); break;
        }
        p.sprinting = sh && moving && !p.exhausted && p.st > 0;
        const speed = (p.sprinting ? 8.4 : (lockOn ? 4.2 : 4.8)) * CH.speedMul;
        // 速度平滑：翻滚/跳跃带来的高速自然衰减到跑步速度，而不是突然停住
        const want = mv.clone().multiplyScalar(moving ? speed : 0);
        const cur = p.vel.length();
        const k = moving ? (cur > speed + 0.5 ? 5 : 14) : 12;
        p.vel.lerp(want, 1 - Math.exp(-dt * k));
        p.pos.addScaledVector(p.vel, dt);
        const sp = p.vel.length();
        if (moving) {
          if (lockOn && !p.sprinting) faceTarget(14, dt); else p.facing = turnTo(p.facing, Math.atan2(mv.x, mv.z), 13 * dt);
        } else if (lockOn) faceTarget(10, dt);
        if (sp > 0.4) {
          p.ph += sp * dt * 2.7;
          p.stepT -= dt * sp; if (p.stepT <= 0) { p.stepT = CH.glide ? 3.5 : 1.4; if (CH.glide) AudioSys.S.wheel(); else AudioSys.S.step(); if (p.sprinting) SMOKE.emit(p.pos.clone().setY(0.1), { count: 2, speed: 0.6, life: 0.6, size: 0.35, sizeEnd: 0.8, color: [0.55, 0.5, 0.42], flat: true }); }
        }
        if (p.sprinting) { p.st -= 16 * dt; p.stDelay = 0.6; if (p.st <= 0) { p.st = 0; p.exhausted = true; tired(); } }
        else regen = true;
        if (p.state !== 'land' || p.t > 0.12) p.state = sp > 0.4 || moving ? 'move' : 'idle';
        if (sp > 0.4) {
          const s = Math.sin(p.ph), c = Math.cos(p.ph), amp = clamp(sp / 5.5, 0.4, 1.3);
          const run = p.sprinting || sp > 6.5;
          const base = run ? { ...P_IDLE, tX: 0.42, rsX: 0.7, rsZ: -0.15, reX: -0.3, wX: -2.4, wZ: 0.2, lsX: s * 0.9, leX: -1.1 } : { ...P_IDLE, lsX: -0.55 + s * 0.35 };
          tgt = Object.assign({}, base, { lhX: -s * 0.7 * amp, rhX: s * 0.7 * amp, lkX: 0.25 + Math.max(0, c) * 0.9 * amp, rkX: 0.25 + Math.max(0, -c) * 0.9 * amp, hipY: -0.03 - Math.abs(c) * 0.05 * amp, tY: s * 0.1 });
          if (CH.glide) { // 哪吒：脚踏风火轮滑行，不迈步，身体前倾
            const lean = clamp(sp / 9.5, 0, 1);
            // 悬浮：躯干基本直立（整体前倾交给 HoverMotion），持枪手后拖、空手前伸保持平衡
            tgt = Object.assign({}, P_IDLE, { tX: 0.06, tY: 0.12, hipY: 0, rsX: 0.35 + lean * 0.5, rsZ: -0.25, reX: -0.5, wX: -1.9 - lean * 0.4, wZ: 0.25, lsX: -0.5 - lean * 0.5, lsZ: 0.35 + lean * 0.3, leX: -0.6 });
          }
        } else {
          tgt = Object.assign({}, P_IDLE, { tX: P_IDLE.tX + Math.sin(G.t * 2) * 0.02 });
        }
        if (p.state === 'land' && p.t < 0.12) tgt = Object.assign({}, tgt, { hipY: tgt.hipY - 0.12 * (1 - p.t / 0.12), lkX: tgt.lkX + 0.4, rkX: tgt.rkX + 0.4 });
        break;
      }
      case 'jump': {
        // 空中可微调方向，保留起跳/翻滚带来的惯性
        if (moving) {
          const keep = Math.max(p.vel.length(), 4.6);
          p.vel.lerp(mv.clone().multiplyScalar(keep), 1 - Math.exp(-dt * 3));
          if (!lockOn) p.facing = turnTo(p.facing, Math.atan2(mv.x, mv.z), 8 * dt);
        }
        if (lockOn) faceTarget(8, dt);
        p.pos.addScaledVector(p.vel, dt);
        tgt = p.vy > 0 ? JUMP_UP : JUMP_DOWN; rate = 12;
        if (!inAir) p.state = 'land';
        break;
      }
      case 'roll': {
        const T = ROLL_T;
        if (!inAir) {
          let v = p.rollSpeed * Math.max(0.42, 1.3 - 0.95 * p.t / T);
          if (p.rollCarry && sh && moving) v = Math.max(v, p.rollCarry); // 按住疾奔：保持奔跑速度
          p.vel.copy(p.rollDir).multiplyScalar(v);
        } else if (moving) {
          const keep = p.vel.length();
          p.vel.lerp(mv.clone().multiplyScalar(keep), 1 - Math.exp(-dt * 2));
        }
        p.pos.addScaledVector(p.vel, dt);
        if (!p.backstep) p.facing = turnTo(p.facing, p.rollFace, 25 * dt);
        const u = clamp((p.t - 0.02) / (T * 0.8), 0, 1);
        p.flipAng = p.flipBase + (p.flipEnd - p.flipBase) * ease(u);
        tgt = u < 0.9 ? ROLL_TUCK : JUMP_DOWN; rate = 30;
        if (p.t >= T) {
          p.flipAng = 0; p.flipBase = 0; p.flipEnd = 0;
          if (inAir) { p.state = 'jump'; p.t = 0.3; }
          else { p.state = moving ? 'move' : 'idle'; p.t = 0; } // 结束即恢复奔跑，按住 Shift 直接续上疾奔
        }
        break;
      }
      case 'airatk': {
        const t = p.t;
        if (t >= 0.2 && !p.slammed) { p.slammed = true; p.vy = -17; AudioSys.S.swing(1.3); pTrail.active = true; }
        if (lockOn) faceTarget(10, dt);
        p.vel.multiplyScalar(Math.exp(-dt * 2.5));
        if (lockOn && flatDist(p.pos, lockPos()) > 3) p.pos.addScaledVector(fwdOf(p.facing), 3 * dt);
        p.pos.addScaledVector(p.vel, dt);
        tgt = t < 0.2 ? Object.assign({}, L3a, { lhX: -1.0, lkX: 1.4, rhX: -0.3, rkX: 0.8 }) : Object.assign({}, L3b, { lhX: -0.6, lkX: 0.7 });
        rate = 26;
        break;
      }
      case 'attack': case 'heavy': {
        const a = p.atk, t = p.t;
        if (t < a.h0 * 0.9) faceTarget(lockOn ? 10 : 6, dt);
        if (t < a.h1) {
          const want = flatDist(p.pos, B.pos) - BR - 1.2;
          if (!(B.alive && want < 0.2)) p.pos.addScaledVector(fwdOf(p.facing), a.lunge / a.h1 * dt);
        }
        if (!p.swung && t >= a.h0 * 0.85) { p.swung = true; AudioSys.S.swing(a.swing); }
        if (t >= a.h0 && t <= a.h1) { pTrail.active = true; playerHitCheck(a); } else if (t > a.h1 + 0.05) pTrail.active = false;
        if (t >= a.h0 && t < a.h0 + 0.1) pTrail.active = true;
        if (p.state === 'heavy' && !p.slammed && t >= a.h0 + 0.04) {
          p.slammed = true;
          const c = p.pos.clone().addScaledVector(fwdOf(p.facing), 2.3);
          AudioSys.S.slam(0.45 + a.level * 0.2);
          shockwave(c, 0xffd890, 2 + a.level * 1.2, 0.5);
          SMOKE.emit(c.clone().setY(0.2), { count: 10 + a.level * 8, speed: 3 + a.level, life: 0.8, size: 0.6, sizeEnd: 1.6, color: [0.55, 0.5, 0.42], flat: true, drag: 3, radius: 0.8 });
          FX.emit(c.clone().setY(0.3), { count: 12 + a.level * 10, speed: 5, life: 0.5, size: 0.1, color: [1, 0.85, 0.5], gravity: 10 });
          G.shake = Math.max(G.shake, 0.15 + a.level * 0.1);
        }
        if (a.slam && !p.slammed && t >= a.h1) { p.slammed = true; const c = p.pos.clone().addScaledVector(fwdOf(p.facing), 2.4); SMOKE.emit(c.setY(0.2), { count: 6, speed: 2, life: 0.6, size: 0.5, sizeEnd: 1.2, color: [0.55, 0.5, 0.42], flat: true }); }
        if (a.spin) extra.spin = TAU * ease(clamp((t / a.dur - 0.22) / 0.43, 0, 1));
        tgt = Chars.keyframes(P_IDLE, a.kf, t / a.dur);
        rate = 30;
        if (p.state === 'attack' && p.queued && t >= a.chain) {
          if (!startLight((p.combo + 1) % 4)) p.queued = false;
        } else if (t >= a.dur) {
          pTrail.active = false;
          p.comboTimer = p.state === 'attack' && p.combo < 3 ? 0.45 : 0;
          p.state = 'idle'; p.t = 0;
        }
        break;
      }
      case 'charge': {
        p.charge += dt;
        const lv = p.charge >= 1.5 ? 3 : p.charge >= 1.0 ? 2 : p.charge >= 0.5 ? 1 : 0;
        if (lv > p.level) {
          p.level = lv; AudioSys.S.charge(lv);
          const t = new V3(); p.rig.tip.getWorldPosition(t);
          FX.emit(t, { count: 14 + lv * 6, speed: 2.5, life: 0.5, size: 0.14, colors: [[1, 0.85, 0.4], [1, 1, 0.8]] });
          if (lv === 3) msg('蓄力已满', 0.8);
        }
        const g = p.level / 3;
        p.rig.gold.emissive.setRGB(1.0 * g + 0.15 * Math.sin(G.t * 20) * g, 0.6 * g, 0.15 * g);
        if (Math.random() < 0.3 + g * 0.5) { const t = new V3(); p.rig.tip.getWorldPosition(t); FX.emit(t, { count: 1, speed: 0.5, up: 1, life: 0.4, size: 0.1 + g * 0.1, color: [1, 0.8, 0.35] }); }
        if (moving) p.pos.addScaledVector(mv, 1.0 * dt);
        faceTarget(8, dt);
        tgt = Object.assign({}, HC, { tX: HC.tX + Math.sin(G.t * 40) * 0.01 * p.level });
        if (!(mouseR || keys.KeyK) || p.charge > 3.0) onHeavyUp();
        break;
      }
      case 'drink': {
        if (moving) { p.pos.addScaledVector(mv, 1.1 * dt); p.facing = turnTo(p.facing, Math.atan2(mv.x, mv.z), 4 * dt); }
        if (!p.gulped && p.t > 0.25) { p.gulped = true; AudioSys.S.gulp(); }
        if (!p.healed && p.t >= 0.62) {
          p.healed = true; p.gourds--; G.gourdUsed++;
          const h = Math.round(p.maxHp * 0.38); p.hp = Math.min(p.maxHp, p.hp + h);
          AudioSys.S.heal(); flash('heal');
          dmgNum(p.pos.clone().setY(2.1), '+' + h, 'heal');
          FX.emit(p.pos.clone().setY(1), { count: 30, speed: 1.5, up: 2, life: 0.9, size: 0.12, colors: [[0.6, 1, 0.5], [1, 0.9, 0.5]], radius: 1, drag: 2 });
        }
        tgt = { ...P_IDLE, lsX: -2.35, lsZ: -0.55, leX: -1.7, hX: -0.45, tX: -0.05 };
        if (p.t >= 1.15) { p.state = 'idle'; p.t = 0; p.rig.gourdHand.visible = false; p.rig.gourdWaist.visible = true; }
        regen = true;
        break;
      }
      case 'cast': {
        if (!p.cast && p.t >= 0.22) {
          p.cast = true;
          if (B.alive && B.state !== 'transform' && B.state !== 'dying') {
            B.freeze = B.phase === 2 ? 3.2 : 4.2; p.spellCD = p.spellMax;
            AudioSys.S.spell(); flash('spell'); banner(CH.banner, 'spell', 1.0);
            vRing(B.pos, CH.ring, 3.5, 0.8, 5); shockwave(B.pos, CH.ring, 4, 0.7);
            if (CH.id === 'nezha') { vRing(B.pos, 0xff2010, 2.4, 1.2, 4.5); for (let k = 0; k < 40; k++) { const a = k / 40 * TAU * 3; FX.emit(new V3(B.pos.x + Math.sin(a) * 1.8, 0.3 + k * 0.1, B.pos.z + Math.cos(a) * 1.8), { count: 1, speed: 0.3, life: 0.9, size: 0.22, colors: [[1, 0.15, 0.05], [1, 0.4, 0.1]] }); } }
            glint.material.opacity = 0; clearTeleIfWind();
            const h = new V3(); p.rig.lH.getWorldPosition(h); FX.emit(h, { count: 20, speed: 3, life: 0.5, size: 0.12, color: [1, 0.85, 0.4] });
          }
        }
        tgt = { ...P_IDLE, lsX: -1.55, lsZ: -0.05, leX: -0.15, tY: -0.35, hY: 0.2 };
        if (p.t >= 0.6) { p.state = 'idle'; p.t = 0; }
        break;
      }
      case 'hurt': {
        p.pos.addScaledVector(p.knock, dt); p.knock.multiplyScalar(Math.exp(-dt * 7));
        tgt = { ...P_IDLE, tX: -0.45, hX: -0.4, hipY: -0.1, rsX: 0.2, lsX: 0.4, lhX: -0.3, lkX: 0.5 };
        rate = 20;
        if (p.t >= p.hurtDur) { p.state = 'idle'; p.t = 0; }
        break;
      }
      case 'dead': {
        p.pos.addScaledVector(p.knock, dt); p.knock.multiplyScalar(Math.exp(-dt * 6));
        tgt = { ...P_IDLE, tX: -0.2, hX: -0.3, rsX: -2.5, rsZ: -0.6, lsX: -2.5, lsZ: 0.6, lhX: -0.2, rhX: 0.1, lkX: 0.3, hipY: 0 };
        extra.tilt = -Math.min(1, p.t / 0.7) * 1.45; extra.lift = Math.min(1, p.t / 0.7) * 0.15;
        rate = 8;
        break;
      }
    }
    if (regen && p.stDelay <= 0) {
      p.st = Math.min(p.maxSt, p.st + (p.exhausted ? 24 : 36) * dt);
      if (p.exhausted && p.st >= 30) p.exhausted = false;
    }
    world.constrain(p.pos, PR, G.fight && B.alive);
    // 翻滚角度在离开翻滚状态后平滑收回到整圈，避免“翻滚跳”时姿态瞬间弹回
    if (p.state !== 'roll' && p.flipAng !== 0) {
      const d = p.flipEnd - p.flipAng;
      p.flipAng += Math.sign(d) * Math.min(Math.abs(d), 15 * dt);
      if (Math.abs(p.flipEnd - p.flipAng) < 0.02) { p.flipAng = 0; p.flipEnd = 0; p.flipBase = 0; }
    }
    extra.flip = p.flipAng; extra.flipC = 0.6;
    if (p.rig.hover) { // 哪吒：把运动学状态喂给悬浮系统（离地高度、惯性前倾、转弯侧倾、腿部拖尾）
      const hs = p.state === 'move' ? (p.sprinting || p.vel.length() > 7 ? 'sprint' : 'move') : p.state === 'idle' && p.vel.length() > 0.6 ? 'move' : p.state;
      const mvd = inputDir();
      p.rig.hover.feed(dt, hs, p.vel, p.vy, p.facing, mvd.lengthSq() ? Math.atan2(mvd.x, mvd.z) : null);
      tgt.__attacking = p.state === 'attack' || p.state === 'heavy' || p.state === 'airatk';
    }
    Chars.blendPose(p.pose, tgt, 1 - Math.exp(-dt * rate));
    p.pose.__attacking = !!tgt.__attacking;
    Chars.applyPose(p.rig, p.pose, extra);
    p.rig.root.position.set(p.pos.x, p.y, p.pos.z);
    p.rig.root.rotation.y = p.facing;
    p.rig.update(dt, G.t, p.vel.length());
    if (p.rig.wheels && p.rig.root.visible) { // 风火轮喷火
      const sp = p.vel.length(), back = p.vel.clone().setY(0); if (back.lengthSq() > 0.01) back.normalize().negate(); back.y = 0.35;
      p.rig.wheels.forEach(w => { if (Math.random() < 0.45 + sp * 0.07) { const wp = new V3(); w.spin.getWorldPosition(wp); FX.emit(wp, { count: sp > 6 ? 2 : 1, speed: 0.8 + sp * 0.15, up: 0.6, life: 0.3 + Math.min(0.3, sp * 0.03), size: 0.16, sizeEnd: 0.05, colors: [[1, 0.42, 0.06], [1, 0.72, 0.22], [1, 0.25, 0.04]], drag: 2.5, dir: back, spread: 0.7 }); } });
    }
    // 飘带随动
    p.rig.sash.rotation.x = Math.sin(G.t * 3) * 0.1 - (p.state === 'move' ? 0.3 : 0);
  }
  function clearTeleIfWind() { /* 定身时保留预兆，解除后继续 */ }

  // ---------- 镜头 ----------
  const ray = new THREE.Raycaster();
  function updateCamera(dt) {
    cam.py += (P.y - cam.py) * (1 - Math.exp(-dt * 6));
    const head = new V3(P.pos.x, 1.55 + cam.py * 0.75, P.pos.z);
    let lookAt = head.clone(), want = 5.4;
    if (!G.lock && !locked() && G.noLock) {
      if (keys.ArrowLeft) cam.yaw += 2.2 * dt; if (keys.ArrowRight) cam.yaw -= 2.2 * dt;
      if (keys.ArrowUp) cam.pitch = clamp(cam.pitch - 1.5 * dt, -0.3, 1.1); if (keys.ArrowDown) cam.pitch = clamp(cam.pitch + 1.5 * dt, -0.3, 1.1);
    }
    if (lockAlive()) {
      const LP = lockPos(), isB = LT === B;
      const d = new V3(LP.x - P.pos.x, 0, LP.z - P.pos.z), dist = d.length();
      const yawT = Math.atan2(d.x, d.z);
      cam.yaw += angDiff(cam.yaw, yawT) * (1 - Math.exp(-dt * 7));
      const pitchT = clamp(0.36 - dist * 0.012, 0.14, 0.36);
      cam.pitch += (pitchT - cam.pitch) * (1 - Math.exp(-dt * 4));
      const bossChest = new V3(LP.x, (isB ? BD.chest + B.lift * 0.6 : 1.6), LP.z);
      lookAt = head.clone().lerp(bossChest, dist < 4 ? 0.25 : 0.38);
      want = 6.2 + Math.max(0, 5 - dist) * 0.25;
    }
    const f = new V3(Math.sin(cam.yaw) * Math.cos(cam.pitch), -Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch));
    const right = new V3(-Math.cos(cam.yaw), 0, Math.sin(cam.yaw));
    const pivot = head.clone().addScaledVector(right, 0.45);
    const dir = f.clone().negate();
    // 遮挡检测：墙、岩石、树干
    let allowed = want;
    ray.set(pivot, dir); ray.far = want + 0.3;
    const hits = ray.intersectObjects(world.blockers, false);
    if (hits.length) allowed = Math.max(0.55, hits[0].distance - 0.35);
    for (let k = 1; k <= 10; k++) { // 地形
      const q = pivot.clone().addScaledVector(dir, want * k / 10);
      if (q.y < world.heightAt(q.x, q.z) + 0.35) { allowed = Math.min(allowed, Math.max(0.55, want * (k - 1) / 10)); break; }
    }
    // Boss 身体
    const bc = new V3(B.pos.x, BD.chest - 0.1 + B.lift, B.pos.z), oc = pivot.clone().sub(bc);
    if (B.rig.root.visible) {
      const bq = oc.dot(dir), cq = oc.lengthSq() - BD.camR * BD.camR, disc = bq * bq - cq;
      if (disc > 0) { const t0 = -bq - Math.sqrt(disc); if (t0 > 0 && t0 < allowed) allowed = Math.max(0.8, t0 - 0.2); }
    }
    if (allowed < cam.cur) cam.cur = allowed; else cam.cur += (allowed - cam.cur) * (1 - Math.exp(-dt * 3));
    camera.position.copy(pivot).addScaledVector(dir, cam.cur);
    const minY = world.heightAt(camera.position.x, camera.position.z) + 0.3; if (camera.position.y < minY) camera.position.y = minY;
    if (G.shake > 0) { const s = G.shake * 0.25; camera.position.add(new V3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s)); G.shake = Math.max(0, G.shake - dt * 1.8); }
    cam.look.lerp(lookAt, 1 - Math.exp(-dt * 12));
    if (cam.look.lengthSq() === 0) cam.look.copy(lookAt);
    camera.lookAt(cam.look);
    // 遮挡淡化：挡在「镜头→玩家」或「镜头→锁定目标」视线上的龙柱变半透明（不挡 Boss 读招）
    if (world.occluders) {
      const tgts = [new V3(P.pos.x, 1.2, P.pos.z)]; if (lockAlive()) tgts.push(lockPos());
      const c = camera.position;
      world.occluders.forEach(o => {
        let block = false;
        for (const t of tgts) {
          const dx = t.x - c.x, dz = t.z - c.z, l2 = dx * dx + dz * dz; if (l2 < 1e-4) continue;
          const u = clamp(((o.x - c.x) * dx + (o.z - c.z) * dz) / l2, 0, 1);
          if (u > 0.02 && u < 0.98 && Math.hypot(c.x + dx * u - o.x, c.z + dz * u - o.z) < o.r + 0.4) { block = true; break; }
        }
        o.a += ((block ? 0.22 : 1) - o.a) * (1 - Math.exp(-dt * 10));
        o.mats.forEach(m => { m.opacity = o.a; m.depthWrite = o.a > 0.95; });
      });
    }
    // 角色过近时半透明处理：镜头极近则略微抬高
    P.rig.root.visible = cam.cur > 0.7 || P.state === 'dead'; P.rig.fx.visible = P.rig.root.visible;
  }

  // ---------- 流程 ----------
  function startFight() {
    G.fight = true; G.fightT = 0; G.hits = 0; G.perfects = 0; G.gourdUsed = 0;
    AudioSys.S.gate(); AudioSys.setMode('battle');
    $('bossPanel').classList.add('show'); $('fightInfo').classList.add('show');
    const bt = $('bossTitle'); bt.classList.remove('show'); void bt.offsetWidth; bt.classList.add('show');
    setTimeout(() => { if (!G.lock && G.fight) msg('按 R 锁定' + BD.name.split(' · ').pop(), 2.5); }, 3200);
  }
  function resetBoss() {
    clearTele(); clearHazards(); bTrail.active = false;
    Object.assign(B, { hp: B.maxHp, hpTrail: B.maxHp, phase: 1, state: 'dormant', t: 0, atk: null, cd: 1.5, freeze: 0, poise: 0, poiseMax: 130, flash: 0, alive: true, lift: 0, aura: 0, dissolve: 0, roared: false, last: [] });
    B.pos.copy(world.bossHome); B.facing = 0;
    B.rig.root.visible = true; B.rig.root.scale.setScalar(1);
    BR = BD.br; B.maxHp = BD.hp; B.hp = BD.hp; B.hpTrail = BD.hp;
    if (B.rig.reset) { B.rig.root.position.copy(B.pos); B.rig.reset(); }
    B.pose = Chars.zeroPose(); Object.assign(B.pose, B_SIT);
  }
  function retry() {
    $('death').classList.remove('show');
    G.attempts++;
    const keepGate = LS.gateOpen;
    resetLevelState();
    if (LV === 'sea' && keepGate) { LS.wave = world.ambush.length; LS.gateOpen = true; world.setGate(true); }
    resetBoss();
    Object.assign(P, { hp: P.maxHp, hpTrail: P.maxHp, st: P.maxSt, exhausted: false, gourds: P.maxGourds, spellCD: 0, state: 'idle', t: 0, invuln: 0, combo: 0, comboTimer: 0, queued: false });
    P.pos.copy(G.checkpointLit ? world.checkpoint : world.spawn); P.facing = Math.PI; P.knock.set(0, 0, 0);
    P.y = 0; P.vy = 0; P.vel.set(0, 0, 0); P.flipAng = 0; P.flipEnd = 0; P.flipBase = 0; P.sprinting = false;
    P.rig.root.position.set(P.pos.x, 0, P.pos.z); P.rig.reset();
    P.pose = Chars.zeroPose(); P.rig.gourdHand.visible = false; P.rig.gourdWaist.visible = true; P.rig.gold.emissive.setRGB(0, 0, 0);
    $('gourd').classList.remove('empty');
    G.fight = false; G.fightT = 0; G.hits = 0; G.perfects = 0; G.gourdUsed = 0; G.lock = false; G.mode = 'play'; G.slowT = 0; G.bossDefeated = false;
    cam.yaw = Math.PI; cam.pitch = 0.3;
    $('bossPanel').classList.remove('show'); $('fightInfo').classList.remove('show');
    FX.clear(); SMOKE.clear();
    AudioSys.setMode('explore'); AudioSys.S.checkpoint();
    msg(LV === 'sea' ? (G.checkpointLit ? '于太乙莲台重整旗鼓 · 气血、葫芦与法术已复原' : '重返陈塘关 · 气血、葫芦与法术已复原') : '于土地庙重整旗鼓 · 气血、葫芦与法术已复原', 3);
    requestLock();
  }
  function grade() {
    const t = G.finalT, score = 100 - G.hits * 6 - Math.max(0, t - 100) * 0.22 + G.perfects * 3 - G.gourdUsed * 3;
    return score >= 85 ? 'S' : score >= 65 ? 'A' : score >= 45 ? 'B' : 'C';
  }
  function showResult() {
    G.mode = 'result';
    if (document.pointerLockElement) document.exitPointerLock();
    const g = grade(), sp = { S: 5, A: 4, B: 3, C: 2 }[g];
    let save = { sp: 0, clears: 0, items: [] };
    try { save = Object.assign(save, JSON.parse(localStorage.getItem('wukong_heifeng') || '{}')); } catch (e) { }
    const pool = LV === 'sea' ? [['冰魄龙鳞', '护甲 · 冰伤减免 +20%'], ['万龙甲残片', '饰品 · 气血上限 +30'], ['定海珠', '法宝 · 法术冷却 -15%'], ['敖丙龙魄', '精魄 · 可化身冰龙冲撞']]
      : [['黑缨枪', '兵器 · 重击伤害 +12%'], ['黑熊皮袍', '护甲 · 防御 +18'], ['乌金护腕', '饰品 · 气力上限 +15'], ['熊罴精魄', '精魄 · 可化身黑熊震地']];
    const item = save.clears === 0 ? pool[0] : (g === 'S' ? pool[3] : pool[1 + ((Math.random() * 2) | 0)]);
    save.sp += sp; save.clears++; if (!save.items.includes(item[0])) save.items.push(item[0]);
    try { localStorage.setItem('wukong_heifeng', JSON.stringify(save)); } catch (e) { }
    const mm = Math.floor(G.finalT / 60), ss = Math.floor(G.finalT % 60);
    $('rTime').textContent = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    $('rHits').textContent = G.hits; $('rPerfect').textContent = G.perfects; $('rGourd').textContent = `${G.gourdUsed} / ${P.maxGourds}`;
    $('rTries').textContent = G.attempts;
    $('rGrade').textContent = g; $('rGrade').className = 'grade g' + g;
    $('rSp').textContent = '+' + sp; $('rSpTotal').textContent = save.sp;
    $('rItem').textContent = item[0]; $('rItemDesc').textContent = item[1];
    $('rClears').textContent = save.clears;
    document.querySelector('#result .rs').textContent = (LV === 'sea' ? '东海三太子 · 敖丙' : '黑风大王') + ' · 已伏诛';
    $('rKills').textContent = G.mobKills || 0;
    $('result').classList.add('show');
  }
  $('btnAgain').addEventListener('click', () => { $('result').classList.remove('show'); G.attempts = 0; retry(); });
  $('btnRoam').addEventListener('click', () => { $('result').classList.remove('show'); G.mode = 'play'; G.fight = false; $('bossPanel').classList.remove('show'); AudioSys.setMode('explore'); requestLock(); msg(LV === 'sea' ? '东海已平，可自由游览镇海台' : '黑风已散，可自由游览古寺', 3); });
  $('death').addEventListener('click', () => { if (deathReady) retry(); });
  $('btnStart').addEventListener('click', () => {
    AudioSys.init(); AudioSys.setMode('explore');
    $('title').classList.remove('show');
    document.body.classList.remove('titleMode');
    G.mode = 'play';
    requestLock();
    msg(LV === 'sea' ? world.intro : '沿古道前行 · 黑风大王盘踞于山顶古寺', 4);
  });

  // ---------- HUD ----------
  function fmtTime(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
  function updateHUD(dt) {
    P.hpTrail = P.hpTrail > P.hp ? Math.max(P.hp, P.hpTrail - P.maxHp * 0.5 * dt) : P.hp;
    B.hpTrail = B.hpTrail > B.hp ? Math.max(B.hp, B.hpTrail - B.maxHp * 0.25 * dt) : B.hp;
    $('pHp').style.width = (P.hp / P.maxHp * 100) + '%';
    $('pHpTrail').style.width = (P.hpTrail / P.maxHp * 100) + '%';
    $('pSt').style.width = (P.st / P.maxSt * 100) + '%';
    $('pSt').parentElement.classList.toggle('exhaust', P.exhausted);
    $('gourdCount').textContent = P.gourds;
    $('gourd').classList.toggle('empty', P.gourds <= 0);
    const cdf = P.spellCD / P.spellMax;
    $('spellCdMask').style.background = cdf > 0 ? `conic-gradient(rgba(0,0,0,0.72) ${cdf * 360}deg, transparent 0)` : 'transparent';
    $('spellCdText').textContent = P.spellCD > 0 ? Math.ceil(P.spellCD) : '';
    $('spell').classList.toggle('ready', P.spellCD <= 0);
    $('bHp').style.width = (B.hp / B.maxHp * 100) + '%';
    $('bHpTrail').style.width = (B.hpTrail / B.maxHp * 100) + '%';
    $('bPoise').style.width = (B.poise / B.poiseMax * 100) + '%';
    $('bossPhase').textContent = B.phase === 2 ? BD.p2Tag : '· 壹';
    $('bossPanel').classList.toggle('p2', B.phase === 2);
    $('bossPanel').classList.toggle('frozen', B.freeze > 0);
    if (G.fight) { $('timer').textContent = fmtTime(G.bossDefeated ? G.finalT : G.fightT); $('hits').textContent = G.hits; $('perf').textContent = G.perfects; }
    // 锁定标记
    const lm = $('lockMark');
    if (lockAlive()) {
      const LP = lockPos(); const s = toScreen(new V3(LP.x, LT === B ? BD.lockY + B.lift : 1.9, LP.z));
      lm.style.display = s.vis ? 'block' : 'none'; lm.style.transform = `translate(${s.x}px, ${s.y}px)`;
    } else lm.style.display = 'none';
    // 伤害数字
    for (let i = dmgNums.length - 1; i >= 0; i--) {
      const d = dmgNums[i]; d.t += dt;
      const s = toScreen(d.pos.clone().setY(d.pos.y + d.t * 1.2));
      d.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%,-50%) scale(${d.t < 0.1 ? 1.4 - d.t * 4 : 1})`;
      d.el.style.opacity = s.vis ? Math.max(0, 1 - Math.max(0, d.t - 0.5) / 0.5) : 0;
      if (d.t > 1) { d.el.remove(); dmgNums.splice(i, 1); }
    }
    if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) $('msg').classList.remove('show'); }
    if (bannerTimer > 0) { bannerTimer -= dt; if (bannerTimer <= 0) $('banner').classList.remove('show'); }
    $('lowHp').style.opacity = P.hp / P.maxHp < 0.3 && P.state !== 'dead' ? 0.5 + Math.sin(G.t * 6) * 0.25 : 0;
  }

  // ---------- 主循环 ----------
  const clock = new THREE.Clock();
  let introCam = 0;
  function frame() {
    requestAnimationFrame(frame);
    const rdt = Math.min(clock.getDelta(), 0.05);
    G.t += rdt;
    if (G.mode === 'title') {
      introCam += rdt;
      // 角色展示：镜头环绕所选角色，角色位于画面右侧
      const SHOW = LV === 'sea' ? world.showcase.clone() : new V3(0, 0, 17), a = 0.35 + Math.sin(introCam * 0.18) * 0.35;
      camera.position.set(SHOW.x + Math.sin(a) * 4.6, 1.75, SHOW.z + Math.cos(a) * 4.6);
      const rgt = new V3(Math.cos(a), 0, -Math.sin(a));
      camera.lookAt(SHOW.x - rgt.x * 1.55, 1.25, SHOW.z - rgt.z * 1.55);
      Chars.applyPose(B.rig, Object.assign(B.pose, B_SIT), {}); B.rig.root.position.copy(B.pos); B.rig.root.rotation.y = 0; if (B.rig.update) B.rig.update(rdt, G.t);
      Chars.blendPose(P.pose, P_IDLE, 1 - Math.exp(-rdt * 10));
      if (P.rig.hover) P.rig.hover.feed(rdt, 'idle', new V3(), 0, 0.35, null);
      Chars.applyPose(P.rig, P.pose, {}); P.rig.root.position.copy(SHOW); P.rig.root.rotation.y = 0.35;
      P.rig.update(rdt, G.t, 0);
      if (P.rig.wheels) P.rig.wheels.forEach(w => { if (Math.random() < 0.5) { const wp = new V3(); w.spin.getWorldPosition(wp); FX.emit(wp, { count: 1, speed: 0.6, up: 0.7, life: 0.35, size: 0.15, sizeEnd: 0.05, colors: [[1, 0.42, 0.06], [1, 0.72, 0.22]], drag: 2.5 }); } });
      world.update(G.t, rdt, camera.position, false, camera);
      FX.update(rdt); SMOKE.update(rdt);
      sun.position.copy(SHOW).addScaledVector(world.sunDir, 100); sun.target.position.copy(SHOW);
      renderer.render(scene, camera);
      return;
    }
    if (G.paused) { renderer.render(scene, camera); return; }
    if (G.slowT > 0) G.slowT -= rdt;
    let dt = rdt * (G.slowT > 0 ? G.slowScale : 1);
    if (G.hitStop > 0) { G.hitStop -= rdt; dt *= 0.08; }

    if (G.mode === 'play' || G.mode === 'dead' || G.mode === 'result') {
      updatePlayer(dt);
      if (!G.fight && B.alive && G.mode === 'play' && world.inArena(P.pos)) startFight();
      if (G.fight && !G.bossDefeated && G.mode === 'play') G.fightT += dt;
      if (B.rig.root.visible || G.fight) updateBoss(dt);
      updateHazards(dt); updateSpikes(dt);
      Mobs.update(dt); updateLevel();
      // 检查点
      if (!G.checkpointLit && Math.hypot(P.pos.x - world.shrine.x, P.pos.z - world.shrine.z) < 4) {
        G.checkpointLit = true; AudioSys.S.checkpoint(); msg(LV === 'sea' ? '太乙莲台 · 莲花护佑，检查点已记录' : '土地庙 · 已焚香，检查点已记录', 3);
        FX.emit(new V3(world.shrine.x - (LV === 'sea' ? 0 : 1.15), 0.8, world.shrine.z), { count: 30, speed: 1.2, up: 1.5, life: 1.2, size: 0.1, color: LV === 'sea' ? [1, 0.6, 0.75] : [1, 0.75, 0.35] });
      }
      if (Math.random() < 0.3) FX.emit(new V3(world.shrine.x - (LV === 'sea' ? 0 : 1.15), 0.85, world.shrine.z), { count: 1, speed: 0.1, up: 0.5, life: 1.5, size: 0.06, color: LV === 'sea' ? [1, 0.6, 0.8] : [1, 0.6, 0.25] });
    }
    // 拖尾
    const ta = new V3(), tb = new V3();
    P.rig.tip.getWorldPosition(ta); P.rig.mid.getWorldPosition(tb); pTrail.mat.uniforms.k.value = P.state === 'heavy' ? 1.6 : 1; pTrail.update(dt, ta, tb);
    B.rig.tip.getWorldPosition(ta); B.rig.mid.getWorldPosition(tb); bTrail.update(dt, ta, tb);
    FX.update(dt); SMOKE.update(dt); updateEffects(dt);
    world.update(G.t, dt, P.pos, G.fight && B.alive, camera);
    // 阴影跟随
    const sp = new V3(Math.round(P.pos.x / 4) * 4, 0, Math.round(P.pos.z / 4) * 4);
    sun.target.position.copy(sp); sun.position.copy(sp).addScaledVector(world.sunDir, 100);
    updateCamera(rdt);
    updateHUD(rdt);
    renderer.render(scene, camera);
  }

  // ---------- 关卡切换：悟空→黑风山（黑风大王）；哪吒→东海陈塘关（夜叉 + 敖丙） ----------
  let LV = 'heifeng';
  function setLevel(id) {
    LV = id; world = WORLDS[id];
    heifengObjs.forEach(o => { if (o !== B.rig.root && o !== P.rig.root && o !== P.rig.fx) o.visible = id === 'heifeng'; });
    WORLDS.sea.group.visible = id === 'sea';
    scene.environment = ENVS[id];
    const f = id === 'sea' ? world.fog : { color: 0xae9c80, density: 0.0098 };
    scene.fog.color.setHex(f.color); scene.fog.density = f.density;
    if (id === 'sea') { sun.color.setHex(0xdce8ff); sun.intensity = 1.7; hemi.color.setHex(0xbfe0ff); hemi.groundColor.setHex(0x1a2a30); hemi.intensity = 0.45; fill.color.setHex(0x6aa8c8); renderer.toneMappingExposure = 1.02; }
    else { sun.color.setHex(0xffd29a); sun.intensity = 2.1; hemi.color.setHex(0xffe0b5); hemi.groundColor.setHex(0x3a3226); hemi.intensity = 0.35; fill.color.setHex(0x8fa6c8); renderer.toneMappingExposure = 1.08; }
    // Boss 外观
    scene.remove(B.rig.root); if (B.rig.fx) scene.remove(B.rig.fx);
    BD = BOSS_DEF[id]; B.rig = bossRigs[id]; BR = BD.br; B.maxHp = BD.hp;
    scene.add(B.rig.root); if (B.rig.fx) scene.add(B.rig.fx);
    bTrail.mat.uniforms.col.value.setHex(id === 'sea' ? 0x6ae8ff : 0xff5a2a);
    $('bossName').textContent = BD.name;
    document.querySelector('#bossTitle .t1').textContent = BD.name.split(' · ').pop();
    document.querySelector('#bossTitle .t2').textContent = BD.sub;
    document.querySelector('#title h2').textContent = id === 'sea' ? '第一回 · 东海陈塘关' : '第一回 · 黑风山';
    resetLevelState();
  }
  // 前置关卡（小怪波次）状态
  const LS = { wave: 0, gateOpen: false };
  function resetLevelState() {
    Mobs.clear(); clearSpikes();
    LS.wave = 0; LS.gateOpen = LV !== 'sea';
    if (world.setGate) world.setGate(LS.gateOpen);
    G.mobKills = 0;
  }
  function updateLevel() {
    if (LV !== 'sea' || G.mode !== 'play') return;
    // 伏击波次：玩家越过触发线时在前方刷出夜叉
    const amb = world.ambush;
    if (LS.wave < amb.length && P.pos.z < amb[LS.wave].z) {
      amb[LS.wave].spawns.forEach(([x, z], i) => { const m = Mobs.spawn(x, z, LS.wave * 3 + i); m.state = 'alert'; m.t = 0; FX.emit(m.pos.clone().setY(0.4), { count: 30, speed: 4, up: 3, life: 0.8, size: 0.25, colors: [[0.6, 0.9, 1], [1, 1, 1]], drag: 2 }); });
      msg(LS.wave === 0 ? '巡海夜叉自海中跃出！' : '更多夜叉拦住了去路', 2.2);
      AudioSys.S.splash(); AudioSys.setMode('battle');
      LS.wave++;
    }
    // 清空全部波次后，水门开启
    if (!LS.gateOpen && LS.wave >= amb.length && Mobs.alive() === 0) {
      LS.gateOpen = true; world.setGate(true);
      msg('夜叉尽退 · 镇海水门已开', 3); AudioSys.S.gate(); AudioSys.setMode('explore');
      if (G.lock && LT !== B) { G.lock = false; LT = null; }
    } else if (LS.wave > 0 && Mobs.alive() === 0 && AudioSys.mode === 'battle' && !G.fight) AudioSys.setMode('explore');
  }

  // 切换角色：替换模型、HUD、标题与法术外观
  function setChar(id) {
    if (!CHARS[id]) id = 'wukong';
    scene.remove(P.rig.root, P.rig.fx);
    CH = CHARS[id]; P.rig = rigs[id];
    scene.add(P.rig.root, P.rig.fx);
    P.pose = Chars.zeroPose(); Object.assign(P.pose, P_IDLE);
    P.rig.root.position.set(0, 0, 17); P.rig.reset();
    pTrail.mat.uniforms.col.value.setHex(CH.trail);
    document.querySelectorAll('.charCard').forEach(c => c.classList.toggle('sel', c.dataset.char === id));
    $('titleName').textContent = CH.title; document.title = CH.game + (id === 'nezha' ? ' · 东海陈塘关' : ' · 黑风山');
    $('pName').textContent = CH.name; $('spellIcon').textContent = CH.spellChar;
    document.querySelectorAll('.spellName').forEach(e => e.textContent = CH.spell);
    try { localStorage.setItem('bm_char', id); } catch (e) { }
    setLevel(id === 'nezha' ? 'sea' : 'heifeng');
    resetBoss();
    P.pos.copy(world.spawn);
  }
  document.querySelectorAll('.charCard').forEach(c => c.addEventListener('click', () => { if (G.mode === 'title') { setChar(c.dataset.char); AudioSys.init(); AudioSys.S.lock(true); } }));
  addEventListener('keydown', (e) => { if (G.mode !== 'title') return; if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'Tab') setChar(CH.id === 'wukong' ? 'nezha' : 'wukong'); });
  { let c = 'wukong'; try { c = localStorage.getItem('bm_char') || 'wukong'; } catch (e) { } setChar(c); }

  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
  resetBoss();
  $('loading').classList.add('hide');
  $('title').classList.add('show');
  frame();
  window.__G = { G, P, B, get world() { return world; }, camera, cam, Mobs, LS, get LV() { return LV; }, get BD() { return BD; }, setChar };
})();
