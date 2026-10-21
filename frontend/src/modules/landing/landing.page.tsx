import { useEffect } from "react"
import { useLocation } from "react-router-dom"
import { Header } from "./header"
import { Hero } from "./hero"
import { Product } from "./product"
import { HowItWorks } from "./how-it-works"
import { ControlRoom } from "./control-room"
import { UseCases } from "./use-cases"
import { Integrations } from "./integrations"
import { SelfHost } from "./self-host"
import { Faq } from "./faq"
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

	// The landing page is a fixed cream surface; the body background follows
	// the app theme, so it has to be pinned while this page is mounted.
	useEffect(() => {
		const root = document.documentElement
		root.classList.add("rm-landing-root")
		return () => root.classList.remove("rm-landing-root")
	}, [])

	return (
		<main className="rm-landing relative min-h-screen overflow-x-hidden bg-[var(--rm-bg)] font-sans text-[var(--rm-fg)] antialiased">
			{/* Spacer for the fixed header. */}
			<div aria-hidden="true" className="h-16" />
			<Header />
			<Hero />
			<Product />
			<HowItWorks />
			<ControlRoom />
			<UseCases />
			<Integrations />
			<SelfHost />
			<Faq />
			<PreFooter />
			<Footer />
		</main>
	)
}
