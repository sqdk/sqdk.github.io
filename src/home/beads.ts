/**
 * Home page backdrop: a lattice of chrome beads carved by a slowly morphing gyroid
 * surface, raymarched in a single fragment shader. No dependencies.
 *
 * The beads sit on a fixed cubic grid. A gyroid field moves through that grid and
 * everything on its "empty" side is cut away, so beads near the surface get sliced
 * into discs as it passes. The camera sits at the centre of a gyroid void.
 */

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform float uCell;    // lattice pitch
uniform float uGrow;    // 0..1 bead radius (intro)
uniform float uK;       // gyroid frequency
uniform float uTh;      // carve threshold: higher = more empty space
uniform vec3 uOff;      // gyroid phase at the camera
uniform mat3 uRot;      // gyroid orientation
uniform mat3 uCam;      // camera orientation

const int STEPS = 80;
const float REACH = 44.0;        // how far a ray travels, in lattice cells
const float BOUNCE_REACH = 10.0;
const vec3 VOID = vec3(0.0);

// > 0 inside the solid
float field(vec3 p) {
  vec3 q = uRot * p * uK + uOff;
  return dot(sin(q), cos(q.zxy)) - uTh;
}

vec3 fieldGrad(vec3 p) {
  vec3 q = uRot * p * uK + uOff;
  vec3 s = sin(q), c = cos(q);
  vec3 g = vec3(c.x * c.z - s.y * s.x, c.y * c.x - s.z * s.y, c.z * c.y - s.x * s.z);
  return g * uRot;
}

// March a ray through the bead lattice. Returns true on a hit.
// n: surface normal, cell: lattice cell of the bead, cut: 1 on a sliced face.
// reach: give up after this distance.
bool trace(vec3 ro, vec3 rd, float reach, out float tHit, out vec3 n, out vec3 cell, out float cut) {
  float S = uCell;
  float R = 0.5 * S * uGrow;
  float margin = uK * S * 1.1;
  vec3 sg = sign(rd);
  vec3 inv = 1.0 / rd;
  vec3 tD = abs(S * inv);
  cell = floor(ro / S);
  vec3 tM = ((cell + step(0.0, rd)) * S - ro) * inv;
  float t = 0.0;
  for (int i = 0; i < STEPS; i++) {
    if (t > reach) break;
    vec3 c = (cell + 0.5) * S;
    float g = field(c);
    if (g > -margin) {
      vec3 oc = ro - c;
      float b = dot(oc, rd);
      float h = b * b - dot(oc, oc) + R * R;
      if (h > 0.0) {
        h = sqrt(h);
        float t0 = max(-b - h, 0.0);
        float t1 = -b + h;
        if (t1 > t0) {
          float g0 = field(ro + rd * t0);
          if (g0 > 0.0) {
            tHit = t0;
            n = normalize(ro + rd * t0 - c);
            cut = 0.0;
            return true;
          }
          // The bead is partly carved away: walk the chord to find the cut face.
          float ta = t0, ga = g0, tb = t0, gb = g0;
          for (int j = 0; j < 6; j++) {
            tb = min(ta + max(-ga / (uK * 1.6), S * 0.03), t1);
            gb = field(ro + rd * tb);
            if (gb > 0.0 || tb >= t1) break;
            ta = tb; ga = gb;
          }
          if (gb > 0.0) {
            tHit = mix(ta, tb, ga / (ga - gb));
            n = -normalize(fieldGrad(ro + rd * tHit));
            cut = 1.0;
            return true;
          }
        }
      }
    }
    if (tM.x < tM.y && tM.x < tM.z) { t = tM.x; tM.x += tD.x; cell.x += sg.x; }
    else if (tM.y < tM.z) { t = tM.y; tM.y += tD.y; cell.y += sg.y; }
    else { t = tM.z; tM.z += tD.z; cell.z += sg.z; }
  }
  tHit = t;
  return false;
}

// Studio-style surroundings for the chrome to reflect: dark room, soft lights.
vec3 env(vec3 d) {
  float up = d.y * 0.5 + 0.5;
  vec3 col = mix(vec3(0.015, 0.018, 0.022), vec3(0.11, 0.12, 0.13), up * up);
  float key = max(dot(d, normalize(vec3(-0.45, 0.8, 0.35))), 0.0);
  col += vec3(1.0, 0.98, 0.95) * (pow(key, 6.0) * 0.9 + pow(key, 60.0) * 2.5);
  float rim = max(dot(d, normalize(vec3(0.8, 0.1, -0.55))), 0.0);
  col += vec3(0.55, 0.8, 1.0) * pow(rim, 10.0) * 0.5;
  float fill = max(dot(d, normalize(vec3(0.1, -0.9, 0.4))), 0.0);
  col += vec3(0.22, 0.2, 0.19) * pow(fill, 3.0);
  return col;
}

vec3 spectrum(float x) {
  return 0.5 + 0.5 * cos(6.2831853 * (x + vec3(0.0, 0.33, 0.67)));
}

// Per-bead metal tint: mostly silver, with drifting patches of oil-slick colour.
vec3 tint(vec3 cell) {
  vec3 p = (cell + 0.5) * uCell * 0.55;
  float m = sin(p.x * 1.3 + uTime * 0.11) * sin(p.y * 1.7 - uTime * 0.07) * sin(p.z * 1.1 + uTime * 0.05)
          + 0.5 * sin(p.x * 2.9 + p.y * 2.3 - p.z * 1.9 + uTime * 0.09);
  float patch = smoothstep(0.35, 0.75, m);
  vec3 irid = mix(vec3(1.0, 0.85, 0.55), spectrum(m * 2.2 + uTime * 0.05), smoothstep(0.55, 0.9, m));
  return mix(vec3(0.93, 0.94, 0.96), irid, patch * 0.85);
}

void main() {
  // Normalise by height, but widen the view a little on tall (phone) screens.
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / min(uRes.y, uRes.x * 1.6);
  vec3 ro = vec3(0.37, 0.41, 0.29) * uCell;   // off the lattice planes
  vec3 rd = uCam * normalize(vec3(uv, -1.25));
  rd += step(abs(rd), vec3(1e-4)) * 1e-4;

  float t, cut, t2, cut2;
  vec3 n, cell, n2, cell2;
  vec3 col = VOID;

  if (trace(ro, rd, REACH * uCell, t, n, cell, cut)) {
    vec3 p = ro + rd * t;
    vec3 base = tint(cell);
    vec3 r = reflect(rd, n);
    r += step(abs(r), vec3(1e-4)) * 1e-4;
    float fres = pow(1.0 - max(dot(-rd, n), 0.0), 4.0);

    // One bounce, so beads mirror their neighbours.
    vec3 refl;
    if (trace(p + n * uCell * 0.02, r, BOUNCE_REACH * uCell, t2, n2, cell2, cut2)) {
      vec3 r2 = reflect(r, n2);
      refl = env(r2) * tint(cell2) * (0.55 + 0.45 * max(dot(n2, -r), 0.0));
      refl *= exp(-t2 / (uCell * 14.0)) * 0.9 + 0.1;
    } else {
      refl = env(r);
    }

    // Sliced faces read as brushed, slightly matte metal; whole beads as mirror chrome.
    float gloss = mix(1.0, 0.55, cut);
    vec3 diffuse = base * (0.05 + 0.3 * max(dot(n, normalize(vec3(-0.45, 0.8, 0.35))), 0.0));
    col = mix(diffuse, refl * base, gloss * mix(0.8, 1.0, fres));
    col += fres * 0.04;

    col = mix(col, VOID, smoothstep(0.35, 1.0, t / (uCell * REACH)));
  }

  col = col / (1.0 + col * 0.35);
  col = pow(col, vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface Beads {
	/** Draw one frame. `time` in seconds, `grow` 0..1 bead size. */
	render(time: number, grow: number): void;
	resize(): void;
	/** Change the cap on rendered pixels (the canvas is stretched by CSS beyond it). */
	setBudget(maxPixels: number): void;
}

function rotationYXZ(yaw: number, pitch: number, roll: number): number[] {
	const cy = Math.cos(yaw), sy = Math.sin(yaw);
	const cp = Math.cos(pitch), sp = Math.sin(pitch);
	const cr = Math.cos(roll), sr = Math.sin(roll);
	// Column-major mat3 = Ry * Rx * Rz
	return [
		cy * cr + sy * sp * sr, cp * sr, -sy * cr + cy * sp * sr,
		-cy * sr + sy * sp * cr, cp * cr, sy * sr + cy * sp * cr,
		sy * cp, -sp, cy * cp,
	];
}

/**
 * @param maxPixels cap on rendered pixels; the canvas is scaled up by CSS beyond that.
 */
export function createBeads(canvas: HTMLCanvasElement, initialMaxPixels: number): Beads | null {
	let maxPixels = initialMaxPixels;
	const gl = canvas.getContext('webgl', {
		alpha: false,
		antialias: false,
		depth: false,
		stencil: false,
		powerPreference: 'high-performance',
	});
	if (!gl) return null;

	const compile = (type: number, src: string) => {
		const s = gl.createShader(type)!;
		gl.shaderSource(s, src);
		gl.compileShader(s);
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
			console.warn(gl.getShaderInfoLog(s));
			return null;
		}
		return s;
	};
	const vs = compile(gl.VERTEX_SHADER, VERT);
	const fs = compile(gl.FRAGMENT_SHADER, FRAG);
	if (!vs || !fs) return null;
	const prog = gl.createProgram()!;
	gl.attachShader(prog, vs);
	gl.attachShader(prog, fs);
	gl.linkProgram(prog);
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
		console.warn(gl.getProgramInfoLog(prog));
		return null;
	}
	gl.useProgram(prog);

	const buf = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
	const aPos = gl.getAttribLocation(prog, 'aPos');
	gl.enableVertexAttribArray(aPos);
	gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

	const u = (name: string) => gl.getUniformLocation(prog, name);
	const uRes = u('uRes'), uTime = u('uTime'), uCell = u('uCell'), uGrow = u('uGrow');
	const uK = u('uK'), uTh = u('uTh'), uOff = u('uOff'), uRot = u('uRot'), uCam = u('uCam');

	const resize = () => {
		const cssW = canvas.clientWidth || window.innerWidth;
		const cssH = canvas.clientHeight || window.innerHeight;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const scale = Math.min(dpr, Math.sqrt(maxPixels / (cssW * cssH)));
		const w = Math.max(2, Math.round(cssW * scale));
		const h = Math.max(2, Math.round(cssH * scale));
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
			gl.viewport(0, 0, w, h);
		}
	};
	resize();

	const CELL = 0.13;
	const render = (time: number, grow: number) => {
		gl.uniform2f(uRes, canvas.width, canvas.height);
		gl.uniform1f(uTime, time);
		gl.uniform1f(uCell, CELL);
		gl.uniform1f(uGrow, grow);
		// The surface breathes and turns slowly around the camera, which stays in a void.
		gl.uniform1f(uK, 1.0 + 0.16 * Math.sin(time * 0.21));
		gl.uniform1f(uTh, 0.12 + 0.1 * Math.sin(time * 0.17 + 1.0));
		const q = -Math.PI / 4;
		gl.uniform3f(uOff, q + 0.12 * Math.sin(time * 0.13), q + 0.12 * Math.sin(time * 0.11 + 2.0), q);
		gl.uniformMatrix3fv(uRot, false, rotationYXZ(0.5 + time * 0.045, 0.35 + 0.2 * Math.sin(time * 0.06), time * 0.03));
		gl.uniformMatrix3fv(uCam, false, rotationYXZ(0.32 + 0.05 * Math.sin(time * 0.1), -0.22 + 0.04 * Math.sin(time * 0.083), 0.06));
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	};

	return {
		render,
		resize,
		setBudget(px: number) {
			maxPixels = px;
			resize();
		},
	};
}
