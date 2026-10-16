// Verdict thresholds from SPEC section 6. The rules engine (M4) uses these; the UI quotes them.
export const VERDICT_THRESHOLDS = {
  /** score >= 65 -> apply */
  apply: 65,
  /** 40..64 -> maybe; below -> skip. Ambiguous eligibility forces needs_review. */
  maybe: 40,
} as const;
