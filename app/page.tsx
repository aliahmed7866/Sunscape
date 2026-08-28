"use client";

import { FormEvent, useMemo, useState } from "react";

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
  const [activeDay, setActiveDay] = useState(0);
  const [activeEvent, setActiveEvent] = useState<"sunrise" | "sunset">("sunset");

  const featured = useMemo(() => {
    const day = days[activeDay];
    return day ? day[activeEvent] : null;
  }, [days, activeDay, activeEvent]);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
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
    setActiveDay(0);
    setActiveEvent("sunset");
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
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />

      <header className="topbar">
        <div className="brand"><span className="brand-orbit" />SUNSCAPE</div>
        <div className="status-pill"><span /> LIVE WEATHER MODEL</div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">ATMOSPHERIC LIGHT INTELLIGENCE</p>
          <h1>Know when the sky is <em>worth chasing.</em></h1>
          <p className="lede">Sunrise and sunset potential scored from cloud altitude, visibility, humidity and precipitation using free forecast data.</p>

          <form className="search" onSubmit={search}>
            <span className="search-icon">⌖</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search city or postcode"
              aria-label="Search city or postcode"
            />
            <button disabled={loading || query.trim().length < 2}>{loading ? "SCANNING" : "SCAN SKY"}</button>
          </form>

          {error && <p className="error">{error}</p>}
          {places.length > 0 && (
            <div className="results">
              {places.map((place) => (
                <button key={place.id} onClick={() => loadForecast(place)}>
                  <span><strong>{place.name}</strong><small>{[place.admin1, place.country].filter(Boolean).join(", ")}</small></span>
                  <b>→</b>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="planet">
            <div className="planet-glow" />
            <div className="horizon-line" />
            <span className="star s1" /><span className="star s2" /><span className="star s3" />
          </div>
          <div className="radar-ring ring-1" /><div className="radar-ring ring-2" /><div className="radar-ring ring-3" />
          <div className="telemetry t1">HIGH CLOUD · OPTIMAL</div>
          <div className="telemetry t2">SOLAR ANGLE · TRACKING</div>
        </div>
      </section>

      {selected && days.length > 0 && featured && (
        <section className="dashboard">
          <div className="section-head">
            <div>
              <p className="eyebrow">7-DAY SKY OUTLOOK</p>
              <h2>{selected.name}</h2>
              <p>{[selected.admin1, selected.country].filter(Boolean).join(", ")}</p>
            </div>
            <div className="event-toggle" role="group" aria-label="Choose sunrise or sunset">
              <button className={activeEvent === "sunrise" ? "active" : ""} onClick={() => setActiveEvent("sunrise")}>☼ Sunrise</button>
              <button className={activeEvent === "sunset" ? "active" : ""} onClick={() => setActiveEvent("sunset")}>◐ Sunset</button>
            </div>
          </div>

          <div className="featured-grid">
            <article className="hero-score panel">
              <div className="panel-kicker">{activeEvent.toUpperCase()} POTENTIAL</div>
              <ScoreOrb score={featured.score.score} label={featured.score.label} />
              <div className="event-time">{formatTime(featured.time)}</div>
              <p className="reason">{featured.score.reasons[0]}</p>
              <div className="signal-row"><span className="signal-dot" /> Forecast signal acquired</div>
            </article>

            <article className="panel atmosphere-panel">
              <div className="panel-head"><span>ATMOSPHERIC PROFILE</span><small>cloud layers</small></div>
              <CloudProfile forecast={featured} />
              <div className="environment-grid">
                <Metric label="Visibility" value={`${featured.conditions.visibilityKm} km`} />
                <Metric label="Humidity" value={`${Math.round(featured.conditions.humidity)}%`} />
                <Metric label="Precipitation" value={`${featured.conditions.precipitation.toFixed(1)} mm`} />
              </div>
            </article>
          </div>

          <div className="timeline panel">
            <div className="panel-head"><span>FORECAST TIMELINE</span><small>tap a day to inspect</small></div>
            <div className="day-strip">
              {days.map((day, index) => {
                const event = day[activeEvent];
                return (
                  <button className={index === activeDay ? "day active" : "day"} key={day.date} onClick={() => setActiveDay(index)}>
                    <span>{formatDay(day.date)}</span>
                    <strong>{event.score.score}</strong>
                    <ScoreMini score={event.score.score} />
                    <small>{formatTime(event.time)}</small>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="forecast-grid">
            {days.map((day) => (
              <article className="forecast-day panel" key={day.date}>
                <div className="forecast-date"><span>{formatDay(day.date)}</span><small>{formatDate(day.date)}</small></div>
                <CompactForecast title="Sunrise" icon="☼" forecast={day.sunrise} />
                <CompactForecast title="Sunset" icon="◐" forecast={day.sunset} />
              </article>
            ))}
          </div>
        </section>
      )}

      {!selected && (
        <section className="feature-teasers">
          <div><span>01</span><strong>Cloud layer analysis</strong><p>Low, mid and high cloud treated differently for colour potential.</p></div>
          <div><span>02</span><strong>Visibility signal</strong><p>Atmospheric clarity helps estimate whether colour can travel across the horizon.</p></div>
          <div><span>03</span><strong>Seven-day scan</strong><p>Compare upcoming dawns and dusks before deciding when to head out.</p></div>
        </section>
      )}

      <footer><span>SUNSCAPE / SKY MODEL V1</span><span>Powered by Open-Meteo · Predictions are heuristic</span></footer>
    </main>
  );
}

function ScoreOrb({ score, label }: { score: number; label: string }) {
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  return (
    <div className="score-orb">
      <svg viewBox="0 0 140 140" role="img" aria-label={`Score ${score} out of 100`}>
        <circle className="score-track" cx="70" cy="70" r={radius} />
        <circle className="score-progress" cx="70" cy="70" r={radius} strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <div className="score-core"><strong>{score}</strong><span>/100</span><small>{label}</small></div>
    </div>
  );
}

function ScoreMini({ score }: { score: number }) {
  return <span className="mini-track"><i style={{ width: `${score}%` }} /></span>;
}

function CloudProfile({ forecast }: { forecast: EventForecast }) {
  const layers = [
    ["HIGH", forecast.conditions.highCloud],
    ["MID", forecast.conditions.midCloud],
    ["LOW", forecast.conditions.lowCloud],
  ] as const;
  return (
    <div className="cloud-profile">
      {layers.map(([name, value]) => (
        <div className="cloud-layer" key={name}>
          <div className="layer-meta"><span>{name}</span><strong>{Math.round(value)}%</strong></div>
          <div className="layer-track"><span style={{ width: `${Math.max(2, value)}%` }} /></div>
        </div>
      ))}
      <div className="horizon-marker"><span>HORIZON</span></div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function CompactForecast({ title, icon, forecast }: { title: string; icon: string; forecast: EventForecast }) {
  return (
    <div className="compact-forecast">
      <div className="compact-main"><span className="event-icon">{icon}</span><div><small>{title}</small><strong>{formatTime(forecast.time)}</strong></div></div>
      <div className="compact-score"><strong>{forecast.score.score}</strong><span>{forecast.score.label}</span></div>
    </div>
  );
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDay(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
