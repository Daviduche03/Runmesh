import {
	ArrowsClockwise,
	ChatCircleDots,
	CreditCard,
	FileText,
	GitPullRequest,
	ShieldCheck,
} from "@phosphor-icons/react"
import { container } from "./constants"
import { Eyebrow } from "./primitives"

const useCases = [
	{
		Icon: ChatCircleDots,
		title: "Answer from a real account",
		copy: "A support agent reads a customer’s actual billing history — through your product, on their behalf, never holding the card.",
	},
	{
		Icon: CreditCard,
		title: "Move money, not credentials",
		copy: "A refund over your threshold waits for a human. Under it, it goes through without the agent ever seeing a secret.",
	},
	{
		Icon: GitPullRequest,
		title: "Comment on one repo, not all of them",
		copy: "Scope the grant to a single repository and a single label. Revoke it without touching the rest of the estate.",
	},
	{
		Icon: FileText,
		title: "Write the release notes",
		copy: "Merged pull requests become a changelog in the channel you chose — by an agent that only ever had read access.",
	},
	{
		Icon: ArrowsClockwise,
		title: "Keep the index fresh",
		copy: "A scheduled agent tidies the docs. It can write to one collection, expires in an hour, and leaves a receipt.",
	},
	{
		Icon: ShieldCheck,
		title: "Prove it, afterwards",
		copy: "When someone asks what the agent did last Tuesday, there is one answer with the principal, the grant and the result attached.",
	},
]

export function UseCases() {
	return (
		<section id="use-cases" className="scroll-mt-16 border-t border-[var(--rm-line)] py-20 lg:py-28">
			<div className={container}>
				<div className="max-w-[720px]">
					<Eyebrow>What teams build</Eyebrow>
					<h2 className="mt-5 text-balance font-sans text-[clamp(30px,4.2vw,52px)] font-medium leading-[1.06] tracking-[-0.03em] text-[var(--rm-fg)]">
						Agents that are allowed to do real work
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
