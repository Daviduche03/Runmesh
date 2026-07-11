export function scrollToSection(id: string) {
	const el = document.getElementById(id)
	if (!el) return
	const y = el.getBoundingClientRect().top + window.scrollY - 80
	window.scrollTo({ top: y, behavior: "smooth" })
}
