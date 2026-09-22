"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { useTheme } from "@/components/theme-provider";

function useResolvedTheme(): "light" | "dark" {
	const { theme } = useTheme();
	const [systemDark, setSystemDark] = useState(
		() => window.matchMedia("(prefers-color-scheme: dark)").matches,
	);

	useEffect(() => {
		const query = window.matchMedia("(prefers-color-scheme: dark)");
		const handleChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
		query.addEventListener("change", handleChange);
		return () => query.removeEventListener("change", handleChange);
	}, []);

	if (theme === "light") return "light";
	if (theme === "dark") return "dark";
	return systemDark ? "dark" : "light";
}

/** Global toast surface. Mounted once at the router root. */
export function AppToaster() {
	return (
		<Toaster
			theme={useResolvedTheme()}
			position="bottom-right"
			gap={8}
			toastOptions={{ duration: 4000 }}
		/>
	);
}
