import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { scrollToElement, startSmooth, stopSmooth } from "@/lib/smooth";

export function SmoothScroll({ children }: { children: ReactNode }) {
	const { hash } = useLocation();

	useEffect(() => {
		startSmooth();
		if (hash) {
			const id = hash.slice(1);
			requestAnimationFrame(() => requestAnimationFrame(() => scrollToElement(id)));
		}
		return () => stopSmooth();
	}, [hash]);

	return <>{children}</>;
}
