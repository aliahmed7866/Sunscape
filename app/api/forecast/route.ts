import { NextRequest, NextResponse } from "next/server";
import { getForecast } from "../../../lib/openMeteo";
import { scoreSky } from "../../../lib/scoring";

function nearestHourIndex(times: string[], target: string) {
  const targetMs = new Date(target).getTime();
  let best = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  times.forEach((time, index) => {
    const diff = Math.abs(new Date(time).getTime() - targetMs);
    if (diff < bestDiff) {
      best = index;
      bestDiff = diff;
    }
  });
  return best;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const latitude = Number(searchParams.get("lat"));
  const longitude = Number(searchParams.get("lon"));

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json({ error: "Valid lat and lon are required" }, { status: 400 });
  }

  const forecast = await getForecast(latitude, longitude);
  const days = forecast.daily.time.map((date, dayIndex) => {
    const makeEvent = (type: "sunrise" | "sunset") => {
      const eventTime = forecast.daily[type][dayIndex];
      const index = nearestHourIndex(forecast.hourly.time, eventTime);
      const score = scoreSky({
        lowCloud: forecast.hourly.cloud_cover_low[index] ?? 0,
        midCloud: forecast.hourly.cloud_cover_mid[index] ?? 0,
        highCloud: forecast.hourly.cloud_cover_high[index] ?? 0,
        precipitation: forecast.hourly.precipitation[index] ?? 0,
        visibilityKm: (forecast.hourly.visibility[index] ?? 0) / 1000,
        humidity: forecast.hourly.relative_humidity_2m[index] ?? 0,
      });

      return {
        type,
        time: eventTime,
        score,
        conditions: {
          lowCloud: forecast.hourly.cloud_cover_low[index] ?? 0,
          midCloud: forecast.hourly.cloud_cover_mid[index] ?? 0,
          highCloud: forecast.hourly.cloud_cover_high[index] ?? 0,
          precipitation: forecast.hourly.precipitation[index] ?? 0,
          visibilityKm: Math.round(((forecast.hourly.visibility[index] ?? 0) / 1000) * 10) / 10,
          humidity: forecast.hourly.relative_humidity_2m[index] ?? 0,
        },
      };
    };

    return { date, sunrise: makeEvent("sunrise"), sunset: makeEvent("sunset") };
  });

  return NextResponse.json({ timezone: forecast.timezone, days });
}
