import { useEffect } from "react"
import { useLocation } from "react-router-dom"
import { Header } from "./header"
import { Hero } from "./hero"
import { Primitives } from "./primitives"
import { Observability } from "./observability"
import { Gallery } from "./gallery"
import { Technical } from "./technical"
import { PreFooter } from "./pre-footer"
import { Footer } from "./footer"
import { scrollToSection } from "./scroll-to-section"

export function LinearLanding() {
	const { hash } = useLocation()

	useEffect(() => {
		if (!hash) return
		const id = hash.slice(1)
		requestAnimationFrame(() => scrollToSection(id))
	}, [hash])

	return (
		<main className="rm-surface relative min-h-screen overflow-x-hidden bg-[var(--rm-bg)] font-sans text-[var(--rm-fg)] antialiased">
			<Header />
			<Hero />
			<Primitives />
			<Observability />
			<Gallery />
			<Technical />
			<PreFooter />
			<Footer />
		</main>
	)
}
