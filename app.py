from __future__ import annotations

import math
import os
from bisect import bisect_left
from datetime import datetime
from statistics import median
from typing import Any

import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

WINDOW_HOURS = 3
HISTORY_DAYS = 60
FORECAST_DAYS = 7
HTTP_TIMEOUT = 15
OPEN_METEO_GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"


def bell(value: float, ideal: float, width: float) -> float:
    return max(0.0, 1 - abs(value - ideal) / width)


def score_sky(conditions: dict[str, float]) -> dict[str, Any]:
    """Estimate visual sunrise/sunset potential from physically relevant sky signals.

    This is intentionally a heuristic rather than a claim of photographic certainty.
    High/mid cloud can catch low-angle light, low cloud can hide the horizon, and
    clean/visible lower air generally supports stronger colour transmission.
    """
    score = 46.0
    reasons: list[str] = []

    high_cloud = conditions["highCloud"]
    mid_cloud = conditions["midCloud"]
    low_cloud = conditions["lowCloud"]
    precipitation = conditions["precipitation"]
    visibility_km = conditions["visibilityKm"]
    humidity = conditions["humidity"]

    score += bell(high_cloud, 45, 38) * 27
    score += bell(mid_cloud, 34, 32) * 17

    if 20 <= high_cloud <= 72:
        reasons.append("High cloud is well placed to catch low-angle colour.")
    elif high_cloud < 12:
        reasons.append("Very little high cloud may limit reflected colour after the sun reaches the horizon.")

    if 12 <= mid_cloud <= 62:
        reasons.append("Mid-level cloud can add texture and layered colour.")

    if low_cloud > 22:
        score -= min(30, (low_cloud - 22) * 0.58)
        reasons.append("Low cloud may obscure the horizon and mute direct colour.")
    else:
        score += 5
        reasons.append("The lower horizon is forecast to stay relatively open.")

    if precipitation > 0:
        score -= min(22, precipitation * 13)
        reasons.append("Precipitation near the event lowers viewing confidence.")

    score += min(11, max(0, visibility_km - 4) / 3.2)
    if visibility_km >= 20:
        reasons.append("Good visibility favours a cleaner lower atmosphere.")
    elif visibility_km < 8:
        score -= 8
        reasons.append("Reduced visibility suggests haze, mist or precipitation may soften colour.")

    if humidity > 94:
        score -= 10
        reasons.append("Very high humidity increases the risk of haze or mist near the horizon.")
    elif humidity < 82:
        score += 3

    final_score = round(max(0, min(100, score)))
    label = "Excellent" if final_score >= 80 else "Good" if final_score >= 65 else "Fair" if final_score >= 45 else "Poor"

    return {"score": final_score, "label": label, "reasons": reasons}


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value)


def event_indices(times: list[str], target: str) -> tuple[datetime, list[int]]:
    """Return only the nearby hourly samples using the sorted ISO timestamp array."""
    center = parse_time(target)
    insertion = bisect_left(times, target)
    start = max(0, insertion - WINDOW_HOURS - 2)
    end = min(len(times), insertion + WINDOW_HOURS + 2)
    max_diff_seconds = WINDOW_HOURS * 3600
    indices = [
        index
        for index in range(start, end)
        if abs((parse_time(times[index]) - center).total_seconds()) <= max_diff_seconds
    ]

    if indices:
        return center, indices

    nearest = min(
        range(start, end),
        key=lambda index: abs((parse_time(times[index]) - center).total_seconds()),
    )
    return center, [nearest]


def phase_weighted_average(
    values: list[float],
    indices: list[int],
    center: datetime,
    times: list[str],
    preferred_offset_hours: float,
    width_hours: float,
) -> float:
    weighted = 0.0
    total_weight = 0.0

    for index in indices:
        offset_hours = (parse_time(times[index]) - center).total_seconds() / 3600
        distance = abs(offset_hours - preferred_offset_hours)
        weight = max(0.08, 1 - distance / width_hours)
        value = values[index] if index < len(values) and values[index] is not None else 0
        weighted += float(value) * weight
        total_weight += weight

    return weighted / total_weight if total_weight else 0.0


def search_places(query: str) -> list[dict[str, Any]]:
    response = requests.get(
        OPEN_METEO_GEOCODING_URL,
        params={"name": query, "count": 8, "language": "en", "format": "json"},
        timeout=HTTP_TIMEOUT,
    )
    response.raise_for_status()
    return response.json().get("results", [])


def get_forecast(latitude: float, longitude: float, elevation: float | None = None) -> dict[str, Any]:
    params: dict[str, Any] = {
        "latitude": latitude,
        "longitude": longitude,
        "hourly": ",".join(
            [
                "cloud_cover_low",
                "cloud_cover_mid",
                "cloud_cover_high",
                "precipitation",
                "visibility",
                "relative_humidity_2m",
            ]
        ),
        "daily": "sunrise,sunset,daylight_duration",
        "timezone": "auto",
        "past_days": HISTORY_DAYS,
        "forecast_days": FORECAST_DAYS,
    }
    if elevation is not None and math.isfinite(elevation):
        params["elevation"] = elevation

    response = requests.get(OPEN_METEO_FORECAST_URL, params=params, timeout=HTTP_TIMEOUT)
    response.raise_for_status()
    return response.json()


def make_event(forecast: dict[str, Any], day_index: int, event_type: str) -> dict[str, Any]:
    event_time = forecast["daily"][event_type][day_index]
    times = forecast["hourly"]["time"]
    center, indices = event_indices(times, event_time)
    direction = 1 if event_type == "sunset" else -1

    def avg(key: str, offset: float = 0.0, width: float = 2.0) -> float:
        return phase_weighted_average(forecast["hourly"][key], indices, center, times, offset, width)

    conditions = {
        # Horizon-blocking cloud matters most right at the event.
        "lowCloud": avg("cloud_cover_low", 0.0, 1.25),
        # Mid/high cloud catches colour slightly after sunset and before sunrise.
        "midCloud": avg("cloud_cover_mid", 0.35 * direction, 1.75),
        "highCloud": avg("cloud_cover_high", 0.75 * direction, 2.1),
        "precipitation": avg("precipitation", 0.0, 1.5),
        "visibilityKm": avg("visibility", 0.0, 1.8) / 1000,
        "humidity": avg("relative_humidity_2m", 0.0, 1.8),
    }

    rounded_conditions = {key: round(value, 1) for key, value in conditions.items()}
    return {
        "type": event_type,
        "time": event_time,
        "score": score_sky(conditions),
        "conditions": rounded_conditions,
        "windowHours": WINDOW_HOURS,
    }


def history_summary(scores: list[int], current_score: int) -> dict[str, Any]:
    if not scores:
        return {"sampleDays": 0, "median": None, "percentile": None}

    less_or_equal = sum(1 for value in scores if value <= current_score)
    percentile = round(100 * less_or_equal / len(scores))
    return {
        "sampleDays": len(scores),
        "median": round(median(scores)),
        "percentile": percentile,
    }


def confidence_for_day(day_index: int) -> dict[str, str]:
    if day_index <= 2:
        return {"label": "High", "detail": "Near-term forecast"}
    if day_index <= 4:
        return {"label": "Medium", "detail": "Forecast uncertainty increasing"}
    return {"label": "Lower", "detail": "Treat as an early trend"}


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "sunscape", "port": int(os.environ.get("PORT", "8081"))})


@app.get("/api/search")
def api_search():
    query = (request.args.get("q") or "").strip()
    if len(query) < 2:
        return jsonify({"results": []})

    try:
        return jsonify({"results": search_places(query)})
    except requests.RequestException:
        app.logger.exception("Location search failed")
        return jsonify({"error": "Location search failed"}), 502


@app.get("/api/forecast")
def api_forecast():
    try:
        latitude = float(request.args.get("lat", ""))
        longitude = float(request.args.get("lon", ""))
        raw_elevation = request.args.get("elevation")
        elevation = float(raw_elevation) if raw_elevation not in (None, "") else None
    except (TypeError, ValueError):
        return jsonify({"error": "Valid lat and lon are required"}), 400

    if not math.isfinite(latitude) or not math.isfinite(longitude):
        return jsonify({"error": "Valid lat and lon are required"}), 400

    try:
        forecast = get_forecast(latitude, longitude, elevation)
        daily_dates = forecast["daily"]["time"]
        future_start = min(HISTORY_DAYS, max(0, len(daily_dates) - FORECAST_DAYS))

        historical_scores: dict[str, list[int]] = {"sunrise": [], "sunset": []}
        for day_index in range(future_start):
            for event_type in ("sunrise", "sunset"):
                historical_scores[event_type].append(make_event(forecast, day_index, event_type)["score"]["score"])

        days = []
        for relative_index, day_index in enumerate(range(future_start, len(daily_dates))):
            date = daily_dates[day_index]
            sunrise = make_event(forecast, day_index, "sunrise")
            sunset = make_event(forecast, day_index, "sunset")

            for event_type, event in (("sunrise", sunrise), ("sunset", sunset)):
                event["history"] = history_summary(historical_scores[event_type], event["score"]["score"])
                event["confidence"] = confidence_for_day(relative_index)

            days.append(
                {
                    "date": date,
                    "daylightSeconds": forecast["daily"].get("daylight_duration", [None] * len(daily_dates))[day_index],
                    "sunrise": sunrise,
                    "sunset": sunset,
                }
            )

        return jsonify(
            {
                "timezone": forecast.get("timezone"),
                "timezoneAbbreviation": forecast.get("timezone_abbreviation"),
                "elevation": forecast.get("elevation"),
                "historyDays": future_start,
                "days": days,
                "method": "phase-weighted cloud layers + visibility/humidity + recent local historical context",
            }
        )
    except (requests.RequestException, KeyError, IndexError, ValueError):
        app.logger.exception("Forecast request failed")
        return jsonify({"error": "Unable to load forecast right now"}), 502


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8081"))
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=port, debug=os.environ.get("FLASK_DEBUG") == "1")
