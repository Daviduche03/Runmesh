"use client";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Loader2Icon, Trash2Icon } from "lucide-react";

type DeleteConfirmModalProps = {
	open: boolean;
	onClose: () => void;
	title: string;
	itemName: string;
	description: string;
	onConfirm: () => void;
	confirming?: boolean;
};

export function DeleteConfirmModal({
	open,
	onClose,
	title,
	itemName,
	description,
	onConfirm,
	confirming = false,
}: DeleteConfirmModalProps) {
	return (
		<Modal open={open} onClose={onClose} title={title}>
			<div className="grid gap-5">
				<p className="text-sm text-muted-foreground">
					Are you sure you want to delete <span className="font-medium text-foreground">{itemName}</span>? {description}
				</p>
				<div className="flex justify-end gap-3 pt-2 border-t border-border">
					<Button variant="outline" onClick={onClose} disabled={confirming}>
						Cancel
					</Button>
					<Button variant="destructive" onClick={onConfirm} disabled={confirming}>
						{confirming ? (
							<Loader2Icon className="size-4 animate-spin me-1.5" />
						) : (
							<Trash2Icon className="size-4 me-1.5" />
						)}
						Delete
					</Button>
				</div>
			</div>
		</Modal>
	);
}
