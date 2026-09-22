import type { ReactNode } from "react";
import {
	ActivityIcon,
	BotIcon,
	CloudIcon,
	HelpCircleIcon,
	BookOpenIcon,
	KeyRoundIcon,
	LayoutDashboardIcon,
	ScrollTextIcon,
	ShieldCheckIcon,
	SlidersHorizontalIcon,
	WorkflowIcon,
	SettingsIcon,
} from "lucide-react";

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
		label: "Control room",
		items: [
			{
				title: "Control room",
				path: "/dashboard",
				icon: <LayoutDashboardIcon />,
			},
			{
				title: "Agents",
				path: "/agents",
				icon: <BotIcon />,
			},
		],
	},
	{
		label: "Access",
		items: [
			{
				title: "Grants",
				path: "/grants",
				icon: <KeyRoundIcon />,
			},
			{
				title: "Connect",
				path: "/connect",
				icon: <ShieldCheckIcon />,
			},
		],
	},
	{
		label: "Execution",
		items: [
			{
				title: "Runs",
				path: "/runs",
				icon: <ActivityIcon />,
			},
			{
				title: "Workflows",
				path: "/workflows",
				icon: <WorkflowIcon />,
			},
			{
				title: "Workspace",
				path: "/app/workspace",
				icon: <CloudIcon />,
			},
		],
	},
	{
		label: "Governance",
		items: [
			{
				title: "Audit",
				path: "/audit",
				icon: <ScrollTextIcon />,
			},
			{
				title: "Policies",
				path: "/policies",
				icon: <SlidersHorizontalIcon />,
				subItems: [
					{
						title: "Rules",
						path: "/policies",
					},
					{
						title: "Simulation",
						path: "/policies/simulation",
					},
					{
						title: "Change log",
						path: "/policies/changelog",
					},
				],
			},
			{
				title: "Settings",
				path: "/settings",
				icon: <SettingsIcon />,
			},
		],
	},
];

export const footerNavLinks: SidebarNavItem[] = [
	{
		title: "Help Center",
		path: "#/help",
		icon: <HelpCircleIcon />,
	},
	{
		title: "Documentation",
		path: "#/documentation",
		icon: <BookOpenIcon />,
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
