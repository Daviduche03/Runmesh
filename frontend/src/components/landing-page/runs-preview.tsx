import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { SearchIcon } from "lucide-react";

const runs = [
	{ id: "tk-1045", endpoint: "/webhooks/receipt", status: "Completed", scheduled: "2 min ago", duration: "1.2s" },
	{ id: "tk-1044", endpoint: "/api/v1/process-order", status: "Running", scheduled: "15 min ago", duration: "—" },
	{ id: "tk-1043", endpoint: "/webhooks/shipment/update", status: "Completed", scheduled: "1 hour ago", duration: "0.8s" },
	{ id: "tk-1042", endpoint: "/api/v1/sync/inventory", status: "Failed", scheduled: "3 hours ago", duration: "30.1s" },
	{ id: "tk-1041", endpoint: "/webhooks/user/signup", status: "Completed", scheduled: "5 hours ago", duration: "0.4s" },
	{ id: "tk-1040", endpoint: "/api/v1/charge/refund", status: "Completed", scheduled: "8 hours ago", duration: "2.1s" },
	{ id: "tk-1039", endpoint: "/webhooks/order/cancelled", status: "Pending", scheduled: "12 hours ago", duration: "—" },
	{ id: "tk-1038", endpoint: "/api/v1/export/csv", status: "Running", scheduled: "14 hours ago", duration: "—" },
];

const statusColor = (status: string) => {
	switch (status) {
		case "Completed": return "text-emerald-400";
		case "Running": return "text-sky-400";
		case "Failed": return "text-red-400";
		case "Pending": return "text-amber-400";
		default: return "text-[#6d727d]";
	}
};

export function RunsPreview() {
	return (
		<div className="grid gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-[15px] font-[590] text-[#d9dce3]">Latest runs</h2>
					<p className="text-[13px] text-[#6d727d] mt-0.5">Tasks and workflow runs across your account.</p>
				</div>
				<div className="relative w-56">
					<SearchIcon className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#6d727d]" />
					<Input placeholder="Search runs..." className="h-8 border-[#24272d] bg-[#0a0b0d] pl-8 text-[13px] text-white placeholder:text-[#595a5c]" />
				</div>
			</div>
			<div className="rounded-lg border border-[#24272d]">
				<Table>
					<TableHeader>
						<TableRow className="border-b-[#24272d]">
							<TableHead className="ps-4 text-[11px] font-medium text-[#6d727d] uppercase">Task ID</TableHead>
							<TableHead className="text-[11px] font-medium text-[#6d727d] uppercase">Endpoint</TableHead>
							<TableHead className="text-[11px] font-medium text-[#6d727d] uppercase">Status</TableHead>
							<TableHead className="pe-4 text-right text-[11px] font-medium text-[#6d727d] uppercase">Duration</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{runs.map((run) => (
							<TableRow className="h-10 border-b-[#1f2227]" key={run.id}>
								<TableCell className="ps-4 font-mono text-[13px] text-[#d9dce3]">
									{run.id}
								</TableCell>
								<TableCell className="max-w-40 truncate font-mono text-[13px] text-[#8f949e]">
									{run.endpoint}
								</TableCell>
								<TableCell>
									<span className={`text-[13px] font-medium ${statusColor(run.status)}`}>
										{run.status}
									</span>
								</TableCell>
								<TableCell className="pe-4 text-right font-mono text-[13px] text-[#8f949e]">
									{run.duration}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
