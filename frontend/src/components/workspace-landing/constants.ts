export const container = "mx-auto w-[min(1280px,calc(100%_-_48px))]"
export const narrowContainer = "mx-auto w-[min(1120px,calc(100%_-_48px))]"
export const sectionPadding = "py-24 lg:py-32"

export const headerNavLinks = [
	{ label: "Sync", id: "sync" },
	{ label: "FUSE", id: "fuse" },
	{ label: ".devignore", id: "devignore" },
	{ label: "CLI", id: "cli" },
] as const
