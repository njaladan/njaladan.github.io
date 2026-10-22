// Elevated great-circle ribbons use MapLibre's globe projection and depth buffer.
// Heights are illustrative, not recorded aircraft altitudes.
export function createGlobeFlights(log, { onSelect, onHover }) {
  const radius = 6371008.8,
    programs = new Map();
  const routes = log.routes
    .map((route, index) => {
      const flight = log.flights[route.flights[0]],
        from = log.airports[flight?.from || route.airports[0]],
        to = log.airports[flight?.to || route.airports[1]];
      if (!from || !to) return null;
      const vector = ([lat, lon]) => {
        lat *= Math.PI / 180;
        lon *= Math.PI / 180;
        return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
      };
      const a = vector(from.coords),
        b = vector(to.coords),
        angle = Math.acos(
          Math.max(
            -1,
            Math.min(
              1,
              a.reduce((sum, value, i) => sum + value * b[i], 0)
            )
          )
        );
      const height = Math.min(1500000, Math.max(80000, angle * radius * 0.16));
      const points = Array.from({ length: 97 }, (_, i) => {
        const t = i / 96,
          sine = Math.sin(angle);
        const v =
          Math.abs(sine) < 1e-6
            ? a
            : a.map(
                (value, j) =>
                  (Math.sin((1 - t) * angle) * value + Math.sin(t * angle) * b[j]) / sine
              );
        const lat = (Math.atan2(v[2], Math.hypot(v[0], v[1])) * 180) / Math.PI,
          lon = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
        const mercator = maplibregl.MercatorCoordinate.fromLngLat([lon, lat]);
        return {
          x: mercator.x,
          y: mercator.y,
          height: Math.sin(Math.PI * t) * height,
          scale: mercator.meterInMercatorCoordinateUnits(),
          along: (t * angle * radius) / 1000,
          t,
          coords: [lon, lat]
        };
      });
      return { index, route, points, height };
    })
    .filter(Boolean);
  const floats = [],
    ranges = [];
  // The side's magnitude carries progress along the arc (1 at departure, 2 at arrival).
  const vertex = (point, other, side) =>
    floats.push(
      point.x,
      point.y,
      point.height,
      other.x,
      other.y,
      other.height,
      point.scale,
      side * (1 + point.t),
      point.along
    );
  routes.forEach(({ points, index }) => {
    const first = floats.length / 9;
    points.slice(1).forEach((b, i) => {
      const a = points[i];
      // Keep adjacent longitudes continuous when a connection crosses the dateline.
      let bx = b.x;
      while (bx - a.x > 0.5) bx -= 1;
      while (bx - a.x < -0.5) bx += 1;
      const next = { ...b, x: bx };
      vertex(a, next, -1);
      vertex(next, a, 1);
      vertex(a, next, 1);
      vertex(a, next, 1);
      vertex(next, a, 1);
      vertex(next, a, -1);
    });
    ranges.push({ index, first, count: floats.length / 9 - first });
  });
  const sphere = [];
  const surfaceVertex = (lon, lat) => {
    const p = maplibregl.MercatorCoordinate.fromLngLat([
      lon,
      Math.max(-89.999, Math.min(89.999, lat))
    ]);
    sphere.push(p.x, p.y, -1000, p.x, p.y, 0, p.meterInMercatorCoordinateUnits(), 0, 0);
  };
  for (let lat = -90; lat < 90; lat += 3)
    for (let lon = -180; lon < 180; lon += 3) {
      surfaceVertex(lon, lat);
      surfaceVertex(lon + 3, lat);
      surfaceVertex(lon, lat + 3);
      surfaceVertex(lon, lat + 3);
      surfaceVertex(lon + 3, lat);
      surfaceVertex(lon + 3, lat + 3);
    }
  const styles = new Map();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let map,
    flightBuffer,
    sphereBuffer,
    vao,
    latest = null,
    repaintTimer = null,
    hovered = null,
    modalObserver,
    batches = null,
    projectedRoutes = null;
  let flowTime = 0,
    lastTime = null,
    projectionDirty = true;
  const paused = () =>
    motion.matches ||
    document.hidden ||
    document.body.classList.contains('photo-fullscreen') ||
    map?.isMoving();
  const resume = () => {
    lastTime = performance.now();
    if (!document.hidden) map?.triggerRepaint();
  };
  function shader(gl, data) {
    if (programs.has(data.variantName)) return programs.get(data.variantName);
    const vertexSource = `#version 300 es
      precision highp float;
      ${data.vertexShaderPrelude}
      ${data.define}
      in vec3 a_position; in vec3 a_other; in vec3 a_data;
      uniform vec2 u_viewport; uniform float u_width; uniform bool u_depth;
      out float v_along; out float v_t;
      vec4 position(vec3 p, float meterScale) {
        #ifdef GLOBE
          p.z *= u_projection_transition * u_projection_transition;
          vec3 sphere = projectToSphere(p.xy) * (1.0 + p.z / 6371008.8);
          vec4 globe = u_projection_matrix * vec4(sphere, 1.0);
          vec4 planar = u_projection_fallback_matrix * vec4(p.xy, p.z * meterScale, 1.0);
          return mix(planar, globe, u_projection_transition);
        #else
          return u_projection_matrix * vec4(p.xy, p.z * meterScale, 1.0);
        #endif
      }
      void main() {
        vec4 current = position(a_position, a_data.x);
        if (!u_depth) {
          vec4 other = position(a_other, a_data.x);
          vec2 direction = (other.xy / other.w - current.xy / current.w) * u_viewport;
          vec2 normal = vec2(-direction.y, direction.x) / max(length(direction), 0.00001);
          current.xy += normal * sign(a_data.y) * u_width / u_viewport * current.w;
        }
        v_along = a_data.z; v_t = abs(a_data.y) - 1.0; gl_Position = current;
      }`;
    const fragmentSource = `#version 300 es
      precision highp float;
      in float v_along; in float v_t; uniform float u_time; uniform float u_density; uniform float u_opacity; uniform bool u_depth; uniform vec3 u_color;
      out vec4 fragColor;
      void main() {
        // A faint solid arc carries a flowing highlight, fading toward both airports.
        float pulse = mod(v_along * u_density - u_time * 4.5, 9.0) > 4.0 ? 0.0 : 1.0;
        float lift = smoothstep(0.0, 0.18, v_t) * smoothstep(1.0, 0.82, v_t);
        float alpha = u_opacity * mix(0.3, 1.0, lift) * mix(0.35, 1.0, pulse);
        fragColor = vec4(u_color * alpha, alpha);
      }`;
    const compile = (type, source) => {
      const item = gl.createShader(type);
      gl.shaderSource(item, source);
      gl.compileShader(item);
      if (!gl.getShaderParameter(item, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(item));
      return item;
    };
    const vs = compile(gl.VERTEX_SHADER, vertexSource),
      fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program));
    const entry = { program, uniforms: {}, attributes: {} };
    [
      'u_projection_matrix',
      'u_projection_fallback_matrix',
      'u_projection_tile_mercator_coords',
      'u_projection_clipping_plane',
      'u_projection_transition',
      'u_viewport',
      'u_width',
      'u_depth',
      'u_time',
      'u_density',
      'u_opacity',
      'u_color'
    ].forEach(name => (entry.uniforms[name] = gl.getUniformLocation(program, name)));
    ['a_position', 'a_other', 'a_data'].forEach(
      name => (entry.attributes[name] = gl.getAttribLocation(program, name))
    );
    programs.set(data.variantName, entry);
    return entry;
  }
  function transform(matrix, point) {
    return [0, 1, 2, 3].map(
      i =>
        matrix[i] * point[0] + matrix[i + 4] * point[1] + matrix[i + 8] * point[2] + matrix[i + 12]
    );
  }
  function screen(point) {
    const data = latest,
      t = data.projectionTransition,
      lambda = point.x * 2 * Math.PI + Math.PI,
      phi = (point.coords[1] * Math.PI) / 180;
    const height = point.height * t * t;
    const r = 1 + height / radius,
      sphere = [
        Math.sin(lambda) * Math.cos(phi) * r,
        Math.sin(phi) * r,
        Math.cos(lambda) * Math.cos(phi) * r
      ];
    const clip = data.clippingPlane;
    if (t > 0.8 && sphere.reduce((sum, value, i) => sum + value * clip[i], clip[3]) < 0)
      return null;
    const globe = transform(data.mainMatrix, sphere),
      flat = transform(data.fallbackMatrix, [point.x, point.y, height * point.scale]);
    const p = globe.map((value, i) => flat[i] * (1 - t) + value * t);
    if (p[3] <= 0) return null;
    return {
      x: ((p[0] / p[3] + 1) * map.getContainer().clientWidth) / 2,
      y: ((1 - p[1] / p[3]) * map.getContainer().clientHeight) / 2
    };
  }
  function invalidateProjection() {
    projectedRoutes = null;
    projectionDirty = true;
  }
  function nearestRoute(event) {
    if (!latest || map.getZoom() >= 6) return null;
    let nearest = null,
      distance = 9;
    // Dash animation does not move the ribbons. Project each point once per
    // camera view, rather than both ends of every segment on every mousemove.
    projectedRoutes ||= routes.map(route => ({ route, points: route.points.map(screen) }));
    projectedRoutes.forEach(({ route, points }) =>
      points.slice(1).forEach((b, i) => {
        const a = points[i];
        if (!a || !b) return;
        const dx = b.x - a.x,
          dy = b.y - a.y,
          t = Math.max(
            0,
            Math.min(
              1,
              ((event.point.x - a.x) * dx + (event.point.y - a.y) * dy) / (dx * dx + dy * dy || 1)
            )
          );
        const d = Math.hypot(event.point.x - a.x - t * dx, event.point.y - a.y - t * dy);
        if (d < distance) {
          nearest = route;
          distance = d;
        }
      })
    );
    return nearest;
  }
  function pick(event) {
    const nearest = nearestRoute(event);
    if (nearest) {
      event.flightPicked = true;
      onSelect(nearest.route, event.lngLat);
    }
  }
  function hover(event) {
    const nearest = nearestRoute(event);
    if (nearest === hovered) return;
    hovered = nearest;
    map.getCanvas().style.cursor = nearest ? 'pointer' : '';
    onHover?.(nearest?.route || null, event.lngLat);
  }
  function leave() {
    hovered = null;
    map.getCanvas().style.cursor = '';
    onHover?.(null);
  }
  return {
    id: 'elevated-flights',
    type: 'custom',
    renderingMode: '3d',
    routes,
    setStyle(index, style) {
      styles.set(index, { ...style });
      batches = null;
      map?.triggerRepaint();
    },
    onAdd(owner, gl) {
      map = owner;
      vao = gl.createVertexArray();
      flightBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, flightBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(floats), gl.STATIC_DRAW);
      sphereBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(sphere), gl.STATIC_DRAW);
      map.on('click', pick);
      map.on('mousemove', hover);
      map.on('mouseout', leave);
      map.on('movestart', leave);
      map.on('move', invalidateProjection);
      map.on('resize', invalidateProjection);
      document.addEventListener('visibilitychange', resume);
      motion.addEventListener('change', resume);
      modalObserver = new MutationObserver(resume);
      modalObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    },
    render(gl, args) {
      const z = map.getZoom();
      if (z >= 6) return;
      latest = args.defaultProjectionData;
      if (projectionDirty) {
        projectedRoutes = null;
        projectionDirty = false;
      }
      const entry = shader(gl, args.shaderData),
        u = entry.uniforms;
      gl.useProgram(entry.program);
      gl.bindVertexArray(vao);
      gl.uniformMatrix4fv(u.u_projection_matrix, false, latest.mainMatrix);
      gl.uniformMatrix4fv(u.u_projection_fallback_matrix, false, latest.fallbackMatrix);
      gl.uniform4fv(u.u_projection_tile_mercator_coords, latest.tileMercatorCoords);
      gl.uniform4fv(u.u_projection_clipping_plane, latest.clippingPlane);
      gl.uniform1f(u.u_projection_transition, latest.projectionTransition);
      gl.uniform2f(u.u_viewport, gl.drawingBufferWidth, gl.drawingBufferHeight);
      const now = performance.now();
      if (lastTime !== null && !paused()) flowTime += now - lastTime;
      lastTime = now;
      gl.uniform1f(u.u_time, flowTime / 1000);
      gl.uniform1f(u.u_density, (512 * 2 ** z) / 40075);
      const bind = buffer => {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        Object.entries(entry.attributes).forEach(([, location], i) => {
          if (location >= 0) {
            gl.enableVertexAttribArray(location);
            gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 36, i * 12);
          }
        });
      };
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthRange(0, 1);
      gl.disable(gl.CULL_FACE);
      // The basemap's 2D layers use artificial depth ranges. This last layer
      // starts its own depth pass so they cannot hide arcs over the near face.
      gl.depthMask(true);
      gl.clearDepth(1);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.colorMask(false, false, false, false);
      gl.uniform1i(u.u_depth, 1);
      bind(sphereBuffer);
      gl.drawArrays(gl.TRIANGLES, 0, sphere.length / 9);
      gl.colorMask(true, true, true, true);
      gl.depthMask(false);
      gl.uniform1i(u.u_depth, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      bind(flightBuffer);
      // All visual states come from the shared application's flight layers,
      // including keyboard, hover and open-card emphasis.
      // Adjacent routes with the same shared style need one draw, rather than
      // a separate draw per flight on every animation frame.
      batches ||= ranges.reduce((groups, range) => {
        const style = styles.get(range.index);
        if (!style) return groups;
        const previous = groups.at(-1);
        if (
          previous &&
          previous.first + previous.count === range.first &&
          ['color', 'weight', 'opacity'].every(key => previous.style[key] === style[key])
        )
          previous.count += range.count;
        else groups.push({ ...range, style });
        return groups;
      }, []);
      batches.forEach(({ style, first, count }) => {
        const color = style.color;
        gl.uniform3f(
          u.u_color,
          parseInt(color.slice(1, 3), 16) / 255,
          parseInt(color.slice(3, 5), 16) / 255,
          parseInt(color.slice(5, 7), 16) / 255
        );
        gl.uniform1f(u.u_width, style.weight * map.getPixelRatio());
        gl.uniform1f(u.u_opacity, style.opacity * Math.min(1, (6 - z) / 1.5));
        gl.drawArrays(gl.TRIANGLES, first, count);
      });
      gl.bindVertexArray(null);
      if (!paused() && repaintTimer === null)
        repaintTimer = setTimeout(() => {
          repaintTimer = null;
          map.triggerRepaint();
        }, 33);
    },
    onRemove(owner, gl) {
      owner.off('click', pick);
      gl.deleteBuffer(flightBuffer);
      gl.deleteBuffer(sphereBuffer);
      gl.deleteVertexArray(vao);
      owner.off('mousemove', hover);
      owner.off('mouseout', leave);
      owner.off('movestart', leave);
      owner.off('move', invalidateProjection);
      owner.off('resize', invalidateProjection);
      clearTimeout(repaintTimer);
      document.removeEventListener('visibilitychange', resume);
      motion.removeEventListener('change', resume);
      modalObserver.disconnect();
      programs.forEach(entry => gl.deleteProgram(entry.program));
      programs.clear();
    }
  };
}
