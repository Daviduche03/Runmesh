"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type ModalProps = {
	open: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
};

// Exit is shorter than enter so dismiss feels snappy.
const EXIT_MS = 150;

export function Modal({ open, onClose, title, children }: ModalProps) {
	const [prevOpen, setPrevOpen] = useState(open);
	const [rendered, setRendered] = useState(open);
	const [visible, setVisible] = useState(false);
	const panelRef = useRef<HTMLDivElement>(null);

	// Sync prop -> transition state during render (no cascading effects).
	// Reopening mid-close keeps `rendered` true; the pending unmount
	// timeout is cancelled by its effect cleanup below.
	if (prevOpen !== open) {
		setPrevOpen(open);
		if (open) {
			setRendered(true);
		} else {
			setVisible(false);
		}
	}

	// Schedule unmount once the exit transition finishes.
	useEffect(() => {
		if (open || !rendered) return;
		const timer = window.setTimeout(() => setRendered(false), EXIT_MS);
		return () => window.clearTimeout(timer);
	}, [open, rendered ]);

	// Enter on later frames so the transition has a start state to leave.
	useEffect(() => {
		if (!rendered || !open) return;
		const raf = requestAnimationFrame(() =>
			requestAnimationFrame(() => setVisible(true)),
		);
		return () => cancelAnimationFrame(raf);
	}, [rendered, open ]);

	useEffect(() => {
		document.body.style.overflow = rendered ? "hidden" : "";
		return () => {
			document.body.style.overflow = "";
		};
	}, [rendered]);

	// Initial focus lands on the panel so keyboard users start inside.
	useEffect(() => {
		if (rendered && open) panelRef.current?.focus();
	}, [rendered, open ]);

	useEffect(() => {
		if (!rendered || !open) return;
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
				return;
			}
			// Lightweight focus trap: cycle Tab within the panel.
			if (e.key !== "Tab" || !panelRef.current) return;
			const focusables = panelRef.current.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
			);
			if (focusables.length === 0) return;
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		};
		window.addEventListener("keydown", handleKey);
		return () => window.removeEventListener("keydown", handleKey);
	}, [rendered, open, onClose ]);

	if (!rendered) return null;

	return (
		<div
			className={cn(
				"fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4",
				"transition-[opacity] duration-150 ease-[var(--ease-out)]",
				visible ? "opacity-100" : "opacity-0",
			)}
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				tabIndex={-1}
				className={cn(
					"w-full max-w-lg rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl outline-none",
					"transition-[opacity,transform] duration-200 ease-[var(--ease-out)]",
					visible ? "scale-100 opacity-100" : "scale-95 opacity-0",
					"motion-reduce:scale-100 motion-reduce:transition-[opacity] motion-reduce:duration-150",
				)}
			>
				<div className="flex items-center justify-between border-b border-border px-4 py-3">
					<h2 className="text-base font-medium">{title}</h2>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="flex size-8 items-center justify-center rounded-[4px] text-muted-foreground transition-[color,transform] duration-150 ease-[var(--ease-out)] hover:text-foreground active:scale-[0.96]"
					>
						<XIcon className="size-4" />
					</button>
				</div>
				<div className="px-4 py-4">{children}</div>
			</div>
		</div>
	);
}
