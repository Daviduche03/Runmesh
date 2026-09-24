#!/usr/bin/env node
// The classifier for the support harness: free text in, a typed refund-reason
// label + confidence out. Uses the model we have today (Groq/Qwen structured
// output) behind `structuredClassifier`, so swapping in Jev later is a one-line
// change — same interface, same policy on the label.
import { generateObject } from "ai";
import { groq } from "@ai-sdk/groq";
import { z } from "zod";
import { structuredClassifier } from "@runmesh/agent";

const MODEL = process.env.SUPPORT_MODEL ?? "qwen/qwen3.8-27b";

export const REFUND_REASON_LABELS = ["valid_billing_error", "goodwill", "abuse"];

export const REFUND_REASON_GUIDE = [
  "You classify the customer's stated reason for requesting a refund.",
  "valid_billing_error: a duplicate, erroneous, or unauthorized charge the business should reverse.",
  "goodwill: a discretionary ask (inconvenience, change of mind) with no billing error.",
  "abuse: an attempt to extract value without cause, or to game the process.",
].join(" ");

export function refundReasonClassifier(threshold = 0.7) {
  return structuredClassifier({
    generateObject,
    model: groq(MODEL),
    schema: z.object({
      label: z.enum(REFUND_REASON_LABELS),
      confidence: z.number().min(0).max(1),
    }),
    instructions: REFUND_REASON_GUIDE,
    threshold,
    fallback: "uncertain",
  });
}
