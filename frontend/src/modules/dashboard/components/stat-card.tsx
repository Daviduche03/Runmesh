import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
		<Card>
			<CardHeader>
				<CardTitle className="font-mono text-[10.5px] font-normal uppercase tracking-[0.12em] text-muted-foreground">
					{label}
				</CardTitle>
			</CardHeader>
			<CardContent>
				<p key={value} className="animate-value-in text-[28px] leading-none font-medium tabular-nums">{value}</p>
			</CardContent>
			<CardFooter className="gap-1.5 text-xs">
				{typeof delta === "number" ? (
					<>
						<Delta value={delta}>
							<DeltaIcon />
							<DeltaValue />
						</Delta>
						<span className="text-muted-foreground">{footnote}</span>
					</>
				) : (
					<span className="text-muted-foreground">{footnote}</span>
				)}
			</CardFooter>
		</Card>
	);
}
