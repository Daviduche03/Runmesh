import {
	SiGithub,
	SiGoogle,
	SiGmail,
	SiNotion,
	SiLinear,
	SiStripe,
	SiSupabase,
	SiAirtable,
	SiJira,
	SiFigma,
	SiVercel,
	SiSentry,
	SiDatadog,
} from "@icons-pack/react-simple-icons"
import { SlackIcon } from "@/components/icons/slack-icon"
import { container } from "./constants"
import { Eyebrow } from "./primitives"

const providers = [
	{ name: "GitHub", Icon: SiGithub },
	{ name: "Google", Icon: SiGoogle },
	{ name: "Slack", Icon: SlackIcon },
	{ name: "Notion", Icon: SiNotion },
	{ name: "Gmail", Icon: SiGmail },
	{ name: "Linear", Icon: SiLinear },
	{ name: "Stripe", Icon: SiStripe },
	{ name: "Supabase", Icon: SiSupabase },
	{ name: "Airtable", Icon: SiAirtable },
	{ name: "Jira", Icon: SiJira },
	{ name: "Figma", Icon: SiFigma },
	{ name: "Sentry", Icon: SiSentry },
	{ name: "Vercel", Icon: SiVercel },
	{ name: "Datadog", Icon: SiDatadog },
]

export function Integrations() {
	return (
		<section className="border-t border-[var(--rm-line)] py-16 lg:py-20">
			<div className={container}>
				<div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
					<div className="max-w-[520px]">
						<Eyebrow>Connect</Eyebrow>
						<h2 className="mt-4 text-balance font-display text-[clamp(24px,3vw,36px)] font-medium leading-[1.1] tracking-[-0.025em] text-[var(--rm-fg)]">
							Your users connect the accounts your agents act on
						</h2>
						<p className="mt-4 text-pretty text-[16px] leading-7 text-[var(--rm-muted)]">
							OAuth, API keys, or device code. Runmesh holds the credential so the agent never sees it.
						</p>
					</div>
				</div>

				<ul className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--rm-line)] bg-[var(--rm-line)] sm:grid-cols-4 lg:grid-cols-7">
					{providers.map(({ name, Icon }) => (
						<li
							className="flex flex-col items-center gap-3 bg-[var(--rm-panel)] px-4 py-7"
							key={name}
						>
							<Icon className="size-6" aria-hidden="true" />
							<span className="text-[12.5px] text-[var(--rm-muted)]">{name}</span>
						</li>
					))}
				</ul>
			</div>
		</section>
	)
}
