import {
	CurrencyDollar,
	Fingerprint,
	RocketLaunch,
	Scales,
	Siren,
	UsersThree,
} from "@phosphor-icons/react"
import { container } from "./constants"

const useCases = [
	{
		Icon: Siren,
		title: "Page the agent first",
		copy: "The on-call agent restarts the service, rolls back the deploy, and wakes you with the receipt. It can touch production, and nothing else.",
	},
	{
		Icon: CurrencyDollar,
		title: "Let agents spend, with a ceiling",
		copy: "A procurement agent buys capacity up to your limit. Above it, the purchase waits for a human. The agent never holds the card.",
	},
	{
		Icon: UsersThree,
		title: "Serve every tenant through one agent",
		copy: "Your agent acts inside each customer account on that customer's behalf, through their consent. One codebase, no shared secrets.",
	},
	{
		Icon: RocketLaunch,
		title: "Ship at 3am, with a witness",
		copy: "The release agent merges, deploys, and rolls back on signal. Policy decides what ships alone and what waits for morning.",
	},
	{
		Icon: Fingerprint,
		title: "Touch customer data without holding it",
		copy: "Support and ops agents read live records through scoped grants that expire. There is nothing to leak because nothing is stored.",
	},
	{
		Icon: Scales,
		title: "Answer the auditor in one query",
		copy: "Every action carries its principal, its grant, and its result. An audit stops being archaeology and starts being a filter.",
	},
]

export function UseCases() {
	return (
		<section id="use-cases" className="scroll-mt-16 border-t border-[var(--rm-line)] py-20 lg:py-28">
			<div className={container}>
				<div className="max-w-[720px]">
					<h2 className="text-balance font-display-sans text-[clamp(30px,4.2vw,52px)] font-medium leading-[1.06] tracking-[-0.03em] text-[var(--rm-fg)]">
						Built for the actions you are afraid to automate
					</h2>
					<p className="mt-5 max-w-[560px] text-pretty text-[17px] leading-7 text-[var(--rm-muted)]">
						Every one of these is the same shape: an agent that can act, held to a scope you chose, with
						someone accountable when it goes wrong.
					</p>
				</div>

				<ul className="mt-14 grid gap-px overflow-hidden rounded-xl border border-[var(--rm-line)] bg-[var(--rm-line)] md:grid-cols-2 xl:grid-cols-3">
					{useCases.map(({ Icon, title, copy }) => (
						<li className="bg-[var(--rm-panel)] p-7 lg:p-8" key={title}>
							<Icon className="size-5 text-[var(--rm-accent)]" weight="bold" />
							<h3 className="mt-5 font-sans text-[18px] font-medium tracking-[-0.02em] text-[var(--rm-fg)]">
								{title}
							</h3>
							<p className="mt-2.5 text-[14.5px] leading-6 text-[var(--rm-muted)]">{copy}</p>
						</li>
					))}
				</ul>
			</div>
		</section>
	)
}
