import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const personId = req.nextUrl.searchParams.get("personId");
    if (!personId) {
      return NextResponse.json({ error: "personId required" }, { status: 400 });
    }

    const conversations = await prisma.conversation.findMany({
      where: { personId },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { id: true, summary: true, createdAt: true },
    });

    return NextResponse.json(conversations);
  } catch (error) {
    console.error("GET /api/conversations error:", error);
    return NextResponse.json(
      { error: "Failed to fetch conversations" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const personId = typeof body.personId === "string" ? body.personId : "";
    const transcript =
      typeof body.transcript === "string" ? body.transcript.trim() : "";

    if (!personId || !transcript) {
      return NextResponse.json(
        { error: "Missing personId or transcript" },
        { status: 400 },
      );
    }

    const person = await prisma.person.findUnique({
      where: { id: personId },
      select: { name: true },
    });
    const personContext = person ? `The visitor's name is ${person.name}.` : "";

    let summary = transcript.slice(0, 300);

    try {
      const ollamaRes = await fetch("http://localhost:11434/api/generate", {
        signal: AbortSignal.timeout(5000),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama3.2:latest",
          prompt: [
            "You are writing a short memory summary for the patient.",
            personContext,
            "Write 1-2 plain sentences.",
            'Always write in second person, addressing the patient as "you" and "your".',
            'Never refer to the patient in third person (no "he", "she", or their name as subject).',
            "Refer to the visitor by name when known.",
            "Only include details explicitly mentioned in the transcript.",
            "Do not mention the transcript itself or add disclaimers.",
            'Example style: "You and James plan to go fishing tomorrow."',
            "",
            `Transcript: ${transcript}`,
          ].join("\n"),
          stream: false,
        }),
      });

      if (ollamaRes.ok) {
        const ollamaData = await ollamaRes.json();
        summary = ollamaData.response?.trim() || summary;
      }
    } catch {
      // Fallback summary is already prepared above.
    }

    const conversation = await prisma.conversation.create({
      data: { personId, transcript, summary },
    });

    return NextResponse.json(conversation, { status: 201 });
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

    console.error("POST /api/conversations error:", error);
    return NextResponse.json(
      { error: "Failed to save conversation" },
      { status: 500 },
    );
  }
}
