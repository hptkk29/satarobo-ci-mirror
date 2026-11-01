// Cụm B3 — tính NPS (pure, testable).
// Promoter 9-10 · Passive 7-8 · Detractor 0-6. NPS = %promoter − %detractor (−100..100).

export type NpsBreakdown = {
  total: number;
  promoters: number;
  passives: number;
  detractors: number;
  nps: number; // làm tròn về số nguyên
};

export function classifyNps(score: number): "promoter" | "passive" | "detractor" {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

export function computeNps(scores: (number | null | undefined)[]): NpsBreakdown {
  const valid = scores.filter((s): s is number => typeof s === "number" && s >= 0 && s <= 10);
  const total = valid.length;
  if (total === 0) return { total: 0, promoters: 0, passives: 0, detractors: 0, nps: 0 };

  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  for (const s of valid) {
    const c = classifyNps(s);
    if (c === "promoter") promoters++;
    else if (c === "passive") passives++;
    else detractors++;
  }
  const nps = Math.round(((promoters - detractors) / total) * 100);
  return { total, promoters, passives, detractors, nps };
}
