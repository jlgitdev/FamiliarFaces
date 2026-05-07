import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function isEmbedding(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function parseStoredEmbedding(embedding: string) {
  return JSON.parse(embedding) as number[];
}

export async function GET(req: NextRequest) {
  try {
    const compact = req.nextUrl.searchParams.get("compact") === "true";

    if (compact) {
      const embeddings = await prisma.faceEmbedding.findMany({
        select: {
          personId: true,
          embedding: true,
        },
      });

      return NextResponse.json(
        embeddings.map((record) => ({
          personId: record.personId,
          embedding: parseStoredEmbedding(record.embedding),
        })),
      );
    }

    const embeddings = await prisma.faceEmbedding.findMany({
      include: {
        person: {
          select: { name: true },
        },
      },
    });

    return NextResponse.json(
      embeddings.map((embedding) => ({
        id: embedding.id,
        personId: embedding.personId,
        personName: embedding.person.name,
        embedding: parseStoredEmbedding(embedding.embedding),
      })),
    );
  } catch (error) {
    console.error("GET /api/embeddings error:", error);
    return NextResponse.json(
      { error: "Failed to fetch embeddings" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { personId, embedding } = body;

    if (typeof personId !== "string" || !personId || !isEmbedding(embedding)) {
      return NextResponse.json(
        { error: "Missing or invalid personId or embedding" },
        { status: 400 },
      );
    }

    const record = await prisma.faceEmbedding.create({
      data: {
        personId,
        embedding: JSON.stringify(embedding),
      },
    });

    await prisma.person.update({
      where: { id: personId },
      data: { lastSeen: new Date() },
    });

    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }

    console.error("POST /api/embeddings error:", error);
    return NextResponse.json(
      { error: "Failed to save embedding" },
      { status: 500 },
    );
  }
}
