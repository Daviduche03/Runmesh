import { LoginVisual } from "@/components/auth/login-visual"

export function AuthVisualPanel() {
	return (
		<div className="relative hidden overflow-hidden border-r border-[#1f2227] bg-[#08090a] lg:flex lg:w-[52%] lg:flex-col">
			<div className="flex flex-1 flex-col justify-center px-10 py-16 xl:px-16 xl:py-20">
				<p className="font-mono text-[12px] tracking-[0.16em] text-[#383c44]">FIG AUTH</p>
				<h2 className="mt-4 max-w-md text-balance text-[clamp(28px,3vw,40px)] font-[590] leading-[1.08] tracking-[-0.04em] text-white">
					Queue webhooks. Schedule tasks. Inspect every run.
				</h2>
				<p className="mt-4 max-w-sm text-[15px] leading-6 tracking-[-0.01em] text-[#8f949e]">
					Tasks, workflows, and Connect identity — publish HTTP work, automate steps, and manage everything from one dashboard.
				</p>

				<div className="mt-12 overflow-hidden rounded-lg border border-[#202329] bg-[#0a0b0d] px-6 pt-6 pb-8">
					<p className="mb-4 font-mono text-[12px] tracking-[0.16em] text-[#383c44]">FIG 0.1</p>
					<LoginVisual />
				</div>
			</div>
		</div>
	)
}
