import { z } from "zod";
import { EVIDENCE_TYPES, PROBE_KINDS } from "../types/diagnosis";
import { KNOWN_ELEMENT_IDS } from "../model/elementIds";

/* -------------------------------------------------------------------------- */
/* Model file schemas (validated at startup, §7)                              */
/* -------------------------------------------------------------------------- */

export const ElementDefinitionSchema = z.object({
  element_id: z.string().regex(/^E\d{3}$/),
  name: z.string().min(1),
  definition: z.string().min(60).max(120),
  short_definition: z.string().min(1).max(60),
  measurement_target: z.string().min(1),
  positive_evidence_examples: z.array(z.string().min(1)).min(2).max(3),
  negative_evidence_examples: z.array(z.string().min(1)).min(2).max(3),
  related_elements: z.array(z.string().regex(/^E\d{3}$/)).min(2).max(4),
  contrast_elements: z.array(z.string().regex(/^E\d{3}$/)).default([]),
  axis_id: z.string().regex(/^AX\d{2}$/),
  weight: z.number().min(0.5).max(1.5),
});

export const ElementsFileSchema = z
  .object({ elements: z.array(ElementDefinitionSchema).length(100) })
  .superRefine((file, ctx) => {
    const ids = new Set<string>();
    for (const e of file.elements) {
      if (ids.has(e.element_id)) {
        ctx.addIssue({ code: "custom", message: `duplicate element_id: ${e.element_id}` });
      }
      ids.add(e.element_id);
    }
    const perAxis = new Map<string, number>();
    for (const e of file.elements) perAxis.set(e.axis_id, (perAxis.get(e.axis_id) ?? 0) + 1);
    if (perAxis.size !== 10) {
      ctx.addIssue({ code: "custom", message: `expected 10 axes, found ${perAxis.size}` });
    }
    for (const [axisId, count] of perAxis) {
      if (count !== 10) {
        ctx.addIssue({ code: "custom", message: `axis ${axisId} has ${count} elements, expected 10` });
      }
    }
    for (const e of file.elements) {
      for (const ref of [...e.related_elements, ...e.contrast_elements]) {
        if (!ids.has(ref)) {
          ctx.addIssue({ code: "custom", message: `${e.element_id} references unknown ${ref}` });
        }
      }
    }
  });

export const AxisDefinitionSchema = z.object({
  axis_id: z.string().regex(/^AX\d{2}$/),
  name: z.string().min(1),
  description: z.string().min(1),
  element_ids: z.array(z.string().regex(/^E\d{3}$/)).length(10),
});

export const AxesFileSchema = z.object({ axes: z.array(AxisDefinitionSchema).length(10) });

/* -------------------------------------------------------------------------- */
/* LLM output schemas                                                          */
/* -------------------------------------------------------------------------- */

/** An element id the model actually contains — not merely one shaped like it. */
export const ElementIdSchema = z
  .string()
  .regex(/^E\d{3}$/)
  .refine((id) => KNOWN_ELEMENT_IDS.has(id), { message: "unknown element_id" });

/** §9: one evidence item. The LLM never emits score/confidence — only these fields. */
export const EvidenceItemSchema = z.object({
  element_id: ElementIdSchema,
  quote: z.string().min(1).max(400), // hard length policy (6-120) enforced in quoteVerifier
  type: z.enum(EVIDENCE_TYPES),
  strength: z.number().min(0).max(1),
  reliability: z.number().min(0).max(1),
  direction: z.enum(["positive", "negative", "neutral"]),
  context: z.string().min(1).max(300),
});

/** §13.2b: LLM points at two existing evidence ids; the app decides severity. */
export const ContradictionCandidateSchema = z.object({
  evidence_a: z.string().min(1),
  evidence_b: z.string().min(1),
  note: z.string().max(300).default(""),
});

export const EvidenceExtractionSchema = z.object({
  evidence: z.array(EvidenceItemSchema).max(40),
  contradiction_candidates: z.array(ContradictionCandidateSchema).max(10).default([]),
});

export const QuestionCandidateSchema = z.object({
  text: z.string().min(1).max(200),
  target_elements: z.array(ElementIdSchema).min(1).max(4),
  probe_kind: z.enum(PROBE_KINDS),
  expected_yield: z.number().min(0).max(1),
  rationale: z.string().max(300).default(""),
});

export const QuestionGenerationSchema = z.object({
  questions: z.array(QuestionCandidateSchema).min(1).max(8),
});

export const DistressCheckSchema = z.object({
  level: z.enum(["none", "distress", "crisis"]),
  reason: z.string().max(200).default(""),
});

/* -------------------------------------------------------------------------- */
/* Internal / API schemas                                                      */
/* -------------------------------------------------------------------------- */

export const ElementUpdateSchema = z.object({
  element_id: ElementIdSchema,
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  delta: z.number(),
  cause_evidence_ids: z.array(z.string()),
});

export const AxisAggregationSchema = z.object({
  axis_id: z.string().regex(/^AX\d{2}$/),
  name: z.string(),
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  coverage: z.number().min(0).max(1),
});

export const QuestionSelectionSchema = z.object({
  text: z.string().min(1),
  target_elements: z.array(z.string()),
  probe_kind: z.enum(PROBE_KINDS),
  q_value: z.number(),
});

export const TurnProcessingSchema = z.object({
  turn: z.number().int().min(0),
  evidence_accepted: z.number().int().min(0),
  evidence_rejected: z.number().int().min(0),
  element_updates: z.array(ElementUpdateSchema),
  axes: z.array(AxisAggregationSchema),
  new_contradictions: z.number().int().min(0),
  next_question: QuestionSelectionSchema.nullable(),
  is_complete: z.boolean(),
});

export const StartRequestSchema = z.object({}).loose();

export const MessageRequestSchema = z.object({
  session_id: z.string().min(1).max(64),
  message: z.string().min(1, "回答を入力してください。").max(4000, "回答は4000字以内で入力してください。"),
});

export const FallbackQuestionSchema = z.object({
  question_id: z.string().min(1),
  text: z.string().min(1).max(200),
  target_elements: z.array(z.string().regex(/^E\d{3}$/)).min(1).max(4),
  probe_kind: z.enum(PROBE_KINDS),
  expected_yield: z.number().min(0).max(1),
  opening: z.boolean().default(false),
});

export const FallbackQuestionsFileSchema = z.object({
  questions: z.array(FallbackQuestionSchema).min(10),
});

export const SupportResourceSchema = z.object({
  name: z.string().min(1),
  contact: z.string().min(1),
  hours: z.string().default(""),
  note: z.string().default(""),
});

export const SupportResourcesFileSchema = z.object({
  last_reviewed: z.string(),
  resources: z.array(SupportResourceSchema).min(1),
});

export type EvidenceExtraction = z.infer<typeof EvidenceExtractionSchema>;
export type QuestionGeneration = z.infer<typeof QuestionGenerationSchema>;
export type DistressCheck = z.infer<typeof DistressCheckSchema>;
export type FallbackQuestion = z.infer<typeof FallbackQuestionSchema>;
export type SupportResource = z.infer<typeof SupportResourceSchema>;
