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
APP_BUILD = "2026.08.29.4"
OPEN_METEO_GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"


@app.after_request
def prevent_mixed_asset_versions(response):
    if request.path == "/" or request.path.startswith("/static/") or request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    response.headers["X-Sunscape-Build"] = APP_BUILD
    return response


def bell(value: float, ideal: float, width: float) -> float:
    return max(0.0, 1 - abs(value - ideal) / width)


def score_sky(conditions: dict[str, float]) -> dict[str, Any]:
    """Estimate sunrise/sunset colour potential from a phase-aware atmosphere profile.

    This remains a forecast heuristic: weather models cannot know the exact visual
    outcome at a specific horizon. The model rewards an open lower horizon plus
    illuminated mid/high cloud, and penalises precipitation, fog/haze risk and
    excessive low cloud. Pressure-level cloud fields add vertical detail beyond
    the broad low/mid/high buckets.
    """
    score = 40.0
    reasons: list[str] = []

    high_cloud = conditions["highCloud"]
    mid_cloud = conditions["midCloud"]
    low_cloud = conditions["lowCloud"]
    precipitation = conditions["precipitation"]
    visibility_km = conditions["visibilityKm"]
    humidity = conditions["humidity"]
    dewpoint_spread = conditions.get("dewpointSpread", 6.0)
    cloud_850 = conditions.get("cloud850", low_cloud)
    cloud_700 = conditions.get("cloud700", mid_cloud)
    cloud_500 = conditions.get("cloud500", mid_cloud)
    cloud_300 = conditions.get("cloud300", high_cloud)
    wind_speed = conditions.get("windSpeed", 10.0)

    # Colour-bearing cloud: enough cloud to catch light, but not an opaque deck.
    score += bell(high_cloud, 43, 40) * 23
    score += bell(mid_cloud, 32, 34) * 14

    # Pressure-level profile helps distinguish a layered sky from one broad bucket.
    upper_texture = (cloud_500 + cloud_300) / 2
    middle_texture = (cloud_700 + cloud_500) / 2
    score += bell(upper_texture, 38, 36) * 7
    score += bell(middle_texture, 30, 34) * 4

    if 18 <= high_cloud <= 74 or 15 <= upper_texture <= 70:
        reasons.append("Upper-level cloud is positioned to catch low-angle colour.")
    elif high_cloud < 10 and upper_texture < 10:
        reasons.append("Very little upper cloud may limit reflected colour away from the horizon.")

    if 10 <= mid_cloud <= 60 or 10 <= middle_texture <= 60:
        reasons.append("Mid-level texture could add depth to the colour band.")

    # Horizon obstruction is the strongest negative signal.
    horizon_cloud = max(low_cloud, cloud_850 * 0.8)
    if horizon_cloud <= 15:
        score += 10
        reasons.append("The lower horizon is forecast to stay unusually open.")
    elif horizon_cloud <= 28:
        score += 5
        reasons.append("The lower horizon should remain fairly open.")
    else:
        score -= min(34, (horizon_cloud - 28) * 0.62)
        reasons.append("Low cloud may block the horizon and mute direct colour.")

    if precipitation > 0:
        score -= min(24, precipitation * 14)
        reasons.append("Precipitation near the event lowers viewing confidence.")

    # Visibility and temperature/dew-point spread jointly capture mist/haze risk.
    if visibility_km >= 24:
        score += 10
        reasons.append("Excellent visibility favours a cleaner lower atmosphere.")
    elif visibility_km >= 12:
        score += 6
    elif visibility_km < 7:
        score -= 10
        reasons.append("Reduced visibility suggests haze, mist or precipitation may soften colour.")

    if dewpoint_spread <= 1.5:
        score -= 12
        reasons.append("Air is close to saturation, increasing fog or low-mist risk.")
    elif dewpoint_spread <= 3:
        score -= 5
    elif dewpoint_spread >= 6 and humidity < 88:
        score += 4

    if humidity > 95:
        score -= 8
    elif humidity < 78:
        score += 2

    # Strong surface wind can make a local cloud forecast less stable near the event.
    if wind_speed > 48:
        score -= 4
        reasons.append("Strong wind makes local cloud timing less stable.")

    final_score = round(max(0, min(100, score)))
    label = "Excellent" if final_score >= 80 else "Good" if final_score >= 65 else "Fair" if final_score >= 45 else "Poor"
    return {"score": final_score, "label": label, "reasons": reasons}


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value)


def event_indices(times: list[str], target: str) -> tuple[datetime, list[int]]:
    center = parse_time(target)
    insertion = bisect_left(times, target)
    start = max(0, insertion - WINDOW_HOURS - 2)
    end = min(len(times), insertion + WINDOW_HOURS + 2)
    max_diff_seconds = WINDOW_HOURS * 3600
    indices = [index for index in range(start, end) if abs((parse_time(times[index]) - center).total_seconds()) <= max_diff_seconds]
    if indices:
        return center, indices
    nearest = min(range(start, end), key=lambda index: abs((parse_time(times[index]) - center).total_seconds()))
    return center, [nearest]


def phase_weighted_average(
    values: list[float] | None,
    indices: list[int],
    center: datetime,
    times: list[str],
    preferred_offset_hours: float,
    width_hours: float,
    fallback: float = 0.0,
) -> float:
    if not values:
        return fallback
    weighted = 0.0
    total_weight = 0.0
    for index in indices:
        offset_hours = (parse_time(times[index]) - center).total_seconds() / 3600
        distance = abs(offset_hours - preferred_offset_hours)
        weight = max(0.08, 1 - distance / width_hours)
        raw = values[index] if index < len(values) else None
        value = fallback if raw is None else float(raw)
        weighted += value * weight
        total_weight += weight
    return weighted / total_weight if total_weight else fallback


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
                "temperature_2m",
                "dew_point_2m",
                "relative_humidity_2m",
                "cloud_cover",
                "cloud_cover_low",
                "cloud_cover_mid",
                "cloud_cover_high",
                "cloud_cover_850hPa",
                "cloud_cover_700hPa",
                "cloud_cover_500hPa",
                "cloud_cover_300hPa",
                "pressure_msl",
                "precipitation",
                "visibility",
                "wind_speed_10m",
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
    hourly = forecast["hourly"]
    times = hourly["time"]
    center, indices = event_indices(times, event_time)
    direction = 1 if event_type == "sunset" else -1

    def avg(key: str, offset: float = 0.0, width: float = 2.0, fallback: float = 0.0) -> float:
        return phase_weighted_average(hourly.get(key), indices, center, times, offset, width, fallback)

    low_cloud = avg("cloud_cover_low", 0.0, 1.25)
    mid_cloud = avg("cloud_cover_mid", 0.35 * direction, 1.75)
    high_cloud = avg("cloud_cover_high", 0.75 * direction, 2.1)
    temperature = avg("temperature_2m", 0.0, 1.4)
    dewpoint = avg("dew_point_2m", 0.0, 1.4, temperature - 5)

    conditions = {
        "totalCloud": avg("cloud_cover", 0.0, 1.7, max(low_cloud, mid_cloud, high_cloud)),
        "lowCloud": low_cloud,
        "midCloud": mid_cloud,
        "highCloud": high_cloud,
        "cloud850": avg("cloud_cover_850hPa", 0.0, 1.35, low_cloud),
        "cloud700": avg("cloud_cover_700hPa", 0.25 * direction, 1.7, mid_cloud),
        "cloud500": avg("cloud_cover_500hPa", 0.55 * direction, 2.0, mid_cloud),
        "cloud300": avg("cloud_cover_300hPa", 0.8 * direction, 2.2, high_cloud),
        "precipitation": avg("precipitation", 0.0, 1.5),
        "visibilityKm": avg("visibility", 0.0, 1.8) / 1000,
        "humidity": avg("relative_humidity_2m", 0.0, 1.8),
        "temperature": temperature,
        "dewPoint": dewpoint,
        "dewpointSpread": max(0.0, temperature - dewpoint),
        "pressureMsl": avg("pressure_msl", 0.0, 2.0),
        "windSpeed": avg("wind_speed_10m", 0.0, 1.8),
    }

    rounded_conditions = {key: round(value, 1) for key, value in conditions.items()}
    return {
        "type": event_type,
        "time": event_time,
        "score": score_sky(conditions),
        "conditions": rounded_conditions,
        "windowHours": WINDOW_HOURS,
        "profile": "pressure-level-v2",
    }


def history_summary(scores: list[int], current_score: int) -> dict[str, Any]:
    if not scores:
        return {"sampleDays": 0, "median": None, "percentile": None}
    less_or_equal = sum(1 for value in scores if value <= current_score)
    percentile = round(100 * less_or_equal / len(scores))
    return {"sampleDays": len(scores), "median": round(median(scores)), "percentile": percentile}


def confidence_for_day(day_index: int) -> dict[str, str]:
    if day_index <= 1:
        return {"label": "High", "detail": "Near-term model guidance"}
    if day_index <= 3:
        return {"label": "Medium-high", "detail": "Useful forecast signal"}
    if day_index <= 4:
        return {"label": "Medium", "detail": "Cloud timing uncertainty increasing"}
    return {"label": "Lower", "detail": "Treat as an early trend"}


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/service-worker.js")
def service_worker():
    response = app.send_static_file("service-worker.js")
    response.headers["Content-Type"] = "application/javascript"
    response.headers["Cache-Control"] = "no-cache"
    response.headers["Service-Worker-Allowed"] = "/"
    return response


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "sunscape", "port": int(os.environ.get("PORT", "8081")), "build": APP_BUILD})


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
            sunrise = make_event(forecast, day_index, "sunrise")
            sunset = make_event(forecast, day_index, "sunset")
            for event_type, event in (("sunrise", sunrise), ("sunset", sunset)):
                event["history"] = history_summary(historical_scores[event_type], event["score"]["score"])
                event["confidence"] = confidence_for_day(relative_index)
            days.append(
                {
                    "date": daily_dates[day_index],
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
                "method": "phase-aware low/mid/high cloud + pressure-level vertical profile + visibility + dew-point spread + precipitation",
                "modelStrategy": "Open-Meteo best-match high-resolution forecast",
                "build": APP_BUILD,
            }
        )
    except (requests.RequestException, KeyError, IndexError, ValueError):
        app.logger.exception("Forecast request failed")
        return jsonify({"error": "Unable to load forecast right now"}), 502


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8081"))
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=port, debug=os.environ.get("FLASK_DEBUG") == "1")
