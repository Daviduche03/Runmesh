"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { XIcon } from "lucide-react";

type ModalProps = {
	open: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
};

export function Modal({ open, onClose, title, children }: ModalProps) {
	const overlayRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (open) {
			document.body.style.overflow = "hidden";
		} else {
			document.body.style.overflow = "";
		}
		return () => { document.body.style.overflow = ""; };
	}, [open]);

	useEffect(() => {
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		if (open) window.addEventListener("keydown", handleKey);
		return () => window.removeEventListener("keydown", handleKey);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div
			ref={overlayRef}
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
			onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
		>
			<div className="w-full max-w-lg rounded-lg border border-border bg-background">
				<div className="flex items-center justify-between border-b border-border px-4 py-3">
					<h2 className="text-base font-semibold">{title}</h2>
					<button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
						<XIcon className="size-4" />
					</button>
				</div>
				<div className="px-4 py-4">
					{children}
				</div>
			</div>
		</div>
	);
}
