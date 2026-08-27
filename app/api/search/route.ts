import { NextRequest, NextResponse } from "next/server";
import { searchPlaces } from "../../../lib/openMeteo";

export async function GET(request: NextRequest) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await searchPlaces(query);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "Location search failed" }, { status: 502 });
  }
}
