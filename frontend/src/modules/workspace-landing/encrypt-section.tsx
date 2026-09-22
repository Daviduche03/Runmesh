import { container } from "./constants"
import { SectionHeading } from "@/modules/landing/section-heading"
import { ProductShot } from "@/components/product-shot"

const specs = [
	["Cipher", "AES-256-GCM. Plaintext never leaves your devices."],
	["Key", "Generated on device, never uploaded, shared only between machines you own."],
	["Detection", "A keyed tag reveals whether a secret changed without decrypting it."],
	["Templates", ".env.example and .env.sample stay shared so structure remains visible."],
]

export function EncryptSection() {
	return (
		<section id="env" className="scroll-mt-14 border-b border-[var(--rm-line)] py-28 lg:py-36">
			<div className={container}>
				<SectionHeading index="03" label="Secrets" title="Secrets sync without ever leaving plaintext">
					Project files sync in the open, but your .env secrets travel encrypted. The key is generated on your
					device and never touches the cloud.
				</SectionHeading>

				<div className="mt-14 grid gap-px bg-[var(--rm-line)] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
					<div className="bg-[var(--rm-bg)] p-6 lg:p-8">
						<ProductShot variant="encrypt" />
					</div>
					<div className="bg-[var(--rm-bg)] p-6 lg:p-8">
						<dl className="divide-y divide-[var(--rm-line)]">
							{specs.map(([term, detail]) => (
								<div className="grid grid-cols-[100px_1fr] gap-4 py-4 first:pt-0 last:pb-0" key={term}>
									<dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--rm-faint)]">
										{term}
									</dt>
									<dd className="text-[14px] leading-6 text-[var(--rm-muted)]">{detail}</dd>
								</div>
							))}
						</dl>
					</div>
				</div>
			</div>
		</section>
	)
}
