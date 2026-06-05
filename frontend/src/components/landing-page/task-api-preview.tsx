export function TaskApiPreview() {
	return (
		<div className="grid min-h-[420px] grid-cols-1 bg-[#0b0c0e] text-[#8f949e] lg:grid-cols-[0.92fr_1.08fr]">
			<div className="border-b border-[#24272d] p-8 lg:border-b-0 lg:border-r">
				<div className="font-mono text-[12px] tracking-[0.16em] text-[#383c44]">REQUEST</div>
				<div className="mt-8 rounded-[6px] border border-[#24272d] bg-[#08090a] p-5 font-mono text-[13px] leading-7">
					<div><span className="text-[#6b7280]">POST</span> <span className="text-[#d8dce3]">/api/v1/tasks</span></div>
					<div className="mt-4 text-[#6b7280]">Authorization: <span className="text-[#d8dce3]">Bearer ••••</span> or X-API-Key</div>
					<div className="mt-4 text-[#6b7280]">{"{"}</div>
					<div className="pl-4">"url": <span className="text-[#d8dce3]">"https://api.store.dev/webhook"</span>,</div>
					<div className="pl-4">"payload": <span className="text-[#d8dce3]">{"{ \"order_id\": \"ord_1042\" }"}</span></div>
					<div className="text-[#6b7280]">{"}"}</div>
				</div>
			</div>
			<div className="p-8">
				<div className="font-mono text-[12px] tracking-[0.16em] text-[#383c44]">TASK LIFECYCLE</div>
				<div className="mt-10 grid gap-0 border-y border-[#24272d]">
					{[
						["queued", "Task stored with generated idempotency key"],
						["running", "Worker POSTs payload to target URL"],
						["completed", "2xx response marks execution complete"],
						["failed", "Non-2xx response increments retries"],
					].map(([state, copy], index) => (
						<div className="grid grid-cols-[120px_1fr] border-b border-[#24272d] py-5 last:border-b-0" key={state}>
							<div className="flex items-center gap-3">
								<span className={`size-1.5 rounded-full ${index === 2 ? "bg-[#4cb782]" : index === 3 ? "bg-[#eb5757]" : "bg-[#6f7cff]"}`} />
								<span className="font-mono text-[12px] text-[#d8dce3]">{state}</span>
							</div>
							<div className="text-[14px] text-[#8f949e]">{copy}</div>
						</div>
					))}
				</div>
			</div>
		</div>
	)
}
