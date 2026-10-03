import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";

export function StatCard({
	label,
	value,
	footnote,
	delta,
}: {
	label: string;
	value: string;
	footnote: string;
	delta?: number;
}) {
	return (
		<Card className="gap-2">
			<CardHeader>
				<CardTitle className="text-[13px] font-normal text-muted-foreground">
					{label}
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-2">
				<p key={value} className="animate-value-in text-[28px] leading-none font-medium tabular-nums">{value}</p>
				<div className="flex items-center gap-1.5 text-xs">
					{typeof delta === "number" ? (
						<Delta value={delta}>
							<DeltaIcon />
							<DeltaValue />
						</Delta>
					) : null}
					<span className="text-muted-foreground">{footnote}</span>
				</div>
			</CardContent>
		</Card>
	);
}
