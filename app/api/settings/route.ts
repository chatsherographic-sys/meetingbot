import { NextResponse } from "next/server";
import { getAppSettings, updateAppSettings } from "@/lib/store";
import type { StorageLoggingMode } from "@/lib/types";

export async function GET() {
  const settings = await getAppSettings();
  return NextResponse.json(settings);
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      storageLoggingMode?: StorageLoggingMode;
    };

    const settings = await updateAppSettings({
      storageLoggingMode:
        body.storageLoggingMode === "debug" ||
        body.storageLoggingMode === "production_minimal"
          ? body.storageLoggingMode
          : undefined,
    });

    return NextResponse.json(settings);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update settings.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
