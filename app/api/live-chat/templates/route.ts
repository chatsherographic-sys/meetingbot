import { NextResponse } from "next/server";
import {
  clearLiveChatTemplates,
  createLiveChatTemplate,
  listLiveChatTemplates,
} from "@/lib/store";
import type { LiveChatTemplate } from "@/lib/types";

type BulkTemplateCreateInput = {
  message?: string;
  botId?: string;
};

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return undefined;
  }

  return Math.floor(parsed);
}

function parseTemplateCount(value: unknown): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

function generateBulkTemplateNames(
  baseName: string,
  templateCount: number,
  existingNames: Set<string>,
): string[] {
  const trimmedBaseName = baseName.trim();

  if (!trimmedBaseName) {
    throw new Error("Template name is required.");
  }

  if (templateCount <= 1) {
    return [trimmedBaseName];
  }

  let startIndex = 1;

  while (startIndex <= 100000) {
    const candidateNames = Array.from({ length: templateCount }, (_, index) =>
      `${trimmedBaseName} ${startIndex + index}`,
    );

    const hasConflict = candidateNames.some((candidateName) =>
      existingNames.has(candidateName.toLowerCase()),
    );

    if (!hasConflict) {
      return candidateNames;
    }

    startIndex += 1;
  }

  throw new Error("Unable to generate unique template names.");
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = parsePositiveInteger(searchParams.get("page"));
  const pageSize = parsePositiveInteger(searchParams.get("pageSize"));
  const sessionId = searchParams.get("sessionId") ?? undefined;
  const templates = await listLiveChatTemplates({
    sessionId,
    page,
    pageSize,
  });

  return NextResponse.json({
    liveChatTemplates: templates.items,
    pagination: templates.pagination,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sessionId?: string;
      name?: string;
      message?: string;
      senderMode?: LiveChatTemplate["senderMode"];
      botIds?: string[];
      templateCount?: number;
      bulkTemplates?: BulkTemplateCreateInput[];
    };
    const templateCount = parseTemplateCount(body.templateCount);
    const senderMode =
      body.senderMode === "all_bots"
        ? "all_bots"
        : body.senderMode === "round_robin"
          ? "round_robin"
          : "selected_bots";
    const botIds = Array.isArray(body.botIds) ? body.botIds : [];

    if (templateCount === 1) {
      const template = await createLiveChatTemplate({
        sessionId: body.sessionId ?? "",
        name: body.name ?? "",
        message: body.message ?? "",
        senderMode,
        botIds,
      });

      return NextResponse.json({ liveChatTemplate: template }, { status: 201 });
    }

    const existingTemplates = await listLiveChatTemplates({
      sessionId: body.sessionId ?? "",
      pageSize: 1000,
    });
    const existingNames = new Set(
      existingTemplates.items.map((template) => template.name.trim().toLowerCase()),
    );
    const generatedNames = generateBulkTemplateNames(
      body.name ?? "",
      templateCount,
      existingNames,
    );
    const successfulTemplates: Array<{
      index: number;
      liveChatTemplate: LiveChatTemplate;
    }> = [];
    const failedAttempts: Array<{
      index: number;
      name: string;
      error: string;
    }> = [];
    const bulkTemplates = Array.isArray(body.bulkTemplates) ? body.bulkTemplates : [];

    if (bulkTemplates.length > 0 && bulkTemplates.length !== templateCount) {
      throw new Error("Bulk template row count does not match the requested quantity.");
    }

    for (const [index, generatedName] of generatedNames.entries()) {
      const bulkTemplate = bulkTemplates[index];

      try {
        const template = await createLiveChatTemplate({
          sessionId: body.sessionId ?? "",
          name: generatedName,
          message: bulkTemplate?.message ?? body.message ?? "",
          senderMode: bulkTemplate ? "selected_bots" : senderMode,
          botIds: bulkTemplate
            ? bulkTemplate.botId?.trim()
              ? [bulkTemplate.botId.trim()]
              : []
            : botIds,
        });

        successfulTemplates.push({
          index: index + 1,
          liveChatTemplate: template,
        });
        existingNames.add(generatedName.toLowerCase());
      } catch (error) {
        failedAttempts.push({
          index: index + 1,
          name: generatedName,
          error:
            error instanceof Error
              ? error.message
              : "Failed to create live chat template.",
        });
      }
    }

    if (successfulTemplates.length === 0) {
      return NextResponse.json(
        {
          error: "Failed to create live chat templates.",
          successfulTemplates,
          failedAttempts,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        successfulTemplates,
        failedAttempts,
      },
      { status: failedAttempts.length > 0 ? 207 : 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to create live chat template.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId")?.trim();

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required." },
        { status: 400 },
      );
    }

    await clearLiveChatTemplates(sessionId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to delete live chat templates.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
