import { useEffect } from "react"
import { useLocation } from "react-router-dom"
import { Header } from "./header"
import { Hero } from "./hero"
import { SyncSection } from "./sync-section"
import { DevignoreSection } from "./devignore-section"
import { EncryptSection } from "./encrypt-section"
import { CliSection } from "./cli-section"
import { RoadmapSection } from "./roadmap-section"
import { PreFooter } from "./pre-footer"
import { Footer } from "./footer"
import { scrollToSection } from "./scroll-to-section"

export function WorkspaceLanding() {
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
			<SyncSection />
			<DevignoreSection />
			<EncryptSection />
			<CliSection />
			<RoadmapSection />
			<PreFooter />
			<Footer />
		</main>
	)
}
