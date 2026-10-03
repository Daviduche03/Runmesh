import { cn } from "@/lib/utils";
import { DecorIcon } from "@/components/decor-icon";
import { CustomSidebarTrigger } from "@/components/layout/custom-sidebar-trigger";
import { NavUser } from "@/components/layout/nav-user";

export function AppHeader() {
	return (
		<header
			className={cn(
				"sticky top-0 z-50 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3 md:px-4",
				"bg-background"
			)}
		>
			<DecorIcon className="hidden md:block" position="bottom-left" />
			<div className="flex items-center gap-3">
				<CustomSidebarTrigger />
			</div>
			<div className="flex items-center gap-3">
				<NavUser />
			</div>
		</header>
	);
}
