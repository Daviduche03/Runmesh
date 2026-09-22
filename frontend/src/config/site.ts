export const siteConfig = {
	name: "Runmesh",
	tagline: "Consent, policy, and a receipt for everything your agents do.",
	description:
		"Agents propose. Runmesh authorizes, executes, and records.",
	url: "http://localhost:5173",
	links: {
		github: "https://github.com/anomalyco/opencode",
	},
} as const;

export type SiteConfig = typeof siteConfig;
