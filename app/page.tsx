"use client";

import { FormEvent, useState } from "react";

type Place = {
  id: number;
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
};

type EventForecast = {
  time: string;
  score: { score: number; label: string; reasons: string[] };
  conditions: {
    lowCloud: number;
    midCloud: number;
    highCloud: number;
    precipitation: number;
    visibilityKm: number;
    humidity: number;
  };
};

type ForecastDay = {
  date: string;
  sunrise: EventForecast;
  sunset: EventForecast;
};

export default function Home() {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [selected, setSelected] = useState<Place | null>(null);
  const [days, setDays] = useState<ForecastDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function search(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Search failed");
      setPlaces(data.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function loadForecast(place: Place) {
    setSelected(place);
    setPlaces([]);
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/forecast?lat=${place.latitude}&lon=${place.longitude}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Forecast failed");
      setDays(data.days ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Forecast failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">SUNSCAPE</p>
        <h1>Is the next sunrise or sunset worth going out for?</h1>
        <p className="lede">Free weather data, cloud-layer analysis and a simple 0–100 colour-potential score.</p>

        <form className="search" onSubmit={search}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search city or postcode"
            aria-label="Search city or postcode"
          />
          <button disabled={loading || query.trim().length < 2}>{loading ? "Loading…" : "Search"}</button>
        </form>

        {error && <p className="error">{error}</p>}

        {places.length > 0 && (
          <div className="results">
            {places.map((place) => (
              <button key={place.id} onClick={() => loadForecast(place)}>
                <strong>{place.name}</strong>
                <span>{[place.admin1, place.country].filter(Boolean).join(", ")}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {selected && (
        <section>
          <div className="section-head">
            <div>
              <p className="eyebrow">7-DAY OUTLOOK</p>
              <h2>{selected.name}</h2>
            </div>
            <p>{[selected.admin1, selected.country].filter(Boolean).join(", ")}</p>
          </div>

          <div className="grid">
            {days.map((day) => (
              <article className="day-card" key={day.date}>
                <h3>{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</h3>
                <ForecastCard title="Sunrise" forecast={day.sunrise} />
                <ForecastCard title="Sunset" forecast={day.sunset} />
              </article>
            ))}
          </div>
        </section>
      )}

      <footer>
        Weather and geocoding data: Open-Meteo. Scores are heuristic forecasts, not guarantees.
      </footer>
    </main>
  );
}

function ForecastCard({ title, forecast }: { title: string; forecast: EventForecast }) {
  const time = new Date(forecast.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="forecast-card">
      <div className="forecast-top">
        <div>
          <span>{title}</span>
          <strong>{time}</strong>
        </div>
        <div className="score">
          <strong>{forecast.score.score}</strong>
          <span>{forecast.score.label}</span>
        </div>
      </div>
      <div className="metrics">
        <span>Low cloud {Math.round(forecast.conditions.lowCloud)}%</span>
        <span>Mid {Math.round(forecast.conditions.midCloud)}%</span>
        <span>High {Math.round(forecast.conditions.highCloud)}%</span>
        <span>Visibility {forecast.conditions.visibilityKm} km</span>
      </div>
      <p>{forecast.score.reasons[0]}</p>
    </div>
  );
}
