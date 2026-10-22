// WebGL program for the elevated flight ribbons. MapLibre supplies a prelude
// per projection variant, so programs are compiled and cached per variant.
import { EARTH_RADIUS } from './flight-geometry.js';

const UNIFORMS = [
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
];
/** Vertex attributes, in buffer order. */
export const ATTRIBUTES = ['a_position', 'a_other', 'a_data'];

/**
 * @typedef {{ variantName: string, vertexShaderPrelude: string, define: string }} ShaderData
 * @typedef {{ program: WebGLProgram, uniforms: Record<string, WebGLUniformLocation>,
 *   attributes: Record<string, number> }} ProgramEntry
 */

/**
 * @param {ShaderData} data
 * @returns {string}
 */
const vertexSource = data => `#version 300 es
      precision highp float;
      ${data.vertexShaderPrelude}
      ${data.define}
      in vec3 a_position; in vec3 a_other; in vec3 a_data;
      uniform vec2 u_viewport; uniform float u_width; uniform bool u_depth;
      out float v_along; out float v_t;
      vec4 position(vec3 p, float meterScale) {
        #ifdef GLOBE
          p.z *= u_projection_transition * u_projection_transition;
          vec3 sphere = projectToSphere(p.xy) * (1.0 + p.z / ${EARTH_RADIUS});
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

const FRAGMENT_SOURCE = `#version 300 es
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

/**
 * @param {WebGL2RenderingContext} gl
 * @param {number} type
 * @param {string} source
 * @returns {WebGLShader}
 */
function compile(gl, type, source) {
  const item = gl.createShader(type);
  gl.shaderSource(item, source);
  gl.compileShader(item);
  if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(item));
  }
  return item;
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {ShaderData} data
 * @returns {WebGLProgram}
 */
function link(gl, data) {
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSource(data)),
    fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  return program;
}

/**
 * Returns the program for MapLibre's current projection variant, compiling
 * it on first use.
 * @param {WebGL2RenderingContext} gl
 * @param {ShaderData} data
 * @param {Map<string, ProgramEntry>} programs cache
 * @returns {ProgramEntry}
 */
export function flightProgram(gl, data, programs) {
  if (programs.has(data.variantName)) return programs.get(data.variantName);
  const program = link(gl, data);
  const entry = {
    program,
    uniforms: Object.fromEntries(
      UNIFORMS.map(name => [name, gl.getUniformLocation(program, name)])
    ),
    attributes: Object.fromEntries(
      ATTRIBUTES.map(name => [name, gl.getAttribLocation(program, name)])
    )
  };
  programs.set(data.variantName, entry);
  return entry;
}
