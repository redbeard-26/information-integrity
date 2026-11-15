import { NextResponse } from "next/server";
import { searchOrganizations } from "@/lib/directory";

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const text = (key: string) => params.get(key) ?? undefined;
  const number = (key: string) => (params.has(key) ? Number(params.get(key)) : undefined);
  return NextResponse.json(
    searchOrganizations({
      query: text("q"),
      focus_area: text("focus_area"),
      region: text("region"),
      organization_type: text("organization_type"),
      status: text("status"),
      headquarters_country: text("headquarters_country"),
      method: text("method"),
      threat_actor: text("threat_actor"),
      limit: number("limit"),
      offset: number("offset"),
    }),
  );
}
