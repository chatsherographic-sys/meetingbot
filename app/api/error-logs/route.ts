import { NextResponse } from "next/server";
import { clearErrorLogs, deleteErrorLog, listErrorLogs } from "@/lib/store";

function isValidDeletePassword(value: unknown): boolean {
  const configuredPassword = process.env.ERROR_LOG_DELETE_PASSWORD?.trim() || "Chatshero";
  return typeof value === "string" && value === configuredPassword;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const errorLogs = await listErrorLogs({
      sessionId: searchParams.get("sessionId")?.trim() || undefined,
      page: Number(searchParams.get("page") ?? 1),
      pageSize: Number(searchParams.get("pageSize") ?? 50),
    });
    return NextResponse.json({ errorLogs: errorLogs.items, pagination: errorLogs.pagination });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load error logs.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as {
      password?: string;
      id?: string;
      sessionId?: string;
      clearAll?: boolean;
    };

    if (!isValidDeletePassword(body.password)) {
      return NextResponse.json({ error: "Incorrect delete password." }, { status: 401 });
    }

    if (body.clearAll === true) {
      await clearErrorLogs(body.sessionId?.trim() || undefined);
    } else if (body.id?.trim()) {
      await deleteErrorLog(body.id.trim());
    } else {
      return NextResponse.json({ error: "Error log ID is required." }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete error log.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
