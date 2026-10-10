// app/api/scorm/runtime/route.ts — R7-12: SCORM 1.2 runtime (delivery tracking).
// Theo dõi GV/staff HOÀN THÀNH GIẢNG gói SCORM (learner = session.user.id của GV).
// TUYỆT ĐỐI KHÔNG ghi điểm/tiến độ HV, KHÔNG nối học bạ — đây là học liệu cho GV xem.
// POST { packageId, classSessionId?, cmi, sessionStart?, finished? } → UPSERT ScormAttempt
// theo (packageId, userId, classSessionId). classSessionId nullable + NULL-distinct nên
// dùng findFirst + update/create (không @@unique được vì NULL distinct trong Postgres).
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveActor } from "@/lib/auth/actor";
import { canOpenScorm, type ScormClassSession } from "@/lib/scorm/access";
import { isScormEnabled } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Completion =
  | "NOT_ATTEMPTED"
  | "INCOMPLETE"
  | "COMPLETED"
  | "PASSED"
  | "FAILED"
  | "BROWSED";

/** Map cmi.core.lesson_status (SCORM 1.2) → enum ScormCompletion. */
function mapStatus(s: unknown): Completion {
  switch (String(s ?? "").toLowerCase().trim()) {
    case "passed":
      return "PASSED";
    case "completed":
      return "COMPLETED";
    case "failed":
      return "FAILED";
    case "browsed":
      return "BROWSED";
    case "incomplete":
      return "INCOMPLETE";
    default:
      return "NOT_ATTEMPTED";
  }
}

/** Parse SCORM 1.2 CMITimespan "HH:MM:SS.SS" → giây (cap 12h chống số phi lý). */
function parseSessionTime(t: unknown): number {
  if (typeof t !== "string") return 0;
  const m = /^(\d{2,4}):(\d{2}):(\d{2}(?:\.\d{1,2})?)$/.exec(t.trim());
  if (!m) return 0;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (!Number.isFinite(h + min + sec)) return 0;
  const total = Math.round(h * 3600 + min * 60 + sec);
  return Math.min(Math.max(total, 0), 12 * 3600);
}

/** Cắt chuỗi text dài (lesson_location / suspend_data) — tránh ghi quá cỡ. */
function clampText(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  return v.slice(0, max);
}

/** Parse score.raw → number 0..100 (self-check của GV, KHÔNG phải điểm HV). */
function parseScore(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.min(Math.max(n, 0), 100);
}

export async function POST(req: NextRequest) {
  if (!isScormEnabled()) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const packageId = typeof b.packageId === "string" ? b.packageId : "";
  if (!packageId) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const classSessionId =
    typeof b.classSessionId === "string" && b.classSessionId.trim()
      ? b.classSessionId.trim()
      : null;
  const cmi = (b.cmi && typeof b.cmi === "object" ? b.cmi : {}) as Record<
    string,
    unknown
  >;
  const sessionStart = b.sessionStart === true;

  const userId = session.user.id;
  const actor = await resolveActor(userId);

  // Gói phải tồn tại.
  const pkg = await db.scormPackage.findUnique({
    where: { id: packageId },
    select: { id: true },
  });
  if (!pkg) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  // Quyền: GV phân công buổi ∪ training:manage (tái dùng canOpenScorm — không HV).
  let classSession: ScormClassSession = {};
  if (classSessionId) {
    const cs = await db.classSession.findUnique({
      where: { id: classSessionId },
      select: {
        actualTeacherId: true,
        class: { select: { teacherId: true, assistantId: true } },
      },
    });
    if (cs) classSession = cs;
  }
  if (!canOpenScorm(actor, classSession)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  // Map cmi → ScormAttempt.
  const completion = mapStatus(cmi.lesson_status);
  const addSec = parseSessionTime(cmi.session_time);
  const lessonLocation = clampText(cmi.lesson_location, 4000);
  const suspendData = clampText(cmi.suspend_data, 64000);
  const scoreRaw = parseScore(cmi.score_raw);

  // UPSERT thủ công (classSessionId NULL-distinct → không dùng được @@unique compound).
  const existing = await db.scormAttempt.findFirst({
    where: { packageId, userId, classSessionId },
    select: { id: true },
  });

  if (existing) {
    await db.scormAttempt.update({
      where: { id: existing.id },
      data: {
        completion,
        ...(scoreRaw !== undefined ? { scoreRaw } : {}),
        ...(lessonLocation !== undefined ? { lessonLocation } : {}),
        ...(suspendData !== undefined ? { suspendData } : {}),
        totalTimeSec: { increment: addSec },
        ...(sessionStart ? { sessionCount: { increment: 1 } } : {}),
        lastAccessedAt: new Date(),
      },
    });
  } else {
    await db.scormAttempt.create({
      data: {
        packageId,
        userId,
        classSessionId,
        completion,
        scoreRaw: scoreRaw ?? null,
        lessonLocation: lessonLocation ?? null,
        suspendData: suspendData ?? null,
        totalTimeSec: addSec,
        sessionCount: 1,
        lastAccessedAt: new Date(),
      },
    });
  }

  return NextResponse.json({ ok: true });
}
