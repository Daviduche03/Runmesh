const API_BASE = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

export type ApiMeta = {
	page?: number;
	limit?: number;
	total?: number;
};

type ApiEnvelope<T> = {
	ok: boolean;
	data?: T;
	message?: string;
	meta?: ApiMeta;
	error?: { code: string; message: string };
	detail?: string;
};

export type ApiResponse<T> = {
	data: T;
	message?: string;
	meta?: ApiMeta;
};

async function handleResponse<T>(res: Response): Promise<ApiResponse<T>> {
	const body = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;

	if (!res.ok || body.ok === false) {
		const message =
			body.error?.message ??
			(typeof body.detail === "string" ? body.detail : undefined) ??
			"Request failed";
		throw new ApiError(message, res.status);
	}

	return {
		data: body.data as T,
		message: body.message,
		meta: body.meta,
	};
}

function getHeaders(): Record<string, string> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };

	if (typeof window !== "undefined") {
		const token = localStorage.getItem("runmesh-token");
		if (token) {
			headers["Authorization"] = `Bearer ${token}`;
		}
	}

	return headers;
}

export async function apiGet<T = unknown>(path: string): Promise<ApiResponse<T>> {
	const res = await fetch(`${API_BASE}${path}`, {
		method: "GET",
		headers: getHeaders(),
	});
	return handleResponse<T>(res);
}

export async function apiPost<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
	const res = await fetch(`${API_BASE}${path}`, {
		method: "POST",
		headers: getHeaders(),
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	return handleResponse<T>(res);
}

export async function apiDelete<T = unknown>(path: string): Promise<ApiResponse<T>> {
	const res = await fetch(`${API_BASE}${path}`, {
		method: "DELETE",
		headers: getHeaders(),
	});
	return handleResponse<T>(res);
}
