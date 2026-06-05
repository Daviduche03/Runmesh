import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ClockIcon, HashIcon, ActivityIcon, RepeatIcon, GlobeIcon, ZapIcon } from "lucide-react";

export type TaskDetail = {
	id: string;
	endpoint: string;
	status: string;
	scheduled: string;
	duration: string | null;
	retries: number;
	trigger?: string;
};

type Props = {
	open: boolean;
	onClose: () => void;
	task: TaskDetail | null;
};

const statusColor = (status: string) => {
	switch (status) {
		case "Completed": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
		case "Running": return "bg-sky-500/10 text-sky-400 border-sky-500/20";
		case "Failed": return "bg-red-500/10 text-red-400 border-red-500/20";
		case "Pending": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
		default: return "bg-muted text-muted-foreground border-border";
	}
};

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
	return (
		<div className="flex items-start gap-3">
			<div className="mt-0.5 text-muted-foreground">{icon}</div>
			<div className="grid gap-0.5">
				<span className="text-xs text-muted-foreground">{label}</span>
				<span className="text-sm font-medium">{value}</span>
			</div>
		</div>
	);
}

export function TaskDetailsSheet({ open, onClose, task }: Props) {
	if (!task) return null;

	return (
		<Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
			<SheetContent side="right" className="w-full max-w-md">
				<SheetHeader className="pb-4 border-b border-border">
					<div className="flex items-center gap-2">
						<SheetTitle className="text-base font-semibold">
							{task.id.slice(0, 8)}...
						</SheetTitle>
						<Badge className={`${statusColor(task.status)}`} variant="outline">
							{task.status}
						</Badge>
					</div>
					<SheetDescription className="truncate max-w-sm">
						{task.endpoint}
					</SheetDescription>
				</SheetHeader>

				<div className="grid gap-5 py-5">
					<DetailRow
						icon={<HashIcon className="size-4" />}
						label="Task ID"
						value={task.id}
					/>
					<DetailRow
						icon={<GlobeIcon className="size-4" />}
						label="Endpoint"
						value={task.endpoint}
					/>
					<DetailRow
						icon={<ActivityIcon className="size-4" />}
						label="Status"
						value={task.status}
					/>
					<DetailRow
						icon={<ClockIcon className="size-4" />}
						label="Scheduled"
						value={task.scheduled}
					/>
					<DetailRow
						icon={<ClockIcon className="size-4" />}
						label="Duration"
						value={task.duration ?? "—"}
					/>
					<DetailRow
						icon={<RepeatIcon className="size-4" />}
						label="Retries"
						value={String(task.retries)}
					/>
					{task.trigger && (
						<DetailRow
							icon={<ZapIcon className="size-4" />}
							label="Trigger"
							value={task.trigger}
						/>
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}
