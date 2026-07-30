import type { ReactNode } from "react";
import { LayoutGridIcon, ActivityIcon, WorkflowIcon, SettingsIcon, HelpCircleIcon, BookOpenIcon, CloudIcon, ShieldCheckIcon } from "lucide-react";

export type SidebarNavItem = {
	title: string;
	path?: string;
	icon?: ReactNode;
	isActive?: boolean;
	subItems?: SidebarNavItem[];
};

export type SidebarNavGroup = {
	label?: string;
	items: SidebarNavItem[];
};

export const navGroups: SidebarNavGroup[] = [
	{
		label: "Product",
		items: [
			{
				title: "Overview",
				path: "/dashboard",
				icon: (
					<LayoutGridIcon
					/>
				),
			},
			{
				title: "Actions",
				path: "/runs",
				icon: (
					<ActivityIcon
					/>
				),
			},
			{
				title: "Workflows",
				path: "/workflows",
				icon: (
					<WorkflowIcon
					/>
				),
			},
			{
				title: "Workspace",
				path: "/app/workspace",
				icon: (
					<CloudIcon
					/>
				),
			},
		],
	},
	{
		label: "Access",
		items: [
			{
				title: "Connect",
				path: "/connect",
				icon: (
					<ShieldCheckIcon
					/>
				),
			},
		],
	},
	{
		label: "System",
		items: [
			{
				title: "Settings",
				path: "/settings",
				icon: (
					<SettingsIcon
					/>
				),
			},
		],
	},
];

export const footerNavLinks: SidebarNavItem[] = [
	{
		title: "Help Center",
		path: "#/help",
		icon: (
			<HelpCircleIcon
			/>
		),
	},
	{
		title: "Documentation",
		path: "#/documentation",
		icon: (
			<BookOpenIcon
			/>
		),
	},
];

export const navLinks: SidebarNavItem[] = [
	...navGroups.flatMap((group) =>
		group.items.flatMap((item) =>
			item.subItems?.length ? [item, ...item.subItems] : [item]
		)
	),
	...footerNavLinks,
];
