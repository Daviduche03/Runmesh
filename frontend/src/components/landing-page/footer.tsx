import { Link } from "react-router-dom"
import { LogoIcon } from "@/components/logo"
import { narrowContainer } from "./constants"

const footerSections = [
	["Product", "Features", "Method", "Customers", "Pricing"],
	["Resources", "Changelog", "Docs", "API", "Security"],
	["Company", "About", "Careers", "Contact", "Blog"],
]

export function Footer() {
	return (
		<footer className="border-t border-[#1f2227] py-12">
			<div className={`${narrowContainer} grid gap-10 lg:grid-cols-[1.4fr_repeat(3,1fr)]`}>
				<div>
					<Link to="/" className="flex items-center gap-2.5 text-[14px] text-white no-underline">
						<LogoIcon className="size-6" />
						<span>Runmesh</span>
						<em className="hidden text-[#747883] not-italic sm:inline">- Designed worldwide</em>
					</Link>
					<div className="mt-6 flex gap-4 text-[13px] text-[#8f949e]">
						<span>X</span>
						<span>GitHub</span>
						<span>Slack</span>
						<span>YouTube</span>
					</div>
				</div>
				{footerSections.map(([title, ...items]) => (
					<div className="grid content-start gap-3" key={title}>
						<h3 className="mb-1 text-[13px] font-[590] text-white">{title}</h3>
						{items.map((item) => (
							<Link className="text-[13px] text-[#8f949e] no-underline transition-colors hover:text-white" to="#" key={item}>
								{item}
							</Link>
						))}
					</div>
				))}
			</div>
		</footer>
	)
}
