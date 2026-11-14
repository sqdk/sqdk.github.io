/**
 * Registry of experiments. To add one: create `src/pages/experiments/<slug>.astro`
 * and add an entry here (newest first). The index page lists them in this order.
 */
export interface Experiment {
	slug: string;
	title: string;
	summary: string;
}

export const experiments: Experiment[] = [
	{
		slug: 'quadcopter-pid',
		title: 'Stabilizing a quadcopter with PID',
		summary: 'Three cascaded PID loops keeping a drone in the air. Tune the gains, add wind, watch it wobble.',
	},
];
