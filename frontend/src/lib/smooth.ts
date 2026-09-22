import Lenis from "lenis";

let lenis: Lenis | null = null;
let raf = 0;

function reducedMotion() {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function startSmooth() {
	if (lenis) return lenis;
	if (reducedMotion()) return null;
	lenis = new Lenis({
		duration: 1.15,
		easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
		smoothWheel: true,
	});
	const loop = (time: number) => {
		lenis?.raf(time);
		raf = requestAnimationFrame(loop);
	};
	raf = requestAnimationFrame(loop);
	return lenis;
}

export function stopSmooth() {
	cancelAnimationFrame(raf);
	lenis?.destroy();
	lenis = null;
}

export function scrollToElement(id: string) {
	const el = document.getElementById(id);
	if (!el) return;
	if (lenis) {
		lenis.scrollTo(el, { offset: -72, duration: 1.2 });
		return;
	}
	el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
}
