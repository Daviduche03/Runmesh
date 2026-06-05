export function FoundationVisual() {
	return (
		<div className="relative mx-auto h-72 w-[360px] text-[#363a42]">
			<div className="absolute left-24 top-8 size-36 rotate-45 rounded-[12px] border border-[#4c525c]" />
			<div className="absolute left-28 top-12 size-28 rotate-45 rounded-[10px] border border-current" />
			<div className="absolute left-32 top-16 size-20 rotate-45 rounded-[8px] border border-current" />
			{Array.from({ length: 14 }, (_, index) => (
				<div
					key={index}
					className="absolute bottom-10 h-px bg-current"
					style={{
						left: 50 + index * 12,
						width: 160 - index * 5,
						transform: `rotate(${-18 + index * 2.4}deg)`,
					}}
				/>
			))}
		</div>
	)
}
