import {
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { DashboardCard } from "@/components/dashboard-card";
import { CheckCircleIcon, LoaderIcon, XCircleIcon, ClockIcon } from "lucide-react";

const items = [
	{
		title: "Task tk-1045 completed — receipt webhook delivered",
		time: "About 2 minutes ago",
		icon: (
			<CheckCircleIcon />
		),
	},
	{
		title: "Task tk-1044 started — processing order #8821",
		time: "15 minutes ago",
		icon: (
			<LoaderIcon />
		),
	},
	{
		title: "Task tk-1042 failed — inventory sync timeout",
		time: "3 hours ago",
		icon: (
			<XCircleIcon />
		),
	},
	{
		title: "Scheduled job 'daily-report' queued for 08:00 UTC",
		time: "5 hours ago",
		icon: (
			<ClockIcon />
		),
	},
] as const;

export function DashboardActivity() {
	return (
		<DashboardCard className="gap-0">
			<CardHeader className="border-b border-border">
				<CardTitle>Activity</CardTitle>
				<CardDescription>Latest task run events in your workspace.</CardDescription>
			</CardHeader>
			<CardContent className="px-0">
				<ul className="flex flex-col divide-y divide-border">
					{items.map((item) => (
						<li className="flex h-16 items-center gap-3 px-6" key={item.title}>
							<span
								aria-hidden="true"
								className="flex size-10 shrink-0 items-center justify-center [&_svg]:size-4"
							>
								{item.icon}
							</span>
							<div className="min-w-0 flex-1 space-y-1">
								<p className="line-clamp-1 text-pretty text-foreground text-sm leading-snug">
									{item.title}
								</p>
								<p className="text-muted-foreground text-xs">{item.time}</p>
							</div>
						</li>
					))}
				</ul>
			</CardContent>
		</DashboardCard>
	);
}
