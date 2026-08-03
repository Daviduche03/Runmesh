import { useEffect } from "react"
import { useLocation } from "react-router-dom"
import { Header } from "./header"
import { Hero } from "./hero"
import { SyncSection } from "./sync-section"
import { FusefsSection } from "./fusefs-section"
import { DevignoreSection } from "./devignore-section"
import { EncryptSection } from "./encrypt-section"
import { CliSection } from "./cli-section"
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
		<main className="relative min-h-screen overflow-x-hidden bg-[#08090a] font-[var(--font-regular)] text-white">
			<div
				aria-hidden
				className="pointer-events-none absolute left-0 top-0 z-0 h-[520px] w-[720px] bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.03)_40%,transparent_72%)]"
			/>
			<Header />
			<Hero />
			<SyncSection />
			<FusefsSection />
			<DevignoreSection />
			<EncryptSection />
			<CliSection />
			<PreFooter />
			<Footer />
		</main>
	)
}
