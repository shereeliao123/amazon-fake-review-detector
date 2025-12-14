import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { AnalyzeRequest, AnalyzeResponse } from "../types";
import { runHeuristics } from "../utils/heuristics";
import { analyzeWithLLM } from "../utils/llm";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers to allow Chrome extension requests
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const body = req.body as Partial<AnalyzeRequest> | undefined;

  if (!body || typeof body.text !== "string") {
    return res
      .status(400)
      .json({ error: "`text` field (string) is required in the body" });
  }

  const request: AnalyzeRequest = { text: body.text };

  const heuristics = runHeuristics(request);
  const llm = await analyzeWithLLM(request);

  const response: AnalyzeResponse = {
    ok: true,
    heuristics,
    llm: llm ?? undefined,
  };

  return res.status(200).json(response);
}
