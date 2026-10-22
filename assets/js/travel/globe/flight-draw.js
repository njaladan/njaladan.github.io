// Per-frame WebGL drawing for the elevated flight ribbons.
import { VERTEX_FLOATS, arcFade, rgb } from './flight-geometry.js';

const FLOAT_BYTES = 4;
// Each attribute is a vec3 within the vertex.
const ATTRIBUTE_SIZE = 3;
// World tile size in pixels, and the Earth's circumference in kilometres:
// together they give the dash pattern a constant on-screen density.
const WORLD_TILE = 512;
const EARTH_KM = 40075;

/**
 * @typedef {import('./flight-shader.js').ProgramEntry} ProgramEntry
 * @typedef {{ entry: ProgramEntry, vao: WebGLVertexArrayObject, flightBuffer: WebGLBuffer,
 *   sphereBuffer: WebGLBuffer, sphereCount: number, batches: import('./flight-geometry.js').Batch[],
 *   seconds: number, zoom: number, pixelRatio: number }} Frame
 */

/**
 * @param {WebGL2RenderingContext} gl
 * @param {Record<string, WebGLUniformLocation>} u
 * @param {any} data MapLibre's default projection data
 */
function setProjection(gl, u, data) {
  gl.uniformMatrix4fv(u.u_projection_matrix, false, data.mainMatrix);
  gl.uniformMatrix4fv(u.u_projection_fallback_matrix, false, data.fallbackMatrix);
  gl.uniform4fv(u.u_projection_tile_mercator_coords, data.tileMercatorCoords);
  gl.uniform4fv(u.u_projection_clipping_plane, data.clippingPlane);
  gl.uniform1f(u.u_projection_transition, data.projectionTransition);
  gl.uniform2f(u.u_viewport, gl.drawingBufferWidth, gl.drawingBufferHeight);
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {ProgramEntry} entry
 * @param {WebGLBuffer} buffer
 */
function bindAttributes(gl, entry, buffer) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  Object.values(entry.attributes).forEach((location, i) => {
    if (location >= 0) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(
        location,
        ATTRIBUTE_SIZE,
        gl.FLOAT,
        false,
        VERTEX_FLOATS * FLOAT_BYTES,
        i * ATTRIBUTE_SIZE * FLOAT_BYTES
      );
    }
  });
}

/**
 * The basemap's 2D layers use artificial depth ranges. This last layer
 * starts its own depth pass, writing only the globe's surface, so they cannot
 * hide arcs over the near face while the far face still hides arcs behind it.
 * @param {WebGL2RenderingContext} gl
 * @param {Frame} frame
 */
function drawDepthSphere(gl, frame) {
  const u = frame.entry.uniforms;
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.depthRange(0, 1);
  gl.disable(gl.CULL_FACE);
  gl.depthMask(true);
  gl.clearDepth(1);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.colorMask(false, false, false, false);
  gl.uniform1i(u.u_depth, 1);
  bindAttributes(gl, frame.entry, frame.sphereBuffer);
  gl.drawArrays(gl.TRIANGLES, 0, frame.sphereCount);
  gl.colorMask(true, true, true, true);
  gl.depthMask(false);
}

/**
 * All visual states come from the shared application's flight layers,
 * including keyboard, hover and open-card emphasis.
 * @param {WebGL2RenderingContext} gl
 * @param {Frame} frame
 */
function drawRibbons(gl, frame) {
  const u = frame.entry.uniforms;
  gl.uniform1i(u.u_depth, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  bindAttributes(gl, frame.entry, frame.flightBuffer);
  const fade = arcFade(frame.zoom);
  frame.batches.forEach(({ style, first, count }) => {
    const [r, g, b] = rgb(style.color);
    gl.uniform3f(u.u_color, r, g, b);
    gl.uniform1f(u.u_width, style.weight * frame.pixelRatio);
    gl.uniform1f(u.u_opacity, style.opacity * fade);
    gl.drawArrays(gl.TRIANGLES, first, count);
  });
}

/**
 * Draws one frame of flight ribbons over the basemap.
 * @param {WebGL2RenderingContext} gl
 * @param {any} projection MapLibre's default projection data
 * @param {Frame} frame
 */
export function drawFlights(gl, projection, frame) {
  const u = frame.entry.uniforms;
  gl.useProgram(frame.entry.program);
  gl.bindVertexArray(frame.vao);
  setProjection(gl, u, projection);
  gl.uniform1f(u.u_time, frame.seconds);
  gl.uniform1f(u.u_density, (WORLD_TILE * 2 ** frame.zoom) / EARTH_KM);
  drawDepthSphere(gl, frame);
  drawRibbons(gl, frame);
  gl.bindVertexArray(null);
}
