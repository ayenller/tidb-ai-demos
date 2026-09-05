/* =====================================================================
 *  globe.js — the 3D element. A point cloud of real airport coordinates
 *  (the continents are drawn by the data itself, not by a texture),
 *  great-circle route arcs, and moving flight pulses.
 *
 *  If three.js fails to load — offline, blocked CDN — everything falls
 *  back to an equirectangular 2D canvas with the same data and the same
 *  public API, so the page never breaks.
 * ===================================================================== */
const Globe = (() => {
  const COLORS = { hub: 0x34d399, large: 0x38bdf8, regional: 0x475f7d };
  const HL = { like: 0x7dd3fc, fulltext: 0xc084fc, vector: 0xfbbf24, hybrid: 0x34d399 };

  let mode = null, api = {};

  // ---------- shared math -------------------------------------------------
  const rad = (d) => (d * Math.PI) / 180;
  function toVec3(lat, lon, r = 1) {
    const phi = rad(90 - lat), theta = rad(lon + 180);
    return [-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
  }

  // =====================================================================
  //  3D
  // =====================================================================
  function init3d(canvas, airports, routes, onHover) {
    const T = window.THREE;
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, 3.05);
    const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    const world = new T.Group();
    scene.add(world);

    // opaque core, so the far side of the globe occludes its own points
    world.add(new T.Mesh(new T.SphereGeometry(0.988, 48, 32),
      new T.MeshBasicMaterial({ color: 0x060b16 })));

    // lat/lon graticule
    const grid = [];
    for (let lon = -180; lon < 180; lon += 15)
      for (let lat = -90; lat < 90; lat += 3)
        grid.push(...toVec3(lat, lon), ...toVec3(lat + 3, lon));
    for (let lat = -75; lat <= 75; lat += 15)
      for (let lon = -180; lon < 180; lon += 4)
        grid.push(...toVec3(lat, lon), ...toVec3(lat, lon + 4));
    const gg = new T.BufferGeometry();
    gg.setAttribute("position", new T.Float32BufferAttribute(grid, 3));
    world.add(new T.LineSegments(gg, new T.LineBasicMaterial({
      color: 0x1d3a5f, transparent: true, opacity: 0.55 })));

    // fresnel atmosphere
    world.add(new T.Mesh(new T.SphereGeometry(1.16, 48, 32), new T.ShaderMaterial({
      vertexShader: `varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vN; void main(){
        float i=pow(0.62-dot(vN,vec3(0.,0.,1.)),3.0);
        gl_FragColor=vec4(0.13,0.72,0.92,1.0)*i; }`,
      blending: T.AdditiveBlending, side: T.BackSide, transparent: true, depthWrite: false,
    })));

    // ---- airports as a point cloud
    const pos = [], col = [], c = new T.Color();
    airports.forEach((a) => {
      pos.push(...toVec3(a.lat, a.lon, 1.004));
      c.setHex(COLORS[a.size]); col.push(c.r, c.g, c.b);
    });
    const pg = new T.BufferGeometry();
    pg.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    pg.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    const points = new T.Points(pg, new T.PointsMaterial({
      size: 0.055, map: dotTexture(T), vertexColors: true, transparent: true,
      depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true }));
    world.add(points);

    // ---- route arcs + flight pulses
    const byIata = new Map(airports.map((a) => [a.iata, a]));
    const curves = [], seg = [];
    routes.forEach(([s, d]) => {
      const A = byIata.get(s), B = byIata.get(d);
      if (!A || !B) return;
      const va = new T.Vector3(...toVec3(A.lat, A.lon, 1.004));
      const vb = new T.Vector3(...toVec3(B.lat, B.lon, 1.004));
      const mid = va.clone().add(vb).multiplyScalar(0.5).normalize()
        .multiplyScalar(1 + va.distanceTo(vb) * 0.28);
      const curve = new T.QuadraticBezierCurve3(va, mid, vb);
      curves.push(curve);
      const pts = curve.getPoints(28);
      for (let i = 0; i < pts.length - 1; i++) seg.push(pts[i].x, pts[i].y, pts[i].z,
        pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
    });
    const ag = new T.BufferGeometry();
    ag.setAttribute("position", new T.Float32BufferAttribute(seg, 3));
    world.add(new T.LineSegments(ag, new T.LineBasicMaterial({
      color: 0x2b90b8, transparent: true, opacity: 0.42, blending: T.AdditiveBlending,
      depthWrite: false })));

    const NP = Math.min(60, curves.length);
    const pulseT = Array.from({ length: NP }, () => Math.random());
    const pulseC = Array.from({ length: NP }, (_, i) => curves[(i * 7) % curves.length]);
    const pgeo = new T.BufferGeometry();
    pgeo.setAttribute("position", new T.Float32BufferAttribute(new Float32Array(NP * 3), 3));
    const pulses = new T.Points(pgeo, new T.PointsMaterial({
      size: 0.036, map: dotTexture(T), color: 0xbdf2ff, transparent: true,
      opacity: 0.95, depthWrite: false, blending: T.AdditiveBlending }));
    world.add(pulses);

    // ---- result markers (rebuilt on every search)
    const markers = new T.Group();
    world.add(markers);

    function setResults(items) {
      markers.clear();
      if (!items || !items.length) return;
      const v = [], cc = [], tmp = new T.Color();
      items.forEach((it) => {
        const a = it.a, color = HL[it.key] || 0x34d399;
        const base = toVec3(a.lat, a.lon, 1.005);
        const top = toVec3(a.lat, a.lon, 1.005 + (it.top ? 0.20 : 0.11));
        v.push(...base, ...top);
        tmp.setHex(color);
        cc.push(tmp.r * 0.25, tmp.g * 0.25, tmp.b * 0.25, tmp.r, tmp.g, tmp.b);
      });
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(v, 3));
      g.setAttribute("color", new T.Float32BufferAttribute(cc, 3));
      markers.add(new T.LineSegments(g, new T.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.95,
        blending: T.AdditiveBlending, depthWrite: false })));

      const hp = [], hc = [];
      items.forEach((it) => {
        hp.push(...toVec3(it.a.lat, it.a.lon, 1.008));
        tmp.setHex(HL[it.key] || 0x34d399); hc.push(tmp.r, tmp.g, tmp.b);
      });
      const hg = new T.BufferGeometry();
      hg.setAttribute("position", new T.Float32BufferAttribute(hp, 3));
      hg.setAttribute("color", new T.Float32BufferAttribute(hc, 3));
      markers.add(new T.Points(hg, new T.PointsMaterial({
        size: 0.115, map: ringTexture(T), vertexColors: true, transparent: true,
        depthWrite: false, blending: T.AdditiveBlending })));
    }

    // ---- interaction
    let spin = true, drag = false, px = 0, py = 0, idle = 0;
    let tx = null, ty = null;                      // tween targets
    canvas.addEventListener("pointerdown", (e) => {
      drag = true; spin = false; px = e.clientX; py = e.clientY; canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointerup", () => { drag = false; idle = 0; });
    canvas.addEventListener("pointermove", (e) => {
      if (drag) {
        world.rotation.y += (e.clientX - px) * 0.006;
        world.rotation.x = Math.max(-1.2, Math.min(1.2, world.rotation.x + (e.clientY - py) * 0.005));
        px = e.clientX; py = e.clientY; tx = ty = null;
      } else hover(e);
    });
    canvas.addEventListener("pointerleave", () => onHover && onHover(null));
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      zoom = Math.max(0.55, Math.min(2.2, zoom + e.deltaY * 0.0011));
      applyZoom();
    }, { passive: false });

    const ray = new T.Raycaster(); ray.params.Points.threshold = 0.028;
    const ndc = new T.Vector2();
    function hover(e) {
      if (!onHover) return;
      const r = canvas.getBoundingClientRect();
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(points)[0];
      // reject points on the far side of the globe
      if (hit && hit.point.clone().normalize().dot(camera.position.clone().normalize()) > 0.15)
        onHover(airports[hit.index], e.clientX - r.left, e.clientY - r.top);
      else onHover(null);
    }

    function focus(a) {
      if (!a) return;
      const phi = rad(90 - a.lat), theta = rad(a.lon + 180);
      ty = Math.atan2(-Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta));
      tx = rad(a.lat) * 0.85;
      spin = false; idle = 0;
    }

    // The globe must fit whichever dimension is tighter. A tall narrow panel
    // is limited horizontally, so fitting on vertical FOV alone crops it.
    let zoom = 1;
    function applyZoom() {
      const need = 1.06;                                   // sphere + a little glow
      const fit = need / (Math.tan(rad(camera.fov / 2)) * Math.min(1, camera.aspect));
      camera.position.z = fit * zoom;
    }
    function resize() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      applyZoom();
    }
    new ResizeObserver(resize).observe(canvas); resize();

    let last = performance.now();
    (function loop(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!drag) { idle += dt; if (idle > 4) spin = true; }
      if (spin && tx === null) world.rotation.y += dt * 0.055;
      if (tx !== null) {
        world.rotation.x += (tx - world.rotation.x) * 0.07;
        let d = ty - world.rotation.y;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        world.rotation.y += d * 0.07;
        if (Math.abs(d) < 0.002) { tx = ty = null; }
      }
      const parr = pgeo.attributes.position.array;
      for (let i = 0; i < NP; i++) {
        pulseT[i] += dt * 0.075;
        if (pulseT[i] > 1) pulseT[i] = 0;
        const p = pulseC[i].getPoint(pulseT[i]);
        parr[i * 3] = p.x; parr[i * 3 + 1] = p.y; parr[i * 3 + 2] = p.z;
      }
      pgeo.attributes.position.needsUpdate = true;
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    })(last);

    return { setResults, focus, mode: "3d" };
  }

  function dotTexture(T) {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d").createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    const x = c.getContext("2d"); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(c);
  }
  function ringTexture(T) {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d");
    x.strokeStyle = "rgba(255,255,255,.95)"; x.lineWidth = 4;
    x.beginPath(); x.arc(32, 32, 22, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = "rgba(255,255,255,.35)"; x.lineWidth = 2;
    x.beginPath(); x.arc(32, 32, 30, 0, Math.PI * 2); x.stroke();
    return new T.CanvasTexture(c);
  }

  // =====================================================================
  //  2D fallback — same data, same API, no WebGL
  // =====================================================================
  function init2d(canvas, airports, routes, onHover) {
    const ctx = canvas.getContext("2d");
    let W = 0, H = 0, results = [], t = 0;
    const byIata = new Map(airports.map((a) => [a.iata, a]));
    const P = (a) => [((a.lon + 180) / 360) * W, ((90 - a.lat) / 180) * H];
    const hex = (n) => "#" + n.toString(16).padStart(6, "0");

    function resize() {
      const r = Math.min(devicePixelRatio, 2);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * r; canvas.height = H * r; ctx.setTransform(r, 0, 0, r, 0, 0);
    }
    new ResizeObserver(resize).observe(canvas); resize();

    canvas.addEventListener("pointermove", (e) => {
      if (!onHover) return;
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      let best = null, bd = 12;
      airports.forEach((a) => {
        const [x, y] = P(a), d = Math.hypot(x - mx, y - my);
        if (d < bd) { bd = d; best = a; }
      });
      onHover(best, mx, my);
    });
    canvas.addEventListener("pointerleave", () => onHover && onHover(null));

    (function draw() {
      t += 0.004;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(96,165,250,.10)"; ctx.lineWidth = 1;
      for (let lon = -180; lon <= 180; lon += 30) {
        const x = ((lon + 180) / 360) * W;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        const y = ((90 - lat) / 180) * H;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.strokeStyle = "rgba(34,211,238,.18)";
      routes.forEach(([s, d]) => {
        const A = byIata.get(s), B = byIata.get(d);
        if (!A || !B) return;
        const [x1, y1] = P(A), [x2, y2] = P(B);
        if (Math.abs(x1 - x2) > W / 2) return;             // skip dateline wrap
        ctx.beginPath(); ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2 - Math.abs(x1 - x2) * 0.22, x2, y2);
        ctx.stroke();
      });
      airports.forEach((a) => {
        const [x, y] = P(a);
        ctx.fillStyle = hex(COLORS[a.size]); ctx.globalAlpha = 0.75;
        ctx.beginPath(); ctx.arc(x, y, a.size === "hub" ? 2.4 : 1.6, 0, 7); ctx.fill();
      });
      ctx.globalAlpha = 1;
      results.forEach((it) => {
        const [x, y] = P(it.a), c = hex(HL[it.key] || 0x34d399);
        const r = 6 + Math.sin(t * 9) * 2.5;
        ctx.strokeStyle = c; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
      });
      requestAnimationFrame(draw);
    })();

    return { setResults: (r) => { results = r || []; }, focus: () => {}, mode: "2d" };
  }

  // =====================================================================
  function init(canvas, airports, routes, onHover) {
    try {
      if (window.THREE) { api = init3d(canvas, airports, routes, onHover); mode = "3d"; }
    } catch (e) { console.warn("3D globe unavailable, falling back to 2D:", e); }
    if (!mode) { api = init2d(canvas, airports, routes, onHover); mode = "2d"; }
    return api;
  }

  return { init, get mode() { return mode; } };
})();
