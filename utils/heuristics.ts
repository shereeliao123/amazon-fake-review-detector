import type { AnalyzeRequest, HeuristicResult } from "../types";

export function runHeuristics(input: AnalyzeRequest): HeuristicResult[] {
  const results: HeuristicResult[] = [];

  const trimmed = input.text.trim();
  const lengthScore = Math.min(trimmed.length / 200, 1);

  results.push({
    name: "length_check",
    score: lengthScore,
    passed: trimmed.length > 30,
    details: "Basic length-based heuristic",
  });

  return results;
}
