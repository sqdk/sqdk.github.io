/**
 * Canvas rendering + UI wiring for the quadcopter PID experiment.
 * The markup (sliders, buttons, canvases) is server-rendered by
 * `src/pages/experiments/quadcopter-pid.astro`; this file only attaches behaviour.
 */
import { ARM, DT, LOOPS, PRESETS, REST_Y, Sim, T_MAX, TUNED, cloneSettings } from './sim';
import type { LoopId, Settings, Term } from './sim';

const ACCENT = '#00f2ea';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const GROUND_PX = 26; // strip of ground at the bottom of the sim canvas
const HISTORY = 480; // samples in the plots
const SAMPLE_EVERY = 4; // physics steps per plot sample → 60 Hz, 8 s window
const RESPAWN_AFTER = 1.4; // s on the ground after a crash
const TRAIL = 80;
const DEG = 180 / Math.PI;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

interface Surface {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	w: number; // CSS px
	h: number;
	dpr: number;
}

function surface(canvas: HTMLCanvasElement): Surface {
	return { canvas, ctx: canvas.getContext('2d')!, w: 0, h: 0, dpr: 1 };
}

/** Match the backing store to the element's CSS size. Returns true if it changed. */
function fit(s: Surface): boolean {
	const rect = s.canvas.getBoundingClientRect();
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	const w = Math.round(rect.width);
	const h = Math.round(rect.height);
	if (w === s.w && h === s.h && dpr === s.dpr) return false;
	s.w = w;
	s.h = h;
	s.dpr = dpr;
	s.canvas.width = Math.max(1, Math.round(w * dpr));
	s.canvas.height = Math.max(1, Math.round(h * dpr));
	return true;
}

function decimals(step: number) {
	return step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
}

function init() {
	const root = document.getElementById('quad');
	const simCanvas = document.getElementById('quad-sim') as HTMLCanvasElement | null;
	const plotCanvas = document.getElementById('quad-plot') as HTMLCanvasElement | null;
	if (!root || !simCanvas || !plotCanvas) return;

	const view = surface(simCanvas);
	const plot = surface(plotCanvas);
	const settings: Settings = cloneSettings(TUNED);
	const sim = new Sim(settings);

	let ppm = 80; // px per metre
	let paused = false;
	let tapped = false; // hide the hint after the first tap
	let pulse = 1; // 0 → 1 after the target moves
	let stepCount = 0;
	const rotor = [0, 0];
	const trail: number[] = []; // x0, y0, x1, y1, …

	// ---- plot history (ring buffers)
	const hist = {
		x: new Float32Array(HISTORY),
		tx: new Float32Array(HISTORY),
		y: new Float32Array(HISTORY),
		ty: new Float32Array(HISTORY),
		th: new Float32Array(HISTORY),
		thD: new Float32Array(HISTORY),
	};
	let histHead = 0;
	let histLen = 0;

	function record() {
		hist.x[histHead] = sim.x;
		hist.tx[histHead] = sim.tx;
		hist.y[histHead] = sim.y;
		hist.ty[histHead] = sim.ty;
		hist.th[histHead] = Math.atan2(Math.sin(sim.th), Math.cos(sim.th)) * DEG;
		hist.thD[histHead] = sim.thD * DEG;
		histHead = (histHead + 1) % HISTORY;
		if (histLen < HISTORY) histLen++;
	}

	// ---- wind streaks
	const streaks = Array.from({ length: 26 }, () => ({ x: Math.random(), y: Math.random(), k: 0.6 + Math.random() * 0.8 }));

	// ---- sizing
	let sized = false;
	function resize() {
		if (fit(view) || !sized) {
			if (view.w === 0 || view.h === 0) return;
			const worldW = clamp(view.w / 90, 5, 10);
			ppm = view.w / worldW;
			const worldH = Math.max(1.5, (view.h - GROUND_PX) / ppm);
			if (!sized) {
				sim.worldW = worldW;
				sim.worldH = worldH;
				sim.reset();
				sized = true;
			} else {
				sim.setWorld(worldW, worldH);
				trail.length = 0;
			}
		}
		fit(plot);
	}

	const sx = (x: number) => x * ppm;
	const sy = (y: number) => view.h - GROUND_PX - y * ppm;

	// ---- drawing: simulation
	function drawSim() {
		const { ctx, w, h, dpr } = view;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, w, h);
		const groundY = h - GROUND_PX;

		// grid, 1 m
		ctx.lineWidth = 1;
		ctx.strokeStyle = 'rgba(255,255,255,0.07)';
		ctx.beginPath();
		for (let m = 1; m < sim.worldW; m++) {
			const x = Math.round(sx(m)) + 0.5;
			ctx.moveTo(x, 0);
			ctx.lineTo(x, groundY);
		}
		for (let m = 1; m <= sim.worldH; m++) {
			const y = Math.round(sy(m)) + 0.5;
			ctx.moveTo(0, y);
			ctx.lineTo(w, y);
		}
		ctx.stroke();
		ctx.font = `10px ${MONO}`;
		ctx.textBaseline = 'bottom';
		ctx.textAlign = 'right';
		ctx.fillStyle = 'rgba(255,255,255,0.28)';
		for (let m = 1; m <= sim.worldH; m++) ctx.fillText(`${m} m`, w - 5, sy(m) - 2);

		// ground
		ctx.fillStyle = 'rgba(255,255,255,0.05)';
		ctx.fillRect(0, groundY, w, GROUND_PX);
		ctx.strokeStyle = 'rgba(255,255,255,0.4)';
		ctx.beginPath();
		ctx.moveTo(0, groundY + 0.5);
		ctx.lineTo(w, groundY + 0.5);
		ctx.stroke();
		ctx.strokeStyle = 'rgba(255,255,255,0.12)';
		ctx.beginPath();
		for (let x = -GROUND_PX; x < w; x += 12) {
			ctx.moveTo(x, h);
			ctx.lineTo(x + GROUND_PX, groundY);
		}
		ctx.stroke();

		// wind streaks
		if (settings.wind > 0) {
			const len = clamp(Math.abs(sim.windV) * ppm * 0.09, 8, 90);
			const dir = Math.sign(sim.windV) || 1;
			const alpha = 0.1 + 0.22 * settings.wind;
			ctx.lineWidth = 1;
			for (let pass = 0; pass < 2; pass++) {
				// pass 0: long faint tail, pass 1: short brighter head
				ctx.strokeStyle = `rgba(255,255,255,${pass ? alpha : alpha * 0.4})`;
				ctx.beginPath();
				for (const s of streaks) {
					const x = s.x * (w + 140) - 70;
					const y = Math.round(s.y * (groundY - 8) + 4) + 0.5;
					ctx.moveTo(x, y);
					ctx.lineTo(x - dir * len * s.k * (pass ? 0.35 : 1), y);
				}
				ctx.stroke();
			}
		}

		// trail
		const n = trail.length / 2;
		if (n > 1) {
			ctx.lineWidth = 1.5;
			ctx.lineCap = 'round';
			for (let i = 1; i < n; i++) {
				ctx.strokeStyle = `rgba(0,242,234,${(0.4 * i) / n})`;
				ctx.beginPath();
				ctx.moveTo(sx(trail[2 * i - 2]), sy(trail[2 * i - 1]));
				ctx.lineTo(sx(trail[2 * i]), sy(trail[2 * i + 1]));
				ctx.stroke();
			}
			ctx.lineCap = 'butt';
		}

		// target crosshair
		{
			const x = sx(sim.tx);
			const y = sy(sim.ty);
			const away = Math.hypot(sim.x - sim.tx, sim.y - sim.ty);
			ctx.strokeStyle = `rgba(255,255,255,${clamp(away / 0.4, 0.3, 0.85)})`;
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.arc(x, y, 9, 0, Math.PI * 2);
			ctx.moveTo(x - 16, y);
			ctx.lineTo(x - 5, y);
			ctx.moveTo(x + 5, y);
			ctx.lineTo(x + 16, y);
			ctx.moveTo(x, y - 16);
			ctx.lineTo(x, y - 5);
			ctx.moveTo(x, y + 5);
			ctx.lineTo(x, y + 16);
			ctx.stroke();
			if (pulse < 1) {
				ctx.strokeStyle = `rgba(0,242,234,${0.8 * (1 - pulse)})`;
				ctx.beginPath();
				ctx.arc(x, y, 9 + 26 * pulse, 0, Math.PI * 2);
				ctx.stroke();
			}
		}

		drawDrone();

		// HUD
		ctx.font = `11px ${MONO}`;
		ctx.textBaseline = 'top';
		ctx.textAlign = 'left';
		ctx.fillStyle = 'rgba(255,255,255,0.62)';
		const tilt = Math.atan2(Math.sin(sim.th), Math.cos(sim.th)) * DEG;
		ctx.fillText(`x ${sim.x.toFixed(2)} m   y ${sim.y.toFixed(2)} m   tilt ${tilt.toFixed(1)}°`, 9, 9);
		if (settings.wind > 0) {
			ctx.fillStyle = 'rgba(255,255,255,0.45)';
			ctx.fillText(`wind ${sim.windV.toFixed(1)} m/s →`, 9, 25);
		}

		ctx.textAlign = 'center';
		if (sim.crashed) {
			ctx.font = `700 15px ${MONO}`;
			ctx.fillStyle = '#ff6b6b';
			ctx.fillText('CRASHED', w / 2, h * 0.36);
			ctx.font = `11px ${MONO}`;
			ctx.fillStyle = 'rgba(255,255,255,0.5)';
			ctx.fillText('respawning…', w / 2, h * 0.36 + 21);
		} else if (paused) {
			ctx.font = `700 13px ${MONO}`;
			ctx.fillStyle = 'rgba(255,255,255,0.7)';
			ctx.fillText('PAUSED', w / 2, h * 0.36);
		} else if (!tapped) {
			ctx.font = `11px ${MONO}`;
			ctx.fillStyle = `rgba(255,255,255,${0.4 + 0.25 * Math.sin(sim.t * 3)})`;
			ctx.fillText('tap anywhere to move the target', w / 2, 34);
		}
	}

	function drawDrone() {
		const { ctx } = view;
		const u = ppm;
		const crashed = sim.crashed;
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, view.w, view.h - GROUND_PX);
		ctx.clip();
		ctx.translate(sx(sim.x), sy(sim.y));

		// desired tilt from the position loop, as a faint dashed guide
		if (!crashed && !sim.onGround) {
			ctx.save();
			ctx.rotate(-sim.thD);
			ctx.setLineDash([3, 4]);
			ctx.strokeStyle = 'rgba(255,255,255,0.3)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(-ARM * 1.9 * u, 0);
			ctx.lineTo(ARM * 1.9 * u, 0);
			ctx.stroke();
			ctx.restore();
		}

		ctx.rotate(-sim.th);

		// exhaust: one tapered streak per motor, length ∝ thrust
		for (let side = -1; side <= 1; side += 2) {
			const f = clamp((side < 0 ? sim.tl : sim.tr) / T_MAX, 0, 1);
			if (f < 0.01) continue;
			const mx = side * ARM * u;
			const top = 0.02 * u;
			const len = (0.12 + 0.95 * f) * u * (0.92 + 0.08 * Math.sin(sim.t * 90 + side));
			const g = ctx.createLinearGradient(0, top, 0, top + len);
			g.addColorStop(0, `rgba(0,242,234,${0.35 + 0.5 * f})`);
			g.addColorStop(1, 'rgba(0,242,234,0)');
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.moveTo(mx - 0.085 * u, top);
			ctx.lineTo(mx + 0.085 * u, top);
			ctx.lineTo(mx + 0.02 * u, top + len);
			ctx.lineTo(mx - 0.02 * u, top + len);
			ctx.closePath();
			ctx.fill();
		}

		const body = crashed ? '#ff6b6b' : '#eef3f4';
		const dim = crashed ? '#b84c4c' : '#9aa6aa';

		// legs
		ctx.strokeStyle = dim;
		ctx.lineWidth = Math.max(1.5, 0.018 * u);
		ctx.lineCap = 'round';
		ctx.beginPath();
		ctx.moveTo(-0.06 * u, 0.02 * u);
		ctx.lineTo(-0.11 * u, REST_Y * u - 1);
		ctx.moveTo(0.06 * u, 0.02 * u);
		ctx.lineTo(0.11 * u, REST_Y * u - 1);
		ctx.moveTo(-0.15 * u, REST_Y * u - 1);
		ctx.lineTo(-0.07 * u, REST_Y * u - 1);
		ctx.moveTo(0.07 * u, REST_Y * u - 1);
		ctx.lineTo(0.15 * u, REST_Y * u - 1);
		ctx.stroke();

		// arm
		ctx.strokeStyle = body;
		ctx.lineWidth = Math.max(2, 0.032 * u);
		ctx.beginPath();
		ctx.moveTo(-ARM * u, 0);
		ctx.lineTo(ARM * u, 0);
		ctx.stroke();
		ctx.lineCap = 'butt';

		// body
		ctx.fillStyle = body;
		ctx.beginPath();
		if (ctx.roundRect) ctx.roundRect(-0.085 * u, -0.055 * u, 0.17 * u, 0.1 * u, 0.025 * u);
		else ctx.rect(-0.085 * u, -0.055 * u, 0.17 * u, 0.1 * u);
		ctx.fill();
		ctx.fillStyle = crashed ? '#000' : ACCENT;
		ctx.beginPath();
		ctx.arc(0, -0.005 * u, Math.max(1.5, 0.018 * u), 0, Math.PI * 2);
		ctx.fill();

		// motors + rotors
		for (let side = -1; side <= 1; side += 2) {
			const mx = side * ARM * u;
			ctx.fillStyle = dim;
			ctx.fillRect(mx - 0.028 * u, -0.07 * u, 0.056 * u, 0.075 * u);
			const r = 0.17 * u;
			const y = -0.085 * u;
			ctx.lineCap = 'round';
			ctx.strokeStyle = 'rgba(255,255,255,0.22)';
			ctx.lineWidth = Math.max(1.5, 0.02 * u);
			ctx.beginPath();
			ctx.moveTo(mx - r, y);
			ctx.lineTo(mx + r, y);
			ctx.stroke();
			const blade = r * Math.abs(Math.cos(rotor[side < 0 ? 0 : 1]));
			ctx.strokeStyle = body;
			ctx.beginPath();
			ctx.moveTo(mx - blade, y);
			ctx.lineTo(mx + blade, y);
			ctx.stroke();
			ctx.lineCap = 'butt';
		}

		ctx.restore();
	}

	// ---- drawing: plots
	const strips = [
		{ label: 'x', unit: 'm', a: hist.x, b: hist.tx, range: () => [0, sim.worldW] as const, digits: 2 },
		{ label: 'y', unit: 'm', a: hist.y, b: hist.ty, range: () => [0, sim.worldH] as const, digits: 2 },
		{ label: 'tilt', unit: '°', a: hist.th, b: hist.thD, range: () => [-45, 45] as const, digits: 1 },
	];

	function drawPlot() {
		const { ctx, w, h, dpr } = plot;
		if (w === 0 || h === 0) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);
		const gap = 8;
		const sh = (h - gap * (strips.length - 1)) / strips.length;
		ctx.font = `10px ${MONO}`;
		ctx.textBaseline = 'top';

		strips.forEach((s, k) => {
			const top = k * (sh + gap);
			const [lo, hi] = s.range();
			const band = 17; // room for the label and readout above the traces
			const py = (v: number) => top + sh - 3 - ((clamp(v, lo, hi) - lo) / (hi - lo)) * (sh - band - 5);

			ctx.fillStyle = 'rgba(255,255,255,0.035)';
			ctx.fillRect(0, top, w, sh);
			if (lo < 0) {
				ctx.strokeStyle = 'rgba(255,255,255,0.1)';
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(0, Math.round(py(0)) + 0.5);
				ctx.lineTo(w, Math.round(py(0)) + 0.5);
				ctx.stroke();
			}

			if (histLen > 1) {
				const start = (histHead - histLen + HISTORY) % HISTORY;
				const dx = w / (HISTORY - 1);
				const x0 = w - (histLen - 1) * dx;
				const line = (arr: Float32Array) => {
					ctx.beginPath();
					for (let i = 0; i < histLen; i++) {
						const v = arr[(start + i) % HISTORY];
						if (i === 0) ctx.moveTo(x0, py(v));
						else ctx.lineTo(x0 + i * dx, py(v));
					}
					ctx.stroke();
				};
				ctx.lineJoin = 'round';
				ctx.setLineDash([4, 4]);
				ctx.strokeStyle = 'rgba(255,255,255,0.4)';
				ctx.lineWidth = 1;
				line(s.b);
				ctx.setLineDash([]);
				ctx.strokeStyle = ACCENT;
				ctx.lineWidth = 1.5;
				line(s.a);
			}

			const last = (histHead - 1 + HISTORY) % HISTORY;
			ctx.textAlign = 'left';
			ctx.fillStyle = 'rgba(255,255,255,0.55)';
			ctx.fillText(s.label, 7, top + 5);
			if (histLen > 0) {
				ctx.textAlign = 'right';
				ctx.fillStyle = 'rgba(255,255,255,0.4)';
				const target = `→ ${s.b[last].toFixed(s.digits)}`;
				ctx.fillText(target, w - 7, top + 5);
				ctx.fillStyle = ACCENT;
				ctx.fillText(`${s.a[last].toFixed(s.digits)} ${s.unit}  `, w - 7 - ctx.measureText(target).width, top + 5);
			}
		});
	}

	// ---- controls
	const sliders = new Map<string, { input: HTMLInputElement; out: HTMLElement | null; digits: number }>();
	root.querySelectorAll<HTMLInputElement>('input[data-loop]').forEach((input) => {
		const loop = input.dataset.loop as LoopId;
		const term = input.dataset.term as Term;
		const key = `${loop}.${term}`;
		const out = root.querySelector<HTMLElement>(`[data-out="${key}"]`);
		const digits = decimals(Number(input.step));
		sliders.set(key, { input, out, digits });
		input.addEventListener('input', () => {
			settings[loop][term] = Number(input.value);
			if (out) out.textContent = Number(input.value).toFixed(digits);
			markPreset(null);
		});
	});

	const dists = new Map<'wind' | 'noise', { input: HTMLInputElement; out: HTMLElement | null }>();
	root.querySelectorAll<HTMLInputElement>('input[data-dist]').forEach((input) => {
		const key = input.dataset.dist as 'wind' | 'noise';
		const out = root.querySelector<HTMLElement>(`[data-out="${key}"]`);
		dists.set(key, { input, out });
		input.addEventListener('input', () => {
			settings[key] = Number(input.value);
			if (out) out.textContent = `${Math.round(Number(input.value) * 100)}%`;
			markPreset(null);
		});
	});

	function syncControls() {
		for (const [key, s] of sliders) {
			const [loop, term] = key.split('.') as [LoopId, Term];
			s.input.value = String(settings[loop][term]);
			if (s.out) s.out.textContent = settings[loop][term].toFixed(s.digits);
		}
		for (const [key, d] of dists) {
			d.input.value = String(settings[key]);
			if (d.out) d.out.textContent = `${Math.round(settings[key] * 100)}%`;
		}
	}

	const presetButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-preset]'));
	function markPreset(id: string | null) {
		for (const b of presetButtons) b.setAttribute('aria-pressed', String(b.dataset.preset === id));
	}
	for (const b of presetButtons) {
		b.addEventListener('click', () => {
			const preset = PRESETS.find((p) => p.id === b.dataset.preset);
			if (!preset) return;
			sim.apply(preset.settings);
			syncControls();
			markPreset(preset.id);
			// send the drone on a fresh hop so the preset's character shows straight away
			if (!sim.crashed) moveTarget(sim.tx < sim.worldW / 2 ? sim.worldW * 0.72 : sim.worldW * 0.28, sim.ty);
		});
	}

	function moveTarget(x: number, y: number) {
		sim.setTarget(x, y);
		pulse = 0;
	}

	function reset() {
		sim.reset();
		trail.length = 0;
		pulse = 0;
	}

	const pauseButton = root.querySelector<HTMLButtonElement>('button[data-action="pause"]');
	function setPaused(p: boolean) {
		paused = p;
		if (pauseButton) {
			pauseButton.textContent = p ? 'Resume' : 'Pause';
			pauseButton.setAttribute('aria-pressed', String(p));
		}
	}
	root.querySelector('button[data-action="gust"]')?.addEventListener('click', () => {
		if (paused) setPaused(false);
		sim.kick();
	});
	root.querySelector('button[data-action="reset"]')?.addEventListener('click', reset);
	pauseButton?.addEventListener('click', () => setPaused(!paused));

	// ---- pointer: a tap (not a scroll or drag) moves the target
	let down: { id: number; x: number; y: number; t: number } | null = null;
	simCanvas.addEventListener('pointerdown', (e) => {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
	});
	simCanvas.addEventListener('pointerup', (e) => {
		if (!down || e.pointerId !== down.id) return;
		const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
		const held = performance.now() - down.t;
		down = null;
		if (moved > 10 || held > 700) return;
		const rect = simCanvas.getBoundingClientRect();
		const x = (e.clientX - rect.left) / ppm;
		const y = (rect.height - GROUND_PX - (e.clientY - rect.top)) / ppm;
		tapped = true;
		moveTarget(x, y);
	});
	simCanvas.addEventListener('pointercancel', () => (down = null));

	// ---- keyboard, only while the sim has focus so the page still scrolls normally
	simCanvas.addEventListener('keydown', (e) => {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const step = e.shiftKey ? 1 : 0.5;
		switch (e.key) {
			case 'ArrowLeft':
				moveTarget(sim.tx - step, sim.ty);
				break;
			case 'ArrowRight':
				moveTarget(sim.tx + step, sim.ty);
				break;
			case 'ArrowUp':
				moveTarget(sim.tx, sim.ty + step);
				break;
			case 'ArrowDown':
				moveTarget(sim.tx, sim.ty - step);
				break;
			case ' ':
				sim.kick();
				break;
			case 'r':
			case 'R':
				reset();
				break;
			default:
				return;
		}
		tapped = true;
		e.preventDefault();
	});

	// ---- live P / I / D bars
	const bars: { el: HTMLElement; loop: LoopId; part: 'p' | 'i' | 'd'; scale: number; shown: number }[] = [];
	root.querySelectorAll<HTMLElement>('[data-bar]').forEach((el) => {
		const [loop, part] = el.dataset.bar!.split('.') as [LoopId, 'p' | 'i' | 'd'];
		const spec = LOOPS.find((l) => l.id === loop);
		if (spec) bars.push({ el, loop, part, scale: spec.barScale, shown: NaN });
	});
	function updateBars() {
		for (const b of bars) {
			const v = sim.crashed ? 0 : clamp(sim.pid[b.loop][b.part] / b.scale, -1, 1);
			if (Math.abs(v - b.shown) < 0.004) continue;
			b.shown = v;
			b.el.style.transform = `scaleX(${v.toFixed(3)})`;
		}
	}

	// ---- main loop
	let raf = 0;
	let last = 0;
	let acc = 0;
	let visible = true;

	function frame(now: number) {
		raf = requestAnimationFrame(frame);
		const dt = Math.min((now - last) / 1000, 0.05);
		last = now;
		if (!sized) return;

		if (!paused) {
			acc += dt;
			while (acc >= DT) {
				sim.step(DT);
				acc -= DT;
				if (++stepCount % SAMPLE_EVERY === 0) record();
			}
			if (sim.crashed && sim.crashAge > RESPAWN_AFTER) reset();

			rotor[0] += dt * (6 + 70 * (sim.tl / T_MAX));
			rotor[1] += dt * (6 + 70 * (sim.tr / T_MAX));
			if (pulse < 1) pulse = Math.min(1, pulse + dt * 2.2);

			const n = trail.length;
			if (n === 0 || Math.hypot(sim.x - trail[n - 2], sim.y - trail[n - 1]) > 0.03) {
				trail.push(sim.x, sim.y);
				if (trail.length > TRAIL * 2) trail.splice(0, 2);
			} else if (n > 2 && stepCount % 8 < 4) {
				trail.splice(0, 2); // fade out when hovering
			}

			if (settings.wind > 0) {
				const shift = (sim.windV * ppm * dt) / (view.w + 140);
				for (const s of streaks) {
					s.x += shift * s.k;
					if (s.x > 1) {
						s.x -= 1;
						s.y = Math.random();
					} else if (s.x < 0) {
						s.x += 1;
						s.y = Math.random();
					}
				}
			}
		}

		drawSim();
		drawPlot();
		updateBars();
	}

	function start() {
		if (raf || !visible || document.hidden) return;
		last = performance.now();
		raf = requestAnimationFrame(frame);
	}
	function stop() {
		cancelAnimationFrame(raf);
		raf = 0;
	}

	document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
	new IntersectionObserver((entries) => {
		visible = entries[entries.length - 1].isIntersecting;
		if (visible) start();
		else stop();
	}).observe(root);
	new ResizeObserver(resize).observe(simCanvas);
	new ResizeObserver(resize).observe(plotCanvas);

	syncControls();
	markPreset('tuned');
	resize();
	start();
}

init();
