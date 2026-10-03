import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import type { SidebarNavGroup } from "@/config/nav";
import type { Icon } from "@phosphor-icons/react";
import { CaretRight } from "@phosphor-icons/react";

/** Sidebar icon — filled when its link is active, outline otherwise. */
export function NavIcon({ icon: Cmp, active }: { icon?: Icon; active?: boolean }) {
	if (!Cmp) return null;
	return <Cmp size={16} weight={active ? "fill" : "regular"} />;
}

export function NavGroup({ label, items }: SidebarNavGroup) {
	const { pathname, search } = useLocation();

	return (
		<SidebarGroup>
			{label && (
				<SidebarGroupLabel className="text-[11px] font-medium tracking-[0.02em] text-muted-foreground">
					{label}
				</SidebarGroupLabel>
			)}
			<SidebarMenu>
				{items.map((item) => {
					const isSettingsTab = item.path?.startsWith("/settings?tab=") && `${pathname}${search}` === item.path;
					const isSettingsRoot = item.path === "/settings" && pathname === "/settings" && !search;
					const isActive = (item.path !== "/settings" && pathname === item.path) ||
						isSettingsRoot ||
						(item.path === "/workflows" && pathname.startsWith("/workflows/")) ||
						isSettingsTab ||
						item.subItems?.some((s) => pathname === s.path);
					// A parent with an active child stays expanded but is not itself highlighted.
					const childActive = item.subItems?.some((s) => pathname === s.path) ?? false;
					const highlight = isActive && !childActive;

					return (
						<Collapsible
							asChild
							className="group/collapsible"
							defaultOpen={isActive}
							key={item.title}
						>
							<SidebarMenuItem>
				{item.subItems?.length ? (
								<>
									<CollapsibleTrigger asChild>
										<SidebarMenuButton
											className={cn(!highlight && "text-muted-foreground")}
											isActive={highlight}
										>
												<NavIcon icon={item.icon} active={highlight} />
												<span>{item.title}</span>
												<CaretRight className="ml-auto transition-transform duration-150 ease-[var(--ease-out)] group-data-[state=open]/collapsible:rotate-90" />
											</SidebarMenuButton>
										</CollapsibleTrigger>
										<CollapsibleContent>
											<SidebarMenuSub className="gap-0.5">
												{item.subItems?.map((subItem) => {
													const subActive = pathname === subItem.path;
													return (
														<SidebarMenuSubItem key={subItem.title}>
															<SidebarMenuSubButton
																asChild
																size="sm"
																className={cn(!subActive && "text-muted-foreground")}
																isActive={subActive}
															>
																<Link to={subItem.path ?? "#"}>
																	<NavIcon icon={subItem.icon} active={subActive} />
																	<span>{subItem.title}</span>
																</Link>
															</SidebarMenuSubButton>
														</SidebarMenuSubItem>
													);
												})}
											</SidebarMenuSub>
										</CollapsibleContent>
									</>
								) : (
									<SidebarMenuButton
										asChild
										className={cn(!isActive && "text-muted-foreground")}
										isActive={isActive}
									>
										<Link to={item.path ?? "#"}>
											<NavIcon icon={item.icon} active={isActive} />
											<span>{item.title}</span>
										</Link>
									</SidebarMenuButton>
								)}
							</SidebarMenuItem>
						</Collapsible>
					);
				})}
			</SidebarMenu>
		</SidebarGroup>
	);
}
