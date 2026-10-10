// lib/chat/reconcile-membership.ts — US-04: job đối soát thành viên hằng đêm.
//
// Lưới cuối cho drift giữa participant thực tế và tập dẫn xuất (khi một luồng đổi
// dữ liệu lớp KHÔNG đi qua syncConversationMembership — vd SQL Editor, seed, script
// tay; danh sách điểm gọi đã wire: docs/chat-realtime/03-sync-callsites.md).
//
// Luật (cron.md + US-04 AC1–4):
//  • Chỉ lớp ACTIVE có sẵn Conversation CLASS_GROUP. Job KHÔNG tạo nhóm, KHÔNG tạo
//    participant, KHÔNG hard delete, KHÔNG đụng message — bề mặt ghi duy nhất là
//    `leftAt` + 2 bảng log (ConversationMembershipDrift / ConversationReconcileRun).
//  • Lệch REMOVE (phải rời mà chưa) → set leftAt NGAY trong cùng tx với dòng drift
//    (autoEnforced=true) — rò rỉ quyền không sống qua đêm.
//  • Lệch ADD (phải có mà thiếu) → CHỈ ghi drift (autoEnforced=false), chờ người xử
//    lý — tự thêm nhầm người vào nhóm là rủi ro riêng tư (pre-mortem T5). ADD chưa
//    được xử lý sẽ được log LẠI mỗi đêm (tín hiệu còn tồn đọng), có chủ đích.
//  • MANUAL (ngoại lệ Admin, BR-15) bị bỏ qua cả 2 chiều — job không gỡ, không đòi.
//  • Mỗi lần chạy ghi 1 ConversationReconcileRun — "đêm sạch" = run 0/0, KHÁC
//    "job không chạy" = không có run (AC4; thiếu 2 đêm liên tiếp là tín hiệu điều tra).
//  • `missingConversations` (09/08/2026) — ĐẾM lớp ACTIVE chưa có nhóm, KHÔNG tạo.
//    Xem chú thích tại chỗ tính bên dưới.
//  • Idempotent: chạy 2 lần liên tiếp → lần 2 removeCount=0, không drift trùng
//    (leftAt đã set là no-op).
//  • Mỗi lớp 1 transaction riêng — lớp lỗi không phá lớp khác (log ERROR, đi tiếp);
//    xử lý tuần tự theo cơ sở để không vượt timeout (cron.md: chia batch theo cơ sở).
//
// ✅ BẪY scopedDb (xem lib/chat/sync-membership.ts, mục "PHẦN DB"): job này đọc/ghi qua
// `db` TRẦN + `db.$transaction` — KHÔNG qua `scopedDb(actor)` — nên không có extension
// cách ly cơ sở nào áp lên `db.class.findMany`/`loadDerivedMembership` ở đây. Đó là đúng
// ý: đối soát là thao tác mức hệ thống, phải thấy MỌI lớp/học viên. Đừng đổi sang
// scopedDb "cho an toàn" — sẽ làm job bỏ sót đúng phần dữ liệu nó sinh ra để canh.
//
// ⚠️ Luật Nền Hệ thống "cron KHÔNG ghi thay đổi quyền": job này chỉ set `leftAt` trên
// ConversationParticipant — đó là DỮ LIỆU MEMBERSHIP DẪN XUẤT của nhóm chat, không
// phải quyền RBAC (RoleDef/UserOrgRole/UserPermissionGrant không bị đụng) → hợp lệ.
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  loadDerivedMembership,
  type DesiredParticipant,
} from "@/lib/chat/sync-membership";

type Tx = Prisma.TransactionClient;

// ─── PHẦN THUẦN (không DB — unit test được) ─────────────────────────────────

export type ExistingParticipantLite = {
  id: string;
  userId: string;
  source: "DERIVED" | "MANUAL";
  derivedFrom: string | null;
  leftAt: Date | null;
};

export type AddDrift = {
  participant: DesiredParticipant;
  /** MISSING = chưa từng có bản ghi · LEFT = bản ghi DERIVED đã leftAt nhưng lẽ ra phải ở. */
  reason: "MISSING" | "LEFT";
};

export type MembershipDiff = {
  /** Participant DERIVED còn active nhưng KHÔNG thuộc tập dẫn xuất → phải rời. */
  removes: ExistingParticipantLite[];
  /** User thuộc tập dẫn xuất nhưng thiếu bản ghi active → chỉ log, không tự thêm. */
  adds: AddDrift[];
};

/**
 * Phân loại lệch giữa tập dẫn xuất (desired) và participant hiện có. Hàm THUẦN.
 * MANUAL bị bỏ qua cả 2 chiều (BR-15): MANUAL active thừa → không REMOVE;
 * user desired đang có bản ghi MANUAL (kể cả đã leftAt — Admin chủ động gỡ) → không ADD,
 * khớp hành vi của syncConversationMembership (`cur.source === "MANUAL" → continue`).
 */
export function diffMembership(
  desired: readonly DesiredParticipant[],
  existing: readonly ExistingParticipantLite[],
): MembershipDiff {
  const desiredIds = new Set(desired.map((d) => d.userId));
  // unique(conversationId, userId) → mỗi user tối đa 1 bản ghi.
  const byUserId = new Map(existing.map((p) => [p.userId, p]));

  const removes = existing.filter(
    (p) => p.source === "DERIVED" && p.leftAt === null && !desiredIds.has(p.userId),
  );

  const adds: AddDrift[] = [];
  for (const d of desired) {
    const cur = byUserId.get(d.userId);
    if (!cur) {
      adds.push({ participant: d, reason: "MISSING" });
    } else if (cur.source === "DERIVED" && cur.leftAt !== null) {
      adds.push({ participant: d, reason: "LEFT" });
    }
    // cur.source === "MANUAL" → BR-15, bỏ qua; DERIVED active → khớp, không lệch.
  }
  return { removes, adds };
}

// ─── PHẦN DB (cron / vận hành tay) ──────────────────────────────────────────

export type ReconcileSummary = {
  runId: string;
  classesChecked: number;
  removeCount: number;
  addCount: number;
  /**
   * Lớp ACTIVE CHƯA có nhóm chat — job CHỈ đếm và báo động, KHÔNG tạo (BR-01: nhóm sinh
   * từ luồng nghiệp vụ, không từ cron; luật Nền Hệ thống "job không tự thêm người").
   */
  missingConversations: number;
  /** Lớp lỗi (đã log ERROR, không phá lớp khác) — không persist, chỉ trả cho caller. */
  errorCount: number;
  durationMs: number;
};

type ClassRow = {
  id: string;
  centerId: string | null;
  orgUnitId: string | null;
  teacherId: string | null;
  assistantId: string | null;
};

const REMOVE_DETAIL = (derivedFrom: string | null) =>
  `Participant DERIVED${derivedFrom ? `/${derivedFrom}` : ""} còn active nhưng không còn ` +
  `trong tập dẫn xuất → job đã tự set leftAt. Nghi luồng đổi dữ liệu lớp ` +
  `(enrollment/GV/QLCS) ngoài app hoặc điểm gọi sync bị sót ` +
  `(docs/chat-realtime/03-sync-callsites.md).`;

const ADD_DETAIL = (d: AddDrift) =>
  (d.reason === "MISSING"
    ? `Thiếu participant cho user thuộc tập dẫn xuất (${d.participant.derivedFrom}).`
    : `Participant DERIVED đã leftAt nhưng user vẫn thuộc tập dẫn xuất (${d.participant.derivedFrom}).`) +
  ` CHỈ ghi log, KHÔNG tự thêm (rủi ro riêng tư — pre-mortem T5); nghi dữ liệu ` +
  `thêm/khôi phục ngoài app (SQL/seed/script) không qua sync — chờ người xử lý.`;

/** Đối soát 1 lớp trong 1 tx: set leftAt (REMOVE) + ghi drift log cùng tx. */
async function reconcileClass(
  tx: Tx,
  cls: ClassRow,
  conversationId: string,
  orgUnitId: string | null,
): Promise<{ removes: number; adds: number }> {
  const { desired } = await loadDerivedMembership(tx, cls);
  const existing = await tx.conversationParticipant.findMany({
    where: { conversationId },
    select: { id: true, userId: true, source: true, derivedFrom: true, leftAt: true },
  });
  const diff = diffMembership(desired, existing);

  const now = new Date();
  const common = {
    conversationId,
    classId: cls.id,
    centerId: cls.centerId, // ghi kép centerId + orgUnitId (luật Nền Hệ thống #3)
    orgUnitId,
  };
  for (const p of diff.removes) {
    // REMOVE tự thi hành: leftAt + drift log trong CÙNG tx (cron.md mục 2).
    await tx.conversationParticipant.update({
      where: { id: p.id },
      data: { leftAt: now },
    });
    await tx.conversationMembershipDrift.create({
      data: {
        ...common,
        userId: p.userId,
        driftType: "REMOVE",
        autoEnforced: true,
        detail: REMOVE_DETAIL(p.derivedFrom),
      },
    });
  }
  for (const a of diff.adds) {
    await tx.conversationMembershipDrift.create({
      data: {
        ...common,
        userId: a.participant.userId,
        driftType: "ADD",
        autoEnforced: false,
        detail: ADD_DETAIL(a),
      },
    });
  }
  return { removes: diff.removes.length, adds: diff.adds.length };
}

/**
 * Đối soát thành viên cho MỌI lớp ACTIVE có Conversation CLASS_GROUP.
 * `opts.onlyClassIds` — giới hạn tập lớp (phục vụ ZZTEST/vận hành tay trên DB dev,
 * để script test không đụng conversation thật ngoài phạm vi); cron gọi KHÔNG truyền.
 */
export async function reconcileConversationMembership(opts?: {
  onlyClassIds?: string[];
}): Promise<ReconcileSummary> {
  const startedAt = Date.now();

  // Batch theo cơ sở (orderBy centerId) — xử lý tuần tự, mỗi lớp 1 tx riêng.
  const classes: ClassRow[] = await db.class.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      ...(opts?.onlyClassIds ? { id: { in: opts.onlyClassIds } } : {}),
    },
    select: {
      id: true,
      centerId: true,
      orgUnitId: true,
      teacherId: true,
      assistantId: true,
    },
    orderBy: [{ centerId: "asc" }, { id: "asc" }],
  });

  // Chỉ lớp ĐÃ có nhóm — job không tạo nhóm (đó là việc của sync/BR-01).
  const convs = classes.length
    ? await db.conversation.findMany({
        where: {
          type: "CLASS_GROUP",
          subjectType: "CLASS",
          subjectId: { in: classes.map((c) => c.id) },
        },
        select: { id: true, subjectId: true },
      })
    : [];
  const convByClassId = new Map(convs.map((c) => [c.subjectId as string, c.id]));

  // Lớp cũ chưa backfill orgUnitId → suy từ OrgUnit(type CENTER) như sync (US-03).
  const centerIds = [
    ...new Set(classes.map((c) => c.centerId).filter((x): x is string => !!x)),
  ];
  const orgUnits = centerIds.length
    ? await db.orgUnit.findMany({
        where: { centerId: { in: centerIds }, deletedAt: null },
        select: { id: true, centerId: true },
      })
    : [];
  const orgUnitByCenterId = new Map(orgUnits.map((o) => [o.centerId as string, o.id]));

  // ⚠️ ĐIỂM MÙ ĐÃ VÁ (09/08/2026): vòng lặp dưới đây bỏ qua lớp chưa có nhóm
  // (`if (!conversationId) continue`) — đúng (job không tạo nhóm), nhưng hệ quả là lớp
  // ACTIVE chưa từng có nhóm KHÔNG xuất hiện ở bất kỳ con số nào: `classesChecked` không
  // đếm nó, drift không có dòng nào, trang đối soát báo "0 drift · đêm sạch". Đó chính là
  // cách 24 lớp ACTIVE / 0 hội thoại sống sót đến ngày mở chat mà không ai thấy.
  // Nay đếm thành `missingConversations` — vẫn KHÔNG tạo nhóm (việc đó của
  // scripts/backfill-nhom-lop-chat.ts, chạy tay có dry-run), chỉ để báo động.
  const missingConversations = classes.filter((c) => !convByClassId.has(c.id)).length;

  let classesChecked = 0;
  let removeCount = 0;
  let addCount = 0;
  let errorCount = 0;

  for (const cls of classes) {
    const conversationId = convByClassId.get(cls.id);
    if (!conversationId) continue; // chưa có nhóm → không có gì để đối soát (đã đếm ở trên)
    const orgUnitId =
      cls.orgUnitId ?? (cls.centerId ? orgUnitByCenterId.get(cls.centerId) ?? null : null);
    try {
      // timeout 30s như mọi điểm gọi sync khác: trần 5s mặc định của Prisma đứt
      // giữa chừng khi lớp đông/RTT cao → lớp đó rơi vào catch và bị BỎ QUA IM
      // LẶNG tới đêm sau, đúng thứ job này sinh ra để chặn.
      const r = await db.$transaction(
        (tx) => reconcileClass(tx as Tx, cls, conversationId, orgUnitId),
        { timeout: 30_000, maxWait: 10_000 },
      );
      classesChecked += 1;
      removeCount += r.removes;
      addCount += r.adds;
    } catch (err) {
      // Lớp lỗi không phá lớp khác (cron.md: fail → log ERROR, đêm sau chạy lại).
      errorCount += 1;
      console.error(`[chat-reconcile] ERROR class=${cls.id}`, err);
    }
  }

  const durationMs = Date.now() - startedAt;
  // Run record ghi MỌI lần chạy — "0 drift" = removeCount=addCount=0 (AC4).
  const run = await db.conversationReconcileRun.create({
    data: { classesChecked, removeCount, addCount, missingConversations, durationMs },
    select: { id: true },
  });
  if (removeCount === 0 && addCount === 0) {
    console.log(`[chat-reconcile] 0 drift (${classesChecked} lớp, ${durationMs}ms)`);
  } else {
    console.log(
      `[chat-reconcile] drift: REMOVE=${removeCount} (đã tự thi hành) ADD=${addCount} ` +
        `(chờ người xử lý) — ${classesChecked} lớp, ${durationMs}ms`,
    );
  }
  if (missingConversations > 0) {
    console.warn(
      `[chat-reconcile] ⚠️ ${missingConversations} lớp ACTIVE CHƯA có nhóm chat — job ` +
        `KHÔNG tự tạo. Chạy: pnpm exec tsx scripts/backfill-nhom-lop-chat.ts (dry-run) ` +
        `rồi --apply.`,
    );
  }
  return {
    runId: run.id,
    classesChecked,
    removeCount,
    addCount,
    missingConversations,
    errorCount,
    durationMs,
  };
}
