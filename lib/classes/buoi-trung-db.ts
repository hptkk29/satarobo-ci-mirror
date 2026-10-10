// lib/classes/buoi-trung-db.ts — nửa DB của việc dọn buổi trùng trước khi tạo chỉ mục `ClassSession_class_date_active_key` (T03).
// Luật phân loại ở `buoi-trung.ts` (thuần). File này: ĐỌC các nhóm trùng (đúng vị từ của chỉ mục — KHÔNG lọc lớp đã xoá mềm) và
// ÁP DỤNG việc huỷ buổi dư dưới khoá, có `expect` chặn trước mọi phép ghi.
//
// Dùng cho `scripts/don-buoi-lop-trung.ts` (dry-run mặc định) và test DB. KHÔNG có đường nào gọi nó từ giao diện: dọn dữ liệu
// prod là việc có người duyệt (workflow bấm tay), không phải nút.
import "server-only";
import type { Prisma } from "@prisma/client";
import { khoaLopBuoi } from "@/lib/classes/buoi-ghi";
import { phanLoaiNhomTrung, type BuoiTrung, type PhanLoaiNhom } from "@/lib/classes/buoi-trung";

type Tx = Prisma.TransactionClient;

export type NhomBuoiTrung = {
  classId: string;
  luc: Date;
  lopDaXoa: boolean;
  buoi: BuoiTrung[];
  phanLoai: PhanLoaiNhom;
};

/** Mọi nhóm (lớp, thời điểm) có ≥2 buổi CÒN SỐNG — đúng vị từ của chỉ mục duy nhất từng phần. */
export async function docNhomBuoiTrung(tx: Tx): Promise<NhomBuoiTrung[]> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      classId: string;
      luc: Date;
      status: string;
      taoLuc: Date;
      soDiemDanh: bigint;
      soNhanXet: bigint;
      soThamChieu: bigint;
      lopDaXoa: boolean;
    }[]
  >`
    SELECT s."id", s."classId", s."date" AS "luc", s."status"::text AS "status", s."createdAt" AS "taoLuc",
           (SELECT count(*) FROM "Attendance" a WHERE a."sessionId" = s."id") AS "soDiemDanh",
           (SELECT count(*) FROM "StudentSessionFeedback" f WHERE f."classSessionId" = s."id") AS "soNhanXet",
           (
             (SELECT count(*) FROM "StudentSkillAssessment" x WHERE x."classSessionId" = s."id")
             + (SELECT count(*) FROM "Assignment" x WHERE x."classSessionId" = s."id")
             + (SELECT count(*) FROM "ClassSessionMedia" x WHERE x."classSessionId" = s."id")
             + (SELECT count(*) FROM "HomeworkAssignment" x WHERE x."classSessionId" = s."id")
             + (SELECT count(*) FROM "EvalResponse" x WHERE x."classSessionId" = s."id")
             + (SELECT count(*) FROM "MediaAsset" x WHERE x."classSessionId" = s."id")
             + (SELECT count(*) FROM "SessionMediaReview" x WHERE x."classSessionId" = s."id")
             + (SELECT count(*) FROM "ParentRequest" x WHERE x."sessionId" = s."id")
             + (SELECT count(*) FROM "MakeupNeed" x WHERE x."missedSessionId" = s."id" OR x."makeupSessionId" = s."id")
             + (SELECT count(*) FROM "Attendance" x WHERE x."makeupSessionId" = s."id")
           ) AS "soThamChieu",
           (c."deletedAt" IS NOT NULL) AS "lopDaXoa"
    FROM "ClassSession" s
    LEFT JOIN "Class" c ON c."id" = s."classId"
    WHERE s."status" <> 'CANCELLED'
      AND EXISTS (
        SELECT 1 FROM "ClassSession" t
        WHERE t."classId" = s."classId" AND t."date" = s."date" AND t."status" <> 'CANCELLED' AND t."id" <> s."id"
      )
    ORDER BY s."classId", s."date", s."createdAt"
  `;
  const nhom = new Map<string, { classId: string; luc: Date; lopDaXoa: boolean; buoi: BuoiTrung[] }>();
  for (const r of rows) {
    const k = `${r.classId}|${r.luc.toISOString()}`;
    const g = nhom.get(k) ?? { classId: r.classId, luc: r.luc, lopDaXoa: r.lopDaXoa, buoi: [] };
    g.buoi.push({
      id: r.id,
      status: r.status,
      soDiemDanh: Number(r.soDiemDanh),
      soNhanXet: Number(r.soNhanXet),
      soThamChieu: Number(r.soThamChieu),
      taoLuc: r.taoLuc,
    });
    nhom.set(k, g);
  }
  return [...nhom.values()].map((g) => ({ ...g, phanLoai: phanLoaiNhomTrung(g.buoi) }));
}

/**
 * HUỶ (không xoá) buổi dư của mọi nhóm TỰ SỬA được. Gọi trong giao dịch ĐỌC-GHI của người gọi.
 *  1. đọc một lượt để biết lớp nào liên quan → KHOÁ các lớp đó theo thứ tự id;
 *  2. đọc LẠI dưới khoá — bản này mới là bản để ghi;
 *  3. `expect` (số nhóm tự sửa được người duyệt đã thấy ở dry-run) lệch ⇒ ném, CHƯA ghi gì;
 *  4. mỗi nhóm: `updateMany` có điều kiện, số dòng đổi phải bằng số buổi dư — lệch ⇒ ném (cả giao dịch rollback).
 * Nhóm XEM TAY được trả lại nguyên vẹn, không đụng.
 */
export async function apDungDonBuoiTrung(
  tx: Tx,
  p: { expect: number },
): Promise<{ nhomTuSua: number; daHuy: string[]; xemTay: NhomBuoiTrung[] }> {
  const truoc = await docNhomBuoiTrung(tx);
  for (const classId of [...new Set(truoc.map((n) => n.classId))].sort()) await khoaLopBuoi(tx, classId);
  const nhom = await docNhomBuoiTrung(tx);
  const tuSua = nhom.filter((n) => n.phanLoai.loai === "TU_SUA");
  if (tuSua.length !== p.expect) {
    throw new Error(`--expect=${p.expect} nhưng đang có ${tuSua.length} nhóm tự sửa được — DỪNG, chưa ghi gì. Chạy lại dry-run để xem số hiện tại.`);
  }
  const daHuy: string[] = [];
  for (const n of tuSua) {
    const pl = n.phanLoai as Extract<PhanLoaiNhom, { loai: "TU_SUA" }>;
    const r = await tx.classSession.updateMany({
      where: { id: { in: pl.huy }, status: { not: "CANCELLED" } },
      data: { status: "CANCELLED" },
    });
    if (r.count !== pl.huy.length) {
      throw new Error(`Nhóm ${n.classId} @ ${n.luc.toISOString()}: cần huỷ ${pl.huy.length} buổi nhưng đổi được ${r.count} — dữ liệu vừa đổi, chạy lại dry-run.`);
    }
    daHuy.push(...pl.huy);
  }
  return { nhomTuSua: tuSua.length, daHuy, xemTay: nhom.filter((n) => n.phanLoai.loai === "XEM_TAY") };
}

/** Tạo chỉ mục duy nhất từng phần — CHỈ khi không còn nhóm trùng nào (kể cả nhóm XEM TAY). */
export async function taoChiMucBuoi(tx: Tx): Promise<{ daTao: boolean; conTrung: number }> {
  const nhom = await docNhomBuoiTrung(tx);
  if (nhom.length > 0) return { daTao: false, conTrung: nhom.length };
  // Tagged template KHÔNG tham số (DDL hằng) — không dùng `$executeRawUnsafe`.
  await tx.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "ClassSession_class_date_active_key" ON "ClassSession" ("classId", "date") WHERE "status" <> 'CANCELLED'`;
  return { daTao: true, conTrung: 0 };
}
