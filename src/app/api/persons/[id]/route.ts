import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { readPersonUpdate } from "@/lib/personPayload";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.person.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/persons/[id] error:", error);

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json(
        { error: "Person not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { error: "Failed to delete person" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const text = await req.text();
    const body = text ? JSON.parse(text) : {};

    const data: Prisma.PersonUpdateInput = {
      lastSeen: new Date(),
      ...readPersonUpdate(body),
    };

    const person = await prisma.person.update({
      where: { id },
      data,
    });

    return NextResponse.json(person);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    console.error("PATCH /api/persons/[id] error:", error);

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json(
        { error: "Person not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { error: "Failed to update person" },
      { status: 500 },
    );
  }
}
