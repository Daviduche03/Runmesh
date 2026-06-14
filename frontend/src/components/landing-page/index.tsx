import { useEffect } from "react"
import { useLocation } from "react-router-dom"
import { Header } from "./header"
import { Hero } from "./hero"
import { CustomerSection } from "./customer-section"
import { BentoSpecies } from "./bento-species"
import { ProductShowcase } from "./product-showcase"
import { Foundation } from "./foundation"
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
		<main className="relative min-h-screen overflow-x-hidden bg-[#08090a] font-[var(--font-regular)] text-white">
			<div
				aria-hidden
				className="pointer-events-none absolute left-0 top-0 z-0 h-[520px] w-[720px] bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.03)_40%,transparent_72%)]"
			/>
			<Header />
			<Hero />
			<CustomerSection />
			<BentoSpecies />
			<ProductShowcase />
			<Foundation />
			<PreFooter />
			<Footer />
		</main>
	)
}
