import {
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import { DashboardCard } from "@/modules/dashboard/components/dashboard-card";
import { Skeleton } from "@/components/ui/skeleton";

type Stat = {
	label: string;
	value: string;
	delta: number;
};

type Props = {
	stats: Stat[];
	loading?: boolean;
};

function StatSkeleton() {
	return (
		<DashboardCard className="">
			<CardHeader className="flex flex-row items-center justify-between">
				<Skeleton className="h-3 w-20" />
			</CardHeader>
			<CardContent className="flex flex-row items-center gap-2">
				<Skeleton className="h-8 w-24" />
			</CardContent>
			<CardFooter className="gap-1 rounded-none bg-background text-xs">
				<Skeleton className="h-3 w-32" />
			</CardFooter>
		</DashboardCard>
	);
}

export function DashboardStats({ stats, loading }: Props) {
	if (loading) {
		return (
			<>
				<StatSkeleton />
				<StatSkeleton />
				<StatSkeleton />
				<StatSkeleton />
			</>
		);
	}

	return (
		<>
			{stats.map((s) => (
				<DashboardCard className="" key={s.label}>
					<CardHeader className="flex flex-row items-center justify-between">
						<CardTitle className="font-mono text-[10.5px] font-normal uppercase tracking-[0.12em] text-muted-foreground">
							{s.label}
						</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-row items-center gap-2">
						<p className="text-[22px] font-medium tabular-nums">{s.value}</p>
					</CardContent>
					<CardFooter className="gap-1 rounded-none bg-background text-xs">
						<Delta value={s.delta}>
							<DeltaIcon />
							<DeltaValue />
						</Delta>
						<span className="text-muted-foreground">vs last week</span>{" "}
					</CardFooter>
				</DashboardCard>
			))}
		</>
	);
}
