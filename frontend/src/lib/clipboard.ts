import { toast } from "sonner";

/** Copy with toast feedback. Use where there is no other success cue. */
export async function copyText(value: string, label = "Copied to clipboard"): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(value);
		toast.success(label);
		return true;
	} catch {
		toast.error("Copy failed");
		return false;
	}
}
