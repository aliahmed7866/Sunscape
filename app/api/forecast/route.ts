import { NextRequest, NextResponse } from "next/server";
import { getForecast } from "../../../lib/openMeteo";
import { scoreSky } from "../../../lib/scoring";

const WINDOW_HOURS = 2;

function weightedAverage(values: number[], indices: number[], centerMs: number, times: string[]) {
  let weighted = 0;
  let totalWeight = 0;
  for (const index of indices) {
    const diffHours = Math.abs(new Date(times[index]).getTime() - centerMs) / 3_600_000;
    const weight = Math.max(0.25, 1 - diffHours / (WINDOW_HOURS + 0.5));
    weighted += (values[index] ?? 0) * weight;
    totalWeight += weight;
  }
  return totalWeight ? weighted / totalWeight : 0;
}

function eventWindow(times: string[], target: string) {
  const centerMs = new Date(target).getTime();
  const maxDiff = WINDOW_HOURS * 3_600_000;
  const indices = times
    .map((time, index) => ({ index, diff: Math.abs(new Date(time).getTime() - centerMs) }))
    .filter(({ diff }) => diff <= maxDiff)
    .map(({ index }) => index);

  if (indices.length > 0) return { centerMs, indices };

  let nearest = 0;
  let nearestDiff = Number.POSITIVE_INFINITY;
  times.forEach((time, index) => {
    const diff = Math.abs(new Date(time).getTime() - centerMs);
    if (diff < nearestDiff) {
      nearest = index;
      nearestDiff = diff;
    }
  });
  return { centerMs, indices: [nearest] };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const latitude = Number(searchParams.get("lat"));
  const longitude = Number(searchParams.get("lon"));

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json({ error: "Valid lat and lon are required" }, { status: 400 });
  }

  try {
    const forecast = await getForecast(latitude, longitude);
    const days = forecast.daily.time.map((date, dayIndex) => {
      const makeEvent = (type: "sunrise" | "sunset") => {
        const eventTime = forecast.daily[type][dayIndex];
        const { centerMs, indices } = eventWindow(forecast.hourly.time, eventTime);
        const avg = (values: number[]) => weightedAverage(values, indices, centerMs, forecast.hourly.time);

        const conditions = {
          lowCloud: avg(forecast.hourly.cloud_cover_low),
          midCloud: avg(forecast.hourly.cloud_cover_mid),
          highCloud: avg(forecast.hourly.cloud_cover_high),
          precipitation: avg(forecast.hourly.precipitation),
          visibilityKm: avg(forecast.hourly.visibility) / 1000,
          humidity: avg(forecast.hourly.relative_humidity_2m),
        };

        const score = scoreSky(conditions);

        return {
          type,
          time: eventTime,
          score,
          conditions: {
            lowCloud: Math.round(conditions.lowCloud * 10) / 10,
            midCloud: Math.round(conditions.midCloud * 10) / 10,
            highCloud: Math.round(conditions.highCloud * 10) / 10,
            precipitation: Math.round(conditions.precipitation * 10) / 10,
            visibilityKm: Math.round(conditions.visibilityKm * 10) / 10,
            humidity: Math.round(conditions.humidity * 10) / 10,
          },
          windowHours: WINDOW_HOURS,
        };
      };

      return { date, sunrise: makeEvent("sunrise"), sunset: makeEvent("sunset") };
    });

    return NextResponse.json({ timezone: forecast.timezone, days });
  } catch (error) {
    console.error("Forecast request failed", error);
    return NextResponse.json({ error: "Unable to load forecast right now" }, { status: 502 });
  }
}
