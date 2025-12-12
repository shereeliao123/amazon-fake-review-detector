export interface AnalyzeRequest {
  text: string;
}

export interface HeuristicResult {
  name: string;
  score: number;
  passed: boolean;
  details?: string;
}

export interface LLMAnalysis {
  summary: string;
  likelihoodFake: number; // 0–1
  reasons: string[];
}

export interface AnalyzeResponse {
  ok: boolean;
  heuristics: HeuristicResult[];
  llm?: LLMAnalysis;
}
