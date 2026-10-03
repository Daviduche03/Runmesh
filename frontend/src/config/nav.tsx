import type { Icon } from "@phosphor-icons/react";
import {
	BookOpen,
	ClipboardText,
	FolderOpen,
	Gear,
	Key,
	PlugsConnected,
	PlayCircle,
	Question,
	Robot,
	Scales,
	SquaresFour,
	TreeStructure,
} from "@phosphor-icons/react";

export type SidebarNavItem = {
	title: string;
	path?: string;
	icon?: Icon;
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
				icon: SquaresFour,
			},
			{
				title: "Agents",
				path: "/agents",
				icon: Robot,
			},
		],
	},
	{
		label: "Access",
		items: [
			{
				title: "Grants",
				path: "/grants",
				icon: Key,
			},
			{
				title: "Connect",
				path: "/connect",
				icon: PlugsConnected,
			},
		],
	},
	{
		label: "Execution",
		items: [
			{
				title: "Runs",
				path: "/runs",
				icon: PlayCircle,
			},
			{
				title: "Workflows",
				path: "/workflows",
				icon: TreeStructure,
			},
			{
				title: "Workspace",
				path: "/app/workspace",
				icon: FolderOpen,
			},
		],
	},
	{
		label: "Governance",
		items: [
			{
				title: "Audit",
				path: "/audit",
				icon: ClipboardText,
			},
			{
				title: "Policies",
				path: "/policies",
				icon: Scales,
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
				icon: Gear,
			},
		],
	},
];

export const footerNavLinks: SidebarNavItem[] = [
	{
		title: "Help Center",
		path: "#/help",
		icon: Question,
	},
	{
		title: "Documentation",
		path: "#/documentation",
		icon: BookOpen,
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
