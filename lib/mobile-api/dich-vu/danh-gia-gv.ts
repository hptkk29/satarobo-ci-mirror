import { z } from "zod";

import { db } from "@/lib/db";
import { docCacDotDanhGia, nopDanhGiaGiaoVien, type KetQuaNopDanhGia } from "@/lib/eval/danh-gia-gv-hoc-sinh";
import { isEvalV2Enabled } from "@/lib/flags";
import { portalDb } from "@/lib/portal/db";

import type { MaHocVienDaKiem } from "../so-huu";
import { LoiApiMobile, type NguoiGoi } from "../xac-thuc/dich-vu";

/**
 * V8.20 — H-Danh-gia: HỌC SINH ĐÁNH GIÁ GIÁO VIÊN (BR-HS-EVAL-01, OD-16 «không ẩn danh»). Lớp MỎNG bọc lõi dùng chung với cổng web `/portal/danh-gia-gv`
 * (`lib/eval/danh-gia-gv-hoc-sinh.ts`): đợt ĐANG MỞ · eligibility tính lại lúc gửi · validate đáp án · chống trùng (đợt, ghi danh, giáo viên). KHÔNG có luật/bảng thứ hai.
 *   · `GET  /students/:id/teacher-evaluations` → các đợt đang mở + câu hỏi + danh sách giáo viên CHƯA đánh giá (cờ EVAL_V2 tắt ⇒ `dangMo:false`, danh sách rỗng — như web «đang chuẩn bị»);
 *   · `POST /students/:id/teacher-evaluations` → gửi MỘT đánh giá (một giáo viên trong một đợt). Gửi lại ⇒ 409 `DA_DANH_GIA`.
 * Chế độ học sinh: được (của CHÍNH mình — màn dành cho học sinh). Không trả nhận xét/điểm của người khác; không có cột nào lộ danh tính người chấm ra ngoài (nhân viên mới thấy ở báo cáo).
 */
export const danhGiaSchema = z.strictObject({
  dotId: z.string().min(1).max(64),
  ghiDanhId: z.string().min(1).max(64),
  giaoVienId: z.string().min(1).max(64),
  traLoi: z
    .array(z.strictObject({ cauHoiId: z.string().min(1).max(64), soSao: z.number().int().min(1).max(5).nullable().optional(), luaChon: z.array(z.string().max(200)).max(20).nullable().optional(), vanBan: z.string().max(2000).nullable().optional() }))
    .max(50),
});
export type DanhGiaBody = z.infer<typeof danhGiaSchema>;

export type DanhGiaDto = {
  dangMo: boolean;
  khoi: Array<{
    dotId: string;
    ten: string;
    cauHoi: Array<{ id: string; loai: string; nhan: string; luaChon: string[]; batBuoc: boolean }>;
    giaoVien: Array<{ ghiDanhId: string; giaoVienId: string; tenGiaoVien: string; tenLop: string; vaiTro: string }>;
  }>;
};

async function pdbCua(nguoi: NguoiGoi) {
  const con = await db.student.findMany({ where: { parentUserId: nguoi.userId, deletedAt: null }, select: { id: true } });
  return portalDb({ parentUserId: nguoi.userId, childIds: con.map((c) => c.id) });
}

export async function layDanhGia(hs: MaHocVienDaKiem, nguoi: NguoiGoi): Promise<DanhGiaDto> {
  if (!isEvalV2Enabled()) return { dangMo: false, khoi: [] };
  const khoi = await docCacDotDanhGia(await pdbCua(nguoi), hs);
  return {
    dangMo: true,
    khoi: khoi.map((k) => ({
      dotId: k.roundId,
      ten: k.name,
      cauHoi: k.questions.map((q) => ({ id: q.id, loai: q.type, nhan: q.label, luaChon: (q.options as unknown as string[] | null) ?? [], batBuoc: q.required })),
      giaoVien: k.pairs.map((p) => ({ ghiDanhId: p.enrollmentId, giaoVienId: p.teacherId, tenGiaoVien: p.teacherName, tenLop: p.className, vaiTro: p.role })),
    })),
  };
}

const LOI: Record<Exclude<KetQuaNopDanhGia, { ok: true }>["ma"], { http: number; code: "NOT_FOUND" | "DOT_DA_DONG" | "KHONG_DUOC_DANH_GIA" | "VALIDATION" | "DA_DANH_GIA" }> = {
  DOT_KHONG_HOP_LE: { http: 404, code: "NOT_FOUND" },
  DOT_DA_DONG: { http: 409, code: "DOT_DA_DONG" },
  KHONG_DUOC_DANH_GIA: { http: 422, code: "KHONG_DUOC_DANH_GIA" },
  DAP_AN_SAI: { http: 400, code: "VALIDATION" },
  DA_DANH_GIA: { http: 409, code: "DA_DANH_GIA" },
};

export async function guiDanhGia(hs: MaHocVienDaKiem, nguoi: NguoiGoi, body: DanhGiaBody): Promise<{ daGui: true }> {
  if (!isEvalV2Enabled()) throw new LoiApiMobile("NOT_FOUND", 404, "Tính năng chưa được mở.");
  const r = await nopDanhGiaGiaoVien(await pdbCua(nguoi), hs, {
    roundId: body.dotId,
    enrollmentId: body.ghiDanhId,
    teacherId: body.giaoVienId,
    answers: body.traLoi.map((t) => ({ questionId: t.cauHoiId, valueNumber: t.soSao ?? null, valueOptions: t.luaChon ?? null, valueText: t.vanBan ?? null })),
  });
  if (!r.ok) {
    const l = LOI[r.ma];
    throw new LoiApiMobile(l.code, l.http, r.error);
  }
  return { daGui: true };
}
