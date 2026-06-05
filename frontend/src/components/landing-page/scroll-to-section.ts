export function scrollToSection(id: string) {
	const target = document.getElementById(id)
	if (!target) return
	const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
	target.scrollIntoView({ behavior, block: "start" })
}
