export type Place = {
  id: number;
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

export type Forecast = {
  latitude: number;
  longitude: number;
  timezone: string;
  hourly: {
    time: string[];
    cloud_cover_low: number[];
    cloud_cover_mid: number[];
    cloud_cover_high: number[];
    precipitation: number[];
    visibility: number[];
    relative_humidity_2m: number[];
  };
  daily: {
    time: string[];
    sunrise: string[];
    sunset: string[];
  };
};

export async function searchPlaces(query: string): Promise<Place[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "8");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetch(url, { next: { revalidate: 86400 } });
  if (!response.ok) throw new Error("Location search failed");
  const data = await response.json();
  return data.results ?? [];
}

export async function getForecast(latitude: number, longitude: number): Promise<Forecast> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set(
    "hourly",
    [
      "cloud_cover_low",
      "cloud_cover_mid",
      "cloud_cover_high",
      "precipitation",
      "visibility",
      "relative_humidity_2m",
    ].join(",")
  );
  url.searchParams.set("daily", "sunrise,sunset");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "7");

  const response = await fetch(url, { next: { revalidate: 900 } });
  if (!response.ok) throw new Error("Forecast request failed");
  return response.json();
}
