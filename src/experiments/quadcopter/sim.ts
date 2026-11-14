/**
 * Planar quadcopter + three cascaded PID loops. Pure simulation: no DOM, so it
 * can be run headless (`node --experimental-strip-types`).
 *
 * Conventions: x right, y up, metres / seconds / radians. Tilt θ is
 * counter-clockwise positive, so the thrust direction is (-sin θ, cos θ) and a
 * positive tilt accelerates the drone to the left.
 */

export const G = 9.81;
export const MASS = 1; // kg
export const ARM = 0.25; // m, centre to motor
export const INERTIA = 0.02; // kg·m²
export const T_MAX = 12; // N per motor
export const MOTOR_TAU = 0.04; // s, first-order motor lag
export const MAX_TILT = (35 * Math.PI) / 180;
export const DT = 1 / 240; // fixed physics + control step
export const REST_Y = 0.12; // height of the body centre when standing on its legs

const WIND_MEAN = 6; // m/s of steady wind at wind = 1
const WIND_GUST = 2.5; // m/s std-dev of gusts at wind = 1
const WIND_GUST_TAU = 0.8; // s, gust correlation time
const DRAG_X = 0.35; // N per m/s of relative air speed
const DRAG_Y = 0.3;
const DRAG_ROT = 0.5; // 1/s
const WIND_TORQUE = -0.01; // N·m per m/s: the wind also tips the drone downwind
const NOISE_POS = 0.02; // m std-dev at noise = 1
const NOISE_ANGLE = (2.5 * Math.PI) / 180; // rad std-dev at noise = 1
const TURBULENCE = 0.5; // rad/s² of ever-present white-noise torque, so nothing balances on a knife edge
const CRASH_SPEED = 4.5; // m/s downward at touchdown
const CRASH_TILT = 1.0; // rad at touchdown

export type LoopId = 'pos' | 'alt' | 'att';
export type Term = 'kp' | 'ki' | 'kd';

export interface Gains {
	kp: number;
	ki: number;
	kd: number;
}

export interface Settings {
	pos: Gains;
	alt: Gains;
	att: Gains;
	/** 0..1 */
	wind: number;
	/** 0..1 */
	noise: number;
}

export interface LoopSpec {
	id: LoopId;
	name: string;
	/** what goes in → what comes out */
	flow: string;
	/** full-scale value for the live term bars, in output units */
	barScale: number;
	ranges: Record<Term, { max: number; step: number }>;
}

export const LOOPS: LoopSpec[] = [
	{
		id: 'pos',
		name: 'Position',
		flow: 'x error → tilt',
		barScale: 6,
		ranges: { kp: { max: 8, step: 0.1 }, ki: { max: 2, step: 0.05 }, kd: { max: 8, step: 0.1 } },
	},
	{
		id: 'alt',
		name: 'Altitude',
		flow: 'y error → thrust',
		barScale: 10,
		ranges: { kp: { max: 20, step: 0.5 }, ki: { max: 6, step: 0.1 }, kd: { max: 10, step: 0.1 } },
	},
	{
		id: 'att',
		name: 'Attitude',
		flow: 'tilt error → torque',
		barScale: 60,
		ranges: { kp: { max: 300, step: 5 }, ki: { max: 100, step: 5 }, kd: { max: 40, step: 0.5 } },
	},
];

export const TUNED: Settings = {
	pos: { kp: 4, ki: 1.2, kd: 3.6 },
	alt: { kp: 8, ki: 2, kd: 5 },
	att: { kp: 120, ki: 0, kd: 18 },
	wind: 0,
	noise: 0,
};

export interface Preset {
	id: string;
	label: string;
	settings: Settings;
}

export const PRESETS: Preset[] = [
	{ id: 'tuned', label: 'Tuned', settings: TUNED },
	{
		id: 'p-only',
		label: 'P only',
		settings: {
			pos: { kp: 4, ki: 0, kd: 0 },
			alt: { kp: 8, ki: 0, kd: 0 },
			att: { kp: 120, ki: 0, kd: 0 },
			wind: 0,
			noise: 0,
		},
	},
	{
		id: 'no-integral',
		label: 'No integral + wind',
		settings: {
			pos: { kp: 4, ki: 0, kd: 3.6 },
			alt: { kp: 8, ki: 0, kd: 5 },
			att: { kp: 120, ki: 0, kd: 18 },
			wind: 0.8,
			noise: 0,
		},
	},
	{
		id: 'underdamped',
		label: 'Underdamped',
		settings: {
			pos: { kp: 4, ki: 1.2, kd: 0.8 },
			alt: { kp: 8, ki: 2, kd: 0.6 },
			att: { kp: 120, ki: 0, kd: 8 },
			wind: 0,
			noise: 0,
		},
	},
	{
		id: 'sluggish',
		label: 'Sluggish',
		settings: {
			pos: { kp: 0.5, ki: 0.05, kd: 2.0 },
			alt: { kp: 1.5, ki: 0.3, kd: 3.5 },
			att: { kp: 40, ki: 0, kd: 14 },
			wind: 0,
			noise: 0,
		},
	},
	{
		id: 'noisy',
		label: 'Noisy sensors',
		settings: {
			pos: { kp: 4, ki: 1.2, kd: 3.6 },
			alt: { kp: 8, ki: 2, kd: 5 },
			att: { kp: 120, ki: 0, kd: 36 },
			wind: 0,
			noise: 1,
		},
	},
];

export function cloneSettings(s: Settings): Settings {
	return { pos: { ...s.pos }, alt: { ...s.alt }, att: { ...s.att }, wind: s.wind, noise: s.noise };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * PID with the usual practical touches:
 *  - derivative taken on the measurement (no kick when the target jumps), low-pass filtered
 *  - anti-windup: the integral is clamped, and (for the outer loops) only accumulates
 *    when reasonably close to the setpoint, nearly at rest, and not right after the
 *    setpoint moved. It is there to cancel steady disturbances, not to wind up in transit.
 */
export class Pid {
	gains: Gains;
	/** live contribution of each term, in output units */
	p = 0;
	i = 0;
	d = 0;
	private integral = 0;
	private rate = 0;
	private slowRate = 0;
	private prev = NaN;
	private prevSetpoint = NaN;
	private hold = 0;
	private readonly iLimit: number;
	private readonly iZone: number;
	private readonly iRate: number;
	private readonly iHold: number;
	private readonly dTau: number;

	constructor(gains: Gains, opts: { iLimit: number; iZone: number; iRate: number; iHold: number; dTau: number }) {
		this.gains = gains;
		this.iLimit = opts.iLimit;
		this.iZone = opts.iZone;
		this.iRate = opts.iRate;
		this.iHold = opts.iHold;
		this.dTau = opts.dTau;
	}

	reset() {
		this.integral = 0;
		this.rate = 0;
		this.slowRate = 0;
		this.prev = NaN;
		this.prevSetpoint = NaN;
		this.hold = 0;
		this.p = this.i = this.d = 0;
	}

	step(error: number, measurement: number, dt: number): number {
		const g = this.gains;
		const raw = Number.isNaN(this.prev) ? 0 : (measurement - this.prev) / dt;
		this.prev = measurement;
		this.rate += (raw - this.rate) * (dt / (this.dTau + dt));
		this.slowRate += (raw - this.slowRate) * (dt / (0.25 + dt));

		const setpoint = error + measurement;
		if (Math.abs(setpoint - this.prevSetpoint) > 1e-3) this.hold = this.iHold;
		else if (this.hold > 0) this.hold -= dt;
		this.prevSetpoint = setpoint;

		if (g.ki > 0) {
			if (this.hold <= 0 && Math.abs(error) < this.iZone && Math.abs(this.slowRate) < this.iRate) {
				this.integral += error * dt;
			}
			const lim = this.iLimit / g.ki;
			this.integral = clamp(this.integral, -lim, lim);
		} else {
			this.integral = 0;
		}

		this.p = g.kp * error;
		this.i = g.ki * this.integral;
		this.d = -g.kd * this.rate;
		return this.p + this.i + this.d;
	}
}

export class Sim {
	settings: Settings;

	// state
	x = 0;
	y = REST_Y;
	th = 0;
	vx = 0;
	vy = 0;
	om = 0;
	/** actual motor thrusts (left, right), N */
	tl = 0;
	tr = 0;
	/** commanded motor thrusts, N */
	cl = 0;
	cr = 0;

	// setpoints
	tx = 0;
	ty = 2;
	/** desired tilt produced by the position loop */
	thD = 0;

	/** current wind speed incl. gusts, m/s (positive blows to the right) */
	windV = 0;
	private gust = 0;

	crashed = false;
	/** seconds since the crash */
	crashAge = 0;
	onGround = true;
	t = 0;

	worldW: number;
	worldH: number;

	readonly pid: Record<LoopId, Pid>;
	private readonly rand: () => number;

	constructor(settings: Settings, worldW = 8, worldH = 5, rand: () => number = Math.random) {
		this.settings = settings;
		this.worldW = worldW;
		this.worldH = worldH;
		this.rand = rand;
		this.pid = {
			pos: new Pid(settings.pos, { iLimit: 3, iZone: 1.2, iRate: 0.2, iHold: 0.6, dTau: 0.06 }),
			alt: new Pid(settings.alt, { iLimit: 4, iZone: 1.2, iRate: 0.2, iHold: 0.6, dTau: 0.06 }),
			att: new Pid(settings.att, { iLimit: 25, iZone: 0.5, iRate: Infinity, iHold: 0, dTau: 0.012 }),
		};
		this.reset();
	}

	/** Replace all gains / disturbances (keeps the object identity the PIDs point at). */
	apply(s: Settings) {
		Object.assign(this.settings.pos, s.pos);
		Object.assign(this.settings.alt, s.alt);
		Object.assign(this.settings.att, s.att);
		this.settings.wind = s.wind;
		this.settings.noise = s.noise;
	}

	setWorld(w: number, h: number) {
		this.worldW = w;
		this.worldH = h;
		this.x = clamp(this.x, 0.4, w - 0.4);
		this.setTarget(this.tx, this.ty);
	}

	setTarget(x: number, y: number) {
		this.tx = clamp(x, 0.5, this.worldW - 0.5);
		this.ty = clamp(y, REST_Y, Math.max(REST_Y, this.worldH - 0.4));
	}

	/** Back on the ground in the middle, target ~2 m up. */
	reset() {
		this.x = this.worldW / 2;
		this.y = REST_Y;
		this.th = this.vx = this.vy = this.om = 0;
		this.tl = this.tr = this.cl = this.cr = 0;
		this.thD = 0;
		this.gust = 0;
		this.crashed = false;
		this.crashAge = 0;
		this.onGround = true;
		this.pid.pos.reset();
		this.pid.alt.reset();
		this.pid.att.reset();
		this.setTarget(this.worldW / 2, Math.min(2, this.worldH * 0.6));
	}

	/** A sudden shove: sideways velocity plus a spin, from a random side. */
	kick(dir = this.rand() < 0.5 ? -1 : 1) {
		this.vx += dir * 2.5;
		this.vy += 0.4;
		this.om += -dir * 7;
	}

	private randn(): number {
		const u = Math.max(this.rand(), 1e-12);
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rand());
	}

	step(dt = DT) {
		const s = this.settings;
		this.t += dt;

		// --- wind: steady component + Ornstein-Uhlenbeck gusts
		if (s.wind > 0) {
			const sigma = s.wind * WIND_GUST;
			this.gust += (-this.gust / WIND_GUST_TAU) * dt + sigma * Math.sqrt((2 * dt) / WIND_GUST_TAU) * this.randn();
			this.windV = s.wind * WIND_MEAN + this.gust;
		} else {
			this.gust = 0;
			this.windV = 0;
		}

		// --- control
		if (this.crashed) {
			this.crashAge += dt;
			this.cl = this.cr = 0;
		} else {
			const n = s.noise;
			const xm = this.x + (n > 0 ? n * NOISE_POS * this.randn() : 0);
			const ym = this.y + (n > 0 ? n * NOISE_POS * this.randn() : 0);
			const thm = this.th + (n > 0 ? n * NOISE_ANGLE * this.randn() : 0);

			// 1. position → desired horizontal acceleration → desired tilt
			const axMax = G * Math.tan(MAX_TILT);
			const ux = clamp(this.pid.pos.step(this.tx - xm, xm, dt), -axMax, axMax);
			this.thD = clamp(-Math.atan2(ux, G), -MAX_TILT, MAX_TILT);

			// 2. altitude → vertical acceleration → total thrust (compensated for tilt)
			const uy = clamp(this.pid.alt.step(this.ty - ym, ym, dt), -0.8 * G, 1.2 * G);
			const c = Math.cos(thm);
			let total = c > 0.2 ? (MASS * (G + uy)) / Math.max(c, 0.5) : 0.3 * MASS * G;

			// 3. attitude → angular acceleration → thrust difference between the motors
			const ua = this.pid.att.step(wrapAngle(this.thD - thm), thm, dt);
			let diff = (INERTIA * ua) / ARM; // right minus left

			// mix, giving attitude priority when the motors saturate
			diff = clamp(diff, -T_MAX, T_MAX);
			total = clamp(total, Math.abs(diff), 2 * T_MAX - Math.abs(diff));
			this.cr = (total + diff) / 2;
			this.cl = (total - diff) / 2;
		}

		// --- motors lag behind their command
		const k = 1 - Math.exp(-dt / MOTOR_TAU);
		this.tl += (this.cl - this.tl) * k;
		this.tr += (this.cr - this.tr) * k;

		// --- rigid body
		const thrust = this.tl + this.tr;
		const rel = this.windV - this.vx;
		const ax = (-thrust * Math.sin(this.th) + DRAG_X * rel) / MASS;
		const ay = (thrust * Math.cos(this.th) - DRAG_Y * this.vy) / MASS - G;
		const al =
			((this.tr - this.tl) * ARM + WIND_TORQUE * rel) / INERTIA - DRAG_ROT * this.om + (this.onGround ? 0 : TURBULENCE * this.randn());

		this.vx += ax * dt;
		this.vy += ay * dt;
		this.om += al * dt;
		this.x += this.vx * dt;
		this.y += this.vy * dt;
		this.th += this.om * dt;

		// --- ground
		if (this.y <= REST_Y) {
			if (!this.crashed && !this.onGround && (this.vy < -CRASH_SPEED || Math.abs(wrapAngle(this.th)) > CRASH_TILT)) {
				this.crashed = true;
				this.crashAge = 0;
			}
			this.onGround = true;
			this.y = REST_Y;
			if (this.vy < 0) this.vy = 0;
			this.vx *= Math.max(0, 1 - 8 * dt);
			this.om *= Math.max(0, 1 - 20 * dt);
			if (!this.crashed) this.th -= wrapAngle(this.th) * Math.min(1, 12 * dt); // legs level it out
		} else if (this.y > REST_Y + 0.02) {
			this.onGround = false;
		}

		// --- side walls and a ceiling well above the view
		if (this.x < 0.3) {
			this.x = 0.3;
			if (this.vx < 0) this.vx *= -0.3;
		} else if (this.x > this.worldW - 0.3) {
			this.x = this.worldW - 0.3;
			if (this.vx > 0) this.vx *= -0.3;
		}
		const top = this.worldH + 4;
		if (this.y > top) {
			this.y = top;
			if (this.vy > 0) this.vy = 0;
		}
	}
}
