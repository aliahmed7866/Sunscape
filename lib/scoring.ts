export type SkyInputs = {
  lowCloud: number;
  midCloud: number;
  highCloud: number;
  precipitation: number;
  visibilityKm: number;
  humidity: number;
};

export type SkyScore = {
  score: number;
  label: "Poor" | "Fair" | "Good" | "Excellent";
  reasons: string[];
};

function bell(value: number, ideal: number, width: number) {
  return Math.max(0, 1 - Math.abs(value - ideal) / width);
}

export function scoreSky(input: SkyInputs): SkyScore {
  let score = 50;
  const reasons: string[] = [];

  const highBonus = bell(input.highCloud, 45, 35) * 25;
  const midBonus = bell(input.midCloud, 35, 30) * 15;
  score += highBonus + midBonus;

  if (input.highCloud >= 25 && input.highCloud <= 70) {
    reasons.push("High cloud may catch warm colour after the sun reaches the horizon.");
  }

  if (input.midCloud >= 15 && input.midCloud <= 60) {
    reasons.push("Mid-level cloud can add texture and depth.");
  }

  if (input.lowCloud > 25) {
    const lowPenalty = (input.lowCloud - 25) * 0.45;
    score -= lowPenalty;
    reasons.push("Low cloud may block the horizon.");
  } else {
    reasons.push("The lower sky is relatively open.");
  }

  if (input.precipitation > 0) {
    score -= Math.min(20, input.precipitation * 12);
    reasons.push("Precipitation reduces the chance of a clear view.");
  }

  score += Math.min(10, input.visibilityKm / 4);
  if (input.visibilityKm >= 20) {
    reasons.push("Good visibility supports cleaner horizon light.");
  }

  if (input.humidity > 90) {
    score -= 8;
    reasons.push("Very high humidity may indicate haze or mist.");
  }

  const finalScore = Math.round(Math.max(0, Math.min(100, score)));
  const label = finalScore >= 80 ? "Excellent" : finalScore >= 65 ? "Good" : finalScore >= 45 ? "Fair" : "Poor";

  return { score: finalScore, label, reasons };
}
