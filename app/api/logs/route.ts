import { NextResponse } from "next/server";
import { getLogs } from "@/lib/store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const logs = await getLogs(searchParams.get("sessionId") ?? undefined);
  return NextResponse.json(logs);
}
