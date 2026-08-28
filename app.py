from __future__ import annotations

import math
import os
from datetime import datetime
from typing import Any

import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

WINDOW_HOURS = 2
HTTP_TIMEOUT = 15
OPEN_METEO_GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"


def bell(value: float, ideal: float, width: float) -> float:
    return max(0.0, 1 - abs(value - ideal) / width)


def score_sky(conditions: dict[str, float]) -> dict[str, Any]:
    score = 50.0
    reasons: list[str] = []

    high_cloud = conditions["highCloud"]
    mid_cloud = conditions["midCloud"]
    low_cloud = conditions["lowCloud"]
    precipitation = conditions["precipitation"]
    visibility_km = conditions["visibilityKm"]
    humidity = conditions["humidity"]

    score += bell(high_cloud, 45, 35) * 25
    score += bell(mid_cloud, 35, 30) * 15

    if 25 <= high_cloud <= 70:
        reasons.append("High cloud may catch warm colour after the sun reaches the horizon.")

    if 15 <= mid_cloud <= 60:
        reasons.append("Mid-level cloud can add texture and depth.")

    if low_cloud > 25:
        score -= (low_cloud - 25) * 0.45
        reasons.append("Low cloud may block the horizon.")
    else:
        reasons.append("The lower sky is relatively open.")

    if precipitation > 0:
        score -= min(20, precipitation * 12)
        reasons.append("Precipitation reduces the chance of a clear view.")

    score += min(10, visibility_km / 4)
    if visibility_km >= 20:
        reasons.append("Good visibility supports cleaner horizon light.")

    if humidity > 90:
        score -= 8
        reasons.append("Very high humidity may indicate haze or mist.")

    final_score = round(max(0, min(100, score)))
    label = "Excellent" if final_score >= 80 else "Good" if final_score >= 65 else "Fair" if final_score >= 45 else "Poor"

    return {"score": final_score, "label": label, "reasons": reasons}


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value)


def event_window(times: list[str], target: str) -> tuple[datetime, list[int]]:
    center = parse_time(target)
    max_diff_seconds = WINDOW_HOURS * 3600
    indices = [
        index
        for index, time_value in enumerate(times)
        if abs((parse_time(time_value) - center).total_seconds()) <= max_diff_seconds
    ]

    if indices:
        return center, indices

    nearest = min(
        range(len(times)),
        key=lambda index: abs((parse_time(times[index]) - center).total_seconds()),
    )
    return center, [nearest]


def weighted_average(values: list[float], indices: list[int], center: datetime, times: list[str]) -> float:
    weighted = 0.0
    total_weight = 0.0

    for index in indices:
        diff_hours = abs((parse_time(times[index]) - center).total_seconds()) / 3600
        weight = max(0.25, 1 - diff_hours / (WINDOW_HOURS + 0.5))
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


def get_forecast(latitude: float, longitude: float) -> dict[str, Any]:
    response = requests.get(
        OPEN_METEO_FORECAST_URL,
        params={
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
            "daily": "sunrise,sunset",
            "timezone": "auto",
            "forecast_days": 7,
        },
        timeout=HTTP_TIMEOUT,
    )
    response.raise_for_status()
    return response.json()


def make_event(forecast: dict[str, Any], day_index: int, event_type: str) -> dict[str, Any]:
    event_time = forecast["daily"][event_type][day_index]
    times = forecast["hourly"]["time"]
    center, indices = event_window(times, event_time)

    def avg(key: str) -> float:
        return weighted_average(forecast["hourly"][key], indices, center, times)

    conditions = {
        "lowCloud": avg("cloud_cover_low"),
        "midCloud": avg("cloud_cover_mid"),
        "highCloud": avg("cloud_cover_high"),
        "precipitation": avg("precipitation"),
        "visibilityKm": avg("visibility") / 1000,
        "humidity": avg("relative_humidity_2m"),
    }

    rounded_conditions = {key: round(value, 1) for key, value in conditions.items()}
    return {
        "type": event_type,
        "time": event_time,
        "score": score_sky(conditions),
        "conditions": rounded_conditions,
        "windowHours": WINDOW_HOURS,
    }


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "sunscape"})


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
    except (TypeError, ValueError):
        return jsonify({"error": "Valid lat and lon are required"}), 400

    if not math.isfinite(latitude) or not math.isfinite(longitude):
        return jsonify({"error": "Valid lat and lon are required"}), 400

    try:
        forecast = get_forecast(latitude, longitude)
        days = []
        for day_index, date in enumerate(forecast["daily"]["time"]):
            days.append(
                {
                    "date": date,
                    "sunrise": make_event(forecast, day_index, "sunrise"),
                    "sunset": make_event(forecast, day_index, "sunset"),
                }
            )
        return jsonify({"timezone": forecast.get("timezone"), "days": days})
    except (requests.RequestException, KeyError, IndexError, ValueError):
        app.logger.exception("Forecast request failed")
        return jsonify({"error": "Unable to load forecast right now"}), 502


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG") == "1")
