import { Button } from "@/components/ui/button";
import {
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { DashboardCard } from "@/components/dashboard-card";
import { CircleCheckIcon, ArrowRightIcon } from "lucide-react";

export function BillingHealth() {
	return (
		<DashboardCard className="gap-0">
			<CardHeader className="border-b border-border">
				<CardTitle className="text-balance text-base">Workflow health</CardTitle>
				<CardDescription className="text-pretty">
					All systems operating normally.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex h-full items-center px-0">
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<CircleCheckIcon aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>Everything's running smoothly.</EmptyTitle>
						<EmptyDescription className="text-xs">
							No failed retries or stuck tasks. All queues are processing normally.
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button asChild variant="ghost">
							<a href="/#">
								View recent runs
								<ArrowRightIcon aria-hidden="true" />
							</a>
						</Button>
					</EmptyContent>
				</Empty>
			</CardContent>
		</DashboardCard>
	);
}
