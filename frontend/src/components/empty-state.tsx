import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/components/ui/empty";
import { ListOrderedIcon } from "lucide-react";

const EmptyState = ({ title, description, icon }: { title: string; description: string; icon?: React.ReactNode }) => {
	return (
		<div className="flex h-40 items-center justify-center">
			<Empty>
				<EmptyHeader>
					<EmptyMedia>
						{icon || <ListOrderedIcon className="size-5 text-muted-foreground" />}
					</EmptyMedia>
					<EmptyTitle>{title}</EmptyTitle>
					<EmptyDescription>
						{description}
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</div>
	);
};

export default EmptyState;