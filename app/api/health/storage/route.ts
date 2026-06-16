import { NextResponse } from "next/server";
import { getStorageHealth } from "@/lib/store";

export async function GET() {
  const health = await getStorageHealth();

  return NextResponse.json({
    storageDriver: health.storageDriver,
    ok: health.ok,
    currentTimestamp: health.checkedAt,
    error: health.error,
  });
}
