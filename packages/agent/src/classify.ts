/** Free-text → typed decision, so a deterministic policy engine can enforce on
 *  it. Provider-agnostic: Jev, an LLM judge, or a local encoder all satisfy
 *  this shape. Classification *produces a signal*; the engine still decides. */

export type ClassifierResult = { label: string; confidence: number };

export type ClassifierInput = {
  /** The free text (or serialized state) to judge. */
  state: string;
  /** Optional per-call instruction appended to the classifier's own. */
  instructions?: string;
};

export type Classifier = (input: ClassifierInput) => Promise<ClassifierResult>;

/** Below `threshold`, return an explicit fallback label so policy can match
 *  "uncertain" and escalate instead of guessing on a low-confidence answer. */
export function withThreshold(classifier: Classifier, threshold: number, fallback = "uncertain"): Classifier {
  return async (input) => {
    const result = await classifier(input);
    if (!Number.isFinite(result.confidence) || result.confidence < threshold) {
      return { label: fallback, confidence: result.confidence };
    }
    return result;
  };
}

/** Build a Classifier from a structured-generation call. `generateObject` and
 *  the schema are injected, so this package stays dependency-free and the
 *  backing model (Jev, an LLM, …) is swappable. The schema must yield
 *  `{ label: string, confidence: number }`. */
export function structuredClassifier(opts: {
  generateObject: (options: Record<string, unknown>) => Promise<{ object: unknown }>;
  model: unknown;
  schema: unknown;
  instructions: string;
  threshold?: number;
  fallback?: string;
}): Classifier {
  const base: Classifier = async ({ state, instructions }) => {
    const { object } = await opts.generateObject({
      model: opts.model,
      schema: opts.schema,
      system: [opts.instructions, instructions].filter(Boolean).join("\n"),
      prompt: state,
      temperature: 0,
    });
    const out = (object ?? {}) as { label?: unknown; confidence?: unknown };
    return { label: String(out.label ?? ""), confidence: Number(out.confidence ?? 0) };
  };
  return opts.threshold === undefined ? base : withThreshold(base, opts.threshold, opts.fallback);
}
