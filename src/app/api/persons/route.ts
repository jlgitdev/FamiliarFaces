import { NextRequest, NextResponse } from "next/server";
import { readPersonPayload } from "@/lib/personPayload";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const persons = await prisma.person.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        relationship: true,
        bio: true,
        recentTopics: true,
        lastSeen: true,
        _count: {
          select: { embeddings: true },
        },
      },
    });

    return NextResponse.json(
      persons.map(({ _count, ...person }) => ({
        ...person,
        embeddingCount: _count.embeddings,
      })),
    );
  } catch (error) {
    console.error("GET /api/persons error:", error);
    return NextResponse.json(
      { error: "Failed to fetch persons" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const personData = readPersonPayload(await req.json());

    if (!personData) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const person = await prisma.person.create({
      data: {
        ...personData,
        lastSeen: null,
      },
    });

    return NextResponse.json(person, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    console.error("POST /api/persons error:", error);
    return NextResponse.json(
      { error: "Failed to create person" },
      { status: 500 },
    );
  }
}
