/* =====================================================================
 *  globe.js — the 3D element.
 *
 *  Layers, back to front:
 *    starfield · shaded core · country outlines (Natural Earth 110m)
 *    · graticule · route network · flight comets · airport points
 *    · result markers (beam + pulsing ring + label) · atmosphere
 *
 *  Selecting an airport rotates it to dead centre and draws its routes
 *  out from it, one animated arc at a time.
 *
 *  If three.js fails to load — offline, blocked CDN — everything falls
 *  back to an equirectangular 2D canvas with the same data, the same
 *  outlines and the same public API, so the page never breaks.
 * ===================================================================== */
const Globe = (() => {
  const COLORS = { hub: 0x4ef0bb, large: 0x54c8ff, regional: 0x5b7ba1 };
  const HL = { like: 0x7dd3fc, fulltext: 0xc084fc, vector: 0xfbbf24, hybrid: 0x34d399 };
  const OUTLINES = typeof WORLD_OUTLINES !== "undefined" ? WORLD_OUTLINES : [];

  let mode = null, api = {};

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
    const camera = new T.PerspectiveCamera(38, 1, 0.1, 200);
    const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    // ---- starfield (its own group: drifts independently of the globe)
    const stars = new T.Group();
    scene.add(stars);
    {
      const p = [], c = [], col = new T.Color();
      for (let i = 0; i < 1500; i++) {
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        const r = 60 + Math.random() * 30;
        p.push(s * Math.cos(a) * r, u * r, s * Math.sin(a) * r);
        const b = 0.25 + Math.random() * 0.75;
        col.setHSL(0.55 + Math.random() * 0.12, 0.5, 0.5 * b);
        c.push(col.r, col.g, col.b);
      }
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(p, 3));
      g.setAttribute("color", new T.Float32BufferAttribute(c, 3));
      stars.add(new T.Points(g, new T.PointsMaterial({
        size: 1.7, map: dotTexture(T), vertexColors: true, transparent: true,
        depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: false })));
    }

    const world = new T.Group();
    scene.add(world);

    // ---- shaded core. Opaque, so the far side occludes its own geometry.
    world.add(new T.Mesh(new T.SphereGeometry(0.995, 64, 48), new T.ShaderMaterial({
      vertexShader: `varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vN; void main(){
        float f=max(dot(vN,vec3(0.0,0.0,1.0)),0.0);
        vec3 c=mix(vec3(0.012,0.030,0.062), vec3(0.030,0.078,0.140), pow(f,0.75));
        gl_FragColor=vec4(c,1.0); }`,
    })));

    // ---- country outlines, plus a wider dimmer copy as a cheap bloom
    if (OUTLINES.length) {
      const seg = [];
      OUTLINES.forEach((ring) => {
        const n = ring.length / 2;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          seg.push(...toVec3(ring[i * 2 + 1], ring[i * 2], 1.002));
          seg.push(...toVec3(ring[j * 2 + 1], ring[j * 2], 1.002));
        }
      });
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(seg, 3));
      world.add(new T.LineSegments(g, new T.LineBasicMaterial({
        color: 0x3d92cc, transparent: true, opacity: 0.9,
        blending: T.AdditiveBlending, depthWrite: false })));
      const halo = new T.LineSegments(g, new T.LineBasicMaterial({
        color: 0x1e5f8f, transparent: true, opacity: 0.35,
        blending: T.AdditiveBlending, depthWrite: false }));
      halo.scale.setScalar(1.004);
      world.add(halo);
    }

    // ---- graticule, dim now that the coastlines carry the shape
    {
      const grid = [];
      for (let lon = -180; lon < 180; lon += 20)
        for (let lat = -90; lat < 90; lat += 4)
          grid.push(...toVec3(lat, lon, 0.999), ...toVec3(lat + 4, lon, 0.999));
      for (let lat = -60; lat <= 60; lat += 30)
        for (let lon = -180; lon < 180; lon += 4)
          grid.push(...toVec3(lat, lon, 0.999), ...toVec3(lat, lon + 4, 0.999));
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(grid, 3));
      world.add(new T.LineSegments(g, new T.LineBasicMaterial({
        color: 0x123c55, transparent: true, opacity: 0.5 })));
    }

    // ---- route network + the curves the comets fly along
    const byIata = new Map(airports.map((a) => [a.iata, a]));
    const curves = [], seg = [];
    routes.forEach(([s, d]) => {
      const A = byIata.get(s), B = byIata.get(d);
      if (!A || !B) return;
      const curve = arc(T, A, B);
      curves.push(curve);
      const pts = curve.getPoints(30);
      for (let i = 0; i < pts.length - 1; i++)
        seg.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
    });
    {
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(seg, 3));
      world.add(new T.LineSegments(g, new T.LineBasicMaterial({
        color: 0x1b6f92, transparent: true, opacity: 0.3,
        blending: T.AdditiveBlending, depthWrite: false })));
    }

    // ---- flight comets: a bright head dragging a fading tail
    const NC = Math.min(38, curves.length), TRAIL = 14, SPAN = 0.11;
    const flights = Array.from({ length: NC }, (_, i) => ({
      curve: curves[(i * 5 + 1) % curves.length],
      t: Math.random(), speed: 0.055 + Math.random() * 0.05,
    }));
    const tailGeo = new T.BufferGeometry();
    tailGeo.setAttribute("position", new T.Float32BufferAttribute(new Float32Array(NC * (TRAIL - 1) * 2 * 3), 3));
    tailGeo.setAttribute("color", new T.Float32BufferAttribute(new Float32Array(NC * (TRAIL - 1) * 2 * 3), 3));
    world.add(new T.LineSegments(tailGeo, new T.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false })));
    const headGeo = new T.BufferGeometry();
    headGeo.setAttribute("position", new T.Float32BufferAttribute(new Float32Array(NC * 3), 3));
    world.add(new T.Points(headGeo, new T.PointsMaterial({
      size: 0.042, map: dotTexture(T), color: 0xd6f6ff, transparent: true,
      depthWrite: false, blending: T.AdditiveBlending })));

    // ---- airports. Hubs live in their own cloud so they can breathe.
    const clouds = {};
    ["hub", "large", "regional"].forEach((k) => {
      const list = airports.filter((a) => a.size === k);
      const p = [];
      list.forEach((a) => p.push(...toVec3(a.lat, a.lon, 1.006)));
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(p, 3));
      const m = new T.PointsMaterial({
        size: k === "hub" ? 0.062 : k === "large" ? 0.046 : 0.034,
        map: dotTexture(T), color: COLORS[k], transparent: true,
        opacity: k === "regional" ? 0.75 : 1, depthWrite: false, blending: T.AdditiveBlending });
      const pts = new T.Points(g, m);
      pts.userData = { list, base: m.size };
      world.add(pts);
      clouds[k] = pts;
    });

    // ---- result markers, rebuilt on every search / hover
    const markers = new T.Group();
    world.add(markers);
    let ringMat = null, drawing = [], label = null;

    function clearMarkers() {
      markers.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      markers.clear();
      ringMat = null; drawing = []; label = null;
    }

    let sig = "";
    function setResults(items) {
      // hovering a row re-sends the same selection constantly; rebuilding the
      // arcs each time would restart their draw-on animation every frame
      const next = (items || []).map((i) => i.a.id + (i.top ? "*" : "") + i.key).join();
      if (next === sig) return;
      sig = next;
      clearMarkers();
      if (!items || !items.length) return;
      const tmp = new T.Color();

      // beams
      const bv = [], bc = [];
      items.forEach((it) => {
        const col = HL[it.key] || HL.hybrid;
        const h = it.top ? 0.26 : 0.12;
        bv.push(...toVec3(it.a.lat, it.a.lon, 1.006), ...toVec3(it.a.lat, it.a.lon, 1.006 + h));
        tmp.setHex(col);
        bc.push(tmp.r, tmp.g, tmp.b, tmp.r * 0.05, tmp.g * 0.05, tmp.b * 0.05);
      });
      const bg = new T.BufferGeometry();
      bg.setAttribute("position", new T.Float32BufferAttribute(bv, 3));
      bg.setAttribute("color", new T.Float32BufferAttribute(bc, 3));
      markers.add(new T.LineSegments(bg, new T.LineBasicMaterial({
        vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false })));

      // static rings for every hit
      const rest = items.filter((i) => !i.top);
      if (rest.length) {
        const p = [], c = [];
        rest.forEach((it) => {
          p.push(...toVec3(it.a.lat, it.a.lon, 1.01));
          tmp.setHex(HL[it.key] || HL.hybrid); c.push(tmp.r, tmp.g, tmp.b);
        });
        const g = new T.BufferGeometry();
        g.setAttribute("position", new T.Float32BufferAttribute(p, 3));
        g.setAttribute("color", new T.Float32BufferAttribute(c, 3));
        markers.add(new T.Points(g, new T.PointsMaterial({
          size: 0.1, map: ringTexture(T), vertexColors: true, transparent: true,
          opacity: 0.85, depthWrite: false, blending: T.AdditiveBlending })));
      }

      // the top hit gets a pulsing ring, a label, and its route network
      const top = items.find((i) => i.top);
      if (top) {
        const g = new T.BufferGeometry();
        g.setAttribute("position", new T.Float32BufferAttribute(toVec3(top.a.lat, top.a.lon, 1.012), 3));
        ringMat = new T.PointsMaterial({
          size: 0.17, map: ringTexture(T), color: HL[top.key] || HL.hybrid,
          transparent: true, depthWrite: false, blending: T.AdditiveBlending });
        markers.add(new T.Points(g, ringMat));

        label = makeLabel(T, top.a, HL[top.key] || HL.hybrid);
        label.position.set(...toVec3(top.a.lat, top.a.lon, 1.035));
        markers.add(label);

        // outbound + inbound arcs, drawn out one after another
        const links = routes
          .filter(([s, d]) => s === top.a.iata || d === top.a.iata)
          .map(([s, d]) => byIata.get(s === top.a.iata ? d : s))
          .filter(Boolean).slice(0, 10);
        links.forEach((other, i) => {
          const pts = arc(T, top.a, other, 0.34).getPoints(64);
          const g2 = new T.BufferGeometry().setFromPoints(pts);
          g2.setDrawRange(0, 0);
          const line = new T.Line(g2, new T.LineBasicMaterial({
            color: HL[top.key] || HL.hybrid, transparent: true, opacity: 0.85,
            blending: T.AdditiveBlending, depthWrite: false }));
          markers.add(line);
          drawing.push({ line, n: pts.length, at: -i * 0.09 });
        });
      }
    }

    // ---- interaction
    let spin = true, drag = false, px = 0, py = 0, idle = 0, held = false;
    let tx = null, ty = null;
    canvas.addEventListener("pointerdown", (e) => {
      drag = true; spin = false; held = false; px = e.clientX; py = e.clientY;
      canvas.setPointerCapture(e.pointerId);
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

    const ray = new T.Raycaster(); ray.params.Points.threshold = 0.03;
    const ndc = new T.Vector2();
    function hover(e) {
      if (!onHover) return;
      const r = canvas.getBoundingClientRect();
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(ndc, camera);
      let best = null, bd = Infinity;
      for (const k of ["hub", "large", "regional"]) {
        const hit = ray.intersectObject(clouds[k])[0];
        if (hit && hit.distanceToRay < bd
            && hit.point.clone().normalize().dot(camera.position.clone().normalize()) > 0.15) {
          bd = hit.distanceToRay; best = clouds[k].userData.list[hit.index];
        }
      }
      onHover(best, e.clientX - r.left, e.clientY - r.top);
    }

    /** Rotate the globe so this airport sits dead centre, facing the camera.
     *
     *  Euler order XYZ means the Y rotation is applied first, and rotating by
     *  `a` about Y takes a point's azimuth from α to α + a — so to land the
     *  airport on +Z (straight at the camera) we need a = -α, not +α. Then
     *  the X rotation of `lat` lifts it off the equator to the centre.        */
    function focus(a) {
      if (!a) return;
      const phi = rad(90 - a.lat), theta = rad(a.lon + 180);
      const azimuth = Math.atan2(-Math.sin(phi) * Math.cos(theta),
                                  Math.sin(phi) * Math.sin(theta));
      ty = -azimuth;
      tx = rad(a.lat);
      spin = false; held = true;
    }

    let zoom = 1;
    function applyZoom() {
      const need = 1.06;
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

    const tailPos = tailGeo.attributes.position.array;
    const tailCol = tailGeo.attributes.color.array;
    const headPos = headGeo.attributes.position.array;
    const v = new T.Vector3();
    let clock = 0, last = performance.now();

    (function loop(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      clock += dt;

      // idle spin, unless we are holding a focused airport
      if (!drag) { idle += dt; if (idle > 4 && !held) spin = true; }
      if (spin && tx === null) world.rotation.y += dt * 0.05;
      stars.rotation.y += dt * 0.004;

      if (tx !== null) {                                   // ease to focus
        // exponential smoothing in TIME, not per frame, so the flight takes
        // the same ~0.6s at 30fps and at 144fps
        const k = 1 - Math.exp(-dt * 7.5);
        world.rotation.x += (tx - world.rotation.x) * k;
        let d = ty - world.rotation.y;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        world.rotation.y += d * k;                       // always the short way round
        if (Math.abs(d) < 0.002 && Math.abs(tx - world.rotation.x) < 0.002) tx = ty = null;
      }

      // comets
      for (let i = 0; i < NC; i++) {
        const f = flights[i];
        f.t += dt * f.speed;
        if (f.t > 1 + SPAN) f.t = 0;
        for (let s = 0; s < TRAIL - 1; s++) {
          const base = (i * (TRAIL - 1) + s) * 6;
          for (let e2 = 0; e2 < 2; e2++) {
            const k = (s + e2) / (TRAIL - 1);
            f.curve.getPoint(Math.max(0, Math.min(1, f.t - k * SPAN)), v);
            tailPos[base + e2 * 3] = v.x; tailPos[base + e2 * 3 + 1] = v.y; tailPos[base + e2 * 3 + 2] = v.z;
            const fade = Math.pow(1 - k, 2.2) * (f.t > 1 ? Math.max(0, 1 - (f.t - 1) / SPAN) : 1);
            tailCol[base + e2 * 3] = 0.45 * fade;
            tailCol[base + e2 * 3 + 1] = 0.88 * fade;
            tailCol[base + e2 * 3 + 2] = 1.0 * fade;
          }
        }
        f.curve.getPoint(Math.max(0, Math.min(1, f.t)), v);
        headPos[i * 3] = v.x; headPos[i * 3 + 1] = v.y; headPos[i * 3 + 2] = v.z;
      }
      tailGeo.attributes.position.needsUpdate = true;
      tailGeo.attributes.color.needsUpdate = true;
      headGeo.attributes.position.needsUpdate = true;

      // hubs breathe
      clouds.hub.material.size = clouds.hub.userData.base * (1 + Math.sin(clock * 1.7) * 0.14);

      // selected-airport ring pulse + arcs drawing themselves out
      if (ringMat) ringMat.size = 0.15 + Math.sin(clock * 3.4) * 0.045;
      if (label) label.material.opacity = Math.min(1, (label.material.opacity || 0) + dt * 3);
      drawing.forEach((d) => {
        d.at = Math.min(1, d.at + dt * 1.5);
        d.line.geometry.setDrawRange(0, Math.max(0, Math.round(d.at * d.n)));
      });

      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    })(last);

    return { setResults, focus, mode: "3d" };
  }

  /** Great-circle-ish arc, bowed out in proportion to the distance flown. */
  function arc(T, A, B, bow = 0.28) {
    const va = new T.Vector3(...toVec3(A.lat, A.lon, 1.006));
    const vb = new T.Vector3(...toVec3(B.lat, B.lon, 1.006));
    const mid = va.clone().add(vb).multiplyScalar(0.5).normalize()
      .multiplyScalar(1 + va.distanceTo(vb) * bow);
    return new T.QuadraticBezierCurve3(va, mid, vb);
  }

  /** A HUD callout on a dark plate — additive text alone washes out over the
   *  bright side of the globe, which is exactly where a hit usually lands. */
  function makeLabel(T, a, color) {
    const W = 300, H = 72, s = 3;
    const c = document.createElement("canvas");
    c.width = W * s; c.height = H * s;
    const x = c.getContext("2d"); x.scale(s, s);
    const hex = "#" + color.toString(16).padStart(6, "0");

    x.fillStyle = "rgba(5,9,20,.88)";
    x.strokeStyle = hex; x.lineWidth = 1.5;
    roundRect(x, 3, 3, W - 6, H - 6, 9); x.fill(); x.stroke();
    x.fillStyle = hex; x.fillRect(3, 3, 4, H - 6);            // accent spine

    x.font = "700 27px ui-monospace,SFMono-Regular,Menlo,monospace";
    x.fillStyle = hex; x.textAlign = "left";
    x.fillText(a.iata || "—", 20, 33);
    x.font = "400 16px -apple-system,Segoe UI,PingFang SC,sans-serif";
    x.fillStyle = "rgba(220,231,247,.92)";
    x.fillText(clip(a.city + " · " + a.country, 30), 20, 56);

    const sp = new T.Sprite(new T.SpriteMaterial({
      map: new T.CanvasTexture(c), transparent: true, opacity: 0,
      depthWrite: false, depthTest: false }));
    sp.scale.set(0.60, 0.144, 1);
    // offset in SCREEN space, not world space, so the label always sits above
    // the marker no matter how the globe is rotated
    sp.center.set(0.5, -0.5);
    return sp;
  }
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  function roundRect(x, l, t, w, h, r) {
    x.beginPath();
    x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r);
    x.arcTo(l + w, t + h, l, t + h, r); x.arcTo(l, t + h, l, t, r);
    x.arcTo(l, t, l + w, t, r); x.closePath();
  }

  function dotTexture(T) {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.32, "rgba(255,255,255,.6)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(c);
  }
  function ringTexture(T) {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d");
    x.strokeStyle = "rgba(255,255,255,1)"; x.lineWidth = 4;
    x.beginPath(); x.arc(32, 32, 20, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = "rgba(255,255,255,.4)"; x.lineWidth = 2;
    x.beginPath(); x.arc(32, 32, 29, 0, Math.PI * 2); x.stroke();
    return new T.CanvasTexture(c);
  }

  // =====================================================================
  //  2D fallback — same data, same outlines, same API, no WebGL
  // =====================================================================
  function init2d(canvas, airports, routes, onHover) {
    const ctx = canvas.getContext("2d");
    let W = 0, H = 0, results = [], t = 0;
    const byIata = new Map(airports.map((a) => [a.iata, a]));
    const P = (a) => [((a.lon + 180) / 360) * W, ((90 - a.lat) / 180) * H];
    const hex = (n) => "#" + n.toString(16).padStart(6, "0");
    const flights = routes.slice(0, 40).map((r, i) => ({ r, t: i / 40 }));

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

    const curve = (A, B) => {
      const [x1, y1] = P(A), [x2, y2] = P(B);
      return [x1, y1, (x1 + x2) / 2, (y1 + y2) / 2 - Math.abs(x1 - x2) * 0.22, x2, y2];
    };
    const at = (c, u) => {           // quadratic bezier point
      const k = 1 - u;
      return [k * k * c[0] + 2 * k * u * c[2] + u * u * c[4],
              k * k * c[1] + 2 * k * u * c[3] + u * u * c[5]];
    };

    (function draw() {
      t += 0.004;
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(96,165,250,.08)";
      for (let lon = -180; lon <= 180; lon += 30) {
        const x = ((lon + 180) / 360) * W;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        const y = ((90 - lat) / 180) * H;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.strokeStyle = "rgba(61,146,204,.62)";
      OUTLINES.forEach((ring) => {
        ctx.beginPath();
        for (let i = 0; i < ring.length; i += 2) {
          const x = ((ring[i] + 180) / 360) * W, y = ((90 - ring[i + 1]) / 180) * H;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath(); ctx.stroke();
      });
      ctx.strokeStyle = "rgba(34,211,238,.16)";
      routes.forEach(([s, d]) => {
        const A = byIata.get(s), B = byIata.get(d);
        if (!A || !B) return;
        const c = curve(A, B);
        if (Math.abs(c[0] - c[4]) > W / 2) return;          // skip dateline wrap
        ctx.beginPath(); ctx.moveTo(c[0], c[1]);
        ctx.quadraticCurveTo(c[2], c[3], c[4], c[5]); ctx.stroke();
      });
      flights.forEach((f) => {
        const A = byIata.get(f.r[0]), B = byIata.get(f.r[1]);
        if (!A || !B) return;
        const c = curve(A, B);
        if (Math.abs(c[0] - c[4]) > W / 2) return;
        f.t = (f.t + 0.0016) % 1;
        for (let k = 0; k < 6; k++) {
          const [x, y] = at(c, Math.max(0, f.t - k * 0.02));
          ctx.fillStyle = `rgba(190,240,255,${0.75 * (1 - k / 6)})`;
          ctx.beginPath(); ctx.arc(x, y, 1.7 - k * 0.2, 0, 7); ctx.fill();
        }
      });
      airports.forEach((a) => {
        const [x, y] = P(a);
        ctx.fillStyle = hex(COLORS[a.size]); ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.arc(x, y, a.size === "hub" ? 2.6 : a.size === "large" ? 2 : 1.4, 0, 7); ctx.fill();
      });
      ctx.globalAlpha = 1;
      results.forEach((it) => {
        const [x, y] = P(it.a), c = hex(HL[it.key] || HL.hybrid);
        const r = (it.top ? 9 : 6) + Math.sin(t * 9) * 2.5;
        ctx.strokeStyle = c; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 7); ctx.fill();
        if (it.top) {
          ctx.fillStyle = c; ctx.font = "600 11px ui-monospace,Menlo,monospace";
          ctx.textAlign = "center"; ctx.fillText(it.a.iata || "", x, y - r - 6);
        }
      });
      requestAnimationFrame(draw);
    })();

    return { setResults: (r) => { results = r || []; }, focus: () => {}, mode: "2d" };
  }

  function init(canvas, airports, routes, onHover) {
    try {
      if (window.THREE) { api = init3d(canvas, airports, routes, onHover); mode = "3d"; }
    } catch (e) { console.warn("3D globe unavailable, falling back to 2D:", e); }
    if (!mode) { api = init2d(canvas, airports, routes, onHover); mode = "2d"; }
    return api;
  }

  return { init, get mode() { return mode; } };
})();
