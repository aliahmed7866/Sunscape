# Sunscape

Sunscape predicts whether an upcoming sunrise or sunset is likely to be visually interesting using free weather data.

## MVP

- City/postcode search via Open-Meteo Geocoding
- 7-day sunrise and sunset times
- Low, mid and high cloud analysis
- Visibility, humidity and precipitation inputs
- 0-100 heuristic colour-potential score
- Human-readable reason for the score
- No API key or database required

## Tech

- Next.js 14
- TypeScript
- Open-Meteo Geocoding API
- Open-Meteo Forecast API

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## How the score works

The first version is intentionally heuristic rather than machine learning. It rewards useful mid/high cloud, penalizes excessive low cloud and precipitation, and adds a visibility bonus. Very high humidity receives a small penalty.

The scoring implementation is in `lib/scoring.ts` so it can be calibrated independently as real-world feedback is collected.

## Next steps

1. Score a weighted ±2 hour window instead of only the nearest forecast hour.
2. Sample cloud conditions toward the solar azimuth (west for sunset, east for sunrise).
3. Add ensemble forecasts to calculate prediction confidence.
4. Add golden-hour and twilight windows.
5. Store user ratings/photos to calibrate the scoring model.
6. Add automated tests and CI.

## Data attribution

Weather forecasts and location search are provided by Open-Meteo. Review Open-Meteo's attribution and licensing requirements before production or commercial use.

## Disclaimer

Sunscape scores estimate photographic potential from forecast conditions. Weather forecasts change and a high score is not a guarantee of a colourful sky.
