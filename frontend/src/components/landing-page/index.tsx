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
		<main className="min-h-screen overflow-x-hidden bg-[#08090a] font-[var(--font-regular)] text-white">
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
