import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { container, sectionPadding } from "./constants"
import { RunsPreview } from "./runs-preview"

export function Hero() {
	return (
		<section className={`relative border-b border-[#1f2227] pt-40 ${sectionPadding}`}>
			<div className={container}>
				<div className="grid items-end gap-8 lg:grid-cols-[1fr_360px]">
					<div>
						<h1 className="max-w-[800px] text-balance text-[clamp(40px,5vw,60px)] font-[510] leading-[1.08] tracking-[-0.055em] text-white opacity-0 animate-fade-in-up">
							The task execution API for webhooks, queues, and scheduled jobs
						</h1>
						<p className="mt-6 max-w-[720px] text-base leading-6 tracking-[-0.01em] text-[#94979f] opacity-0 animate-fade-in-up-2">
							Publish HTTP tasks now, schedule them for later, and let Runmesh dispatch JSON payloads to your endpoints.
						</p>
						<div className="mt-8 flex items-center gap-3 opacity-0 animate-fade-in-up-3">
							<Button asChild className="bg-[#f2f2f2] text-sm font-medium text-bg-primary hover:bg-white px-5">
								<Link to="/signup">Get started</Link>
							</Button>
							<Button asChild variant="outline" className="border-[#24272d] text-sm font-medium text-[#d8dce3] hover:bg-[#1c1d21] px-5">
								<Link to="/login">Log in</Link>
							</Button>
						</div>
					</div>

					<div className="mb-1 hidden flex-col items-start gap-1.5 text-sm font-medium text-[#d8dce3] lg:flex">
						<span className="flex items-center gap-3">
							<span className="grid size-4 shrink-0 place-items-center rounded-md bg-[#202654]">
								<span className="size-1.5 rounded-sm bg-[#6f7cff]" />
							</span>
							<span>Webhook scheduling without cron glue</span>
						</span>
						<span className="font-normal text-[#747883]">POST /api/v1/tasks/schedule →</span>
					</div>
				</div>

				<div className="relative mt-12 overflow-hidden rounded-t-lg border border-b-0 border-[#2b2e35] bg-[#101113] opacity-0 animate-fade-in-up-4">
					<div className="p-4">
						<RunsPreview />
					</div>
				</div>
			</div>
		</section>
	)
}
