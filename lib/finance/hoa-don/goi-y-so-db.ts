import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { CAU_HINH_HOA_DON_MAC_DINH, phapNhanChoDon } from "./phap-nhan";
import { phapNhanTheoCauHinh } from "./cau-hinh-co-so";
import { docCauHinhDangBat } from "./cau-hinh-co-so-db";
import { goiYSo, mstCuaDay, soDaDungCuaDay, type GoiYSo } from "./goi-y-so";

// lib/finance/hoa-don/goi-y-so-db.ts — đọc số đã dùng của một DÃY (MST người bán, ký hiệu) cho gợi ý số + kiểm trùng.
// Luật nằm ở `goi-y-so.ts` (thuần, có test).
//
// ⚠️ KHÔNG qua `scopedDb`, có chủ đích: kế toán CS1 trên một dãy DÙNG CHUNG phải thấy số CS2 đã dùng, nếu không sẽ được
// đề xuất số trùng (cùng bài học `lib/payments/method-lookup.ts`: câu tra để CHẶN phải không-scope). Đổi lại, hàm này
// CHỈ trả về các SỐ NGUYÊN — không bao giờ trả dòng hoá đơn / tên / cơ sở của người khác ra khỏi tầng này.
// ⚠️ Đọc MỌI trạng thái có số (kể cả THAY_THE — số của hoá đơn huỷ vẫn đã tiêu ở phần mềm phát hành).

type DbHoacTx = Prisma.TransactionClient | typeof db;

const mstTheoMa = (ma: string) => CAU_HINH_HOA_DON_MAC_DINH.phapNhan.find((p) => p.ma === ma)?.maSoThue;

/** Số đã dùng (tăng dần) của dãy; `truHoaDonId` loại chính bản nháp đang sửa khỏi phép kiểm trùng. */
export async function docSoDaDungTrongDay(
  client: DbHoacTx,
  day: { mst: string; kyHieu: string },
  truHoaDonId: string | null,
): Promise<number[]> {
  const ky = day.kyHieu.trim();
  if (!ky) return [];
  const [hd, coSo] = await Promise.all([
    client.hoaDonDienTu.findMany({
      where: { kyHieu: { equals: ky, mode: "insensitive" }, soHoaDon: { not: null }, ...(truHoaDonId ? { id: { not: truHoaDonId } } : {}) },
      select: { soHoaDon: true, phapNhanMst: true, kyHieu: true, centerId: true },
    }),
    client.center.findMany({ select: { id: true, code: true } }),
  ]);
  const maCoSo = new Map(coSo.map((c) => [c.id, c.code ?? ""]));
  return soDaDungCuaDay(
    hd.map((h) => ({ soHoaDon: h.soHoaDon ?? "", phapNhanMst: h.phapNhanMst, kyHieu: h.kyHieu, maCoSo: maCoSo.get(h.centerId) ?? "" })),
    day,
    mstTheoMa,
  );
}

/**
 * MST của DÃY mà một hoá đơn sắp lưu thuộc về — áp CÙNG quy tắc chuẩn hoá với phía hoá đơn đã lưu (`mstCuaDay`):
 * nếu không, bản mới lưu MST Sata cho CS2 + 1C26MNV nằm ở dãy "Sata" còn 19 bản cũ nằm ở dãy "New Vision" — hai bên
 * không thấy nhau và khoá tư vấn cũng khác khoá. Cơ sở không tra được mã ⇒ giữ MST khai.
 */
export async function mstDayChoHoaDonMoi(
  client: DbHoacTx,
  h: { mst: string; kyHieu: string; centerId: string },
): Promise<string> {
  const c = await client.center.findUnique({ where: { id: h.centerId }, select: { code: true } });
  return mstCuaDay({ phapNhanMst: h.mst, kyHieu: h.kyHieu, maCoSo: c?.code ?? "" }, mstTheoMa);
}

/**
 * Gợi ý số kế tiếp cho dãy mà một hoá đơn của `centerId` mang `mst` + `kyHieu` sẽ thuộc về (MST được chuẩn hoá cùng quy
 * tắc với lúc lưu). Chỉ là ĐỀ XUẤT — không giữ chỗ, không cấp số. `centerId` BẮT BUỘC (luật 7): thiếu nó thì hai bên
 * (gợi ý và kiểm trùng) nói về hai dãy khác nhau.
 */
export async function goiYSoChoDay(day: { mst: string; kyHieu: string; centerId: string }): Promise<GoiYSo> {
  const mst = await mstDayChoHoaDonMoi(db, day);
  return goiYSo(await docSoDaDungTrongDay(db, { mst, kyHieu: day.kyHieu }, null));
}

export type GoiYChoLanThu =
  | { ok: true; goiY: GoiYSo; kyHieu: string; mst: string; phapNhanTen: string; nguonPhapNhan: "CAU_HINH" | "MAC_DINH" }
  | { ok: false; error: string };

/**
 * Gợi ý số cho MỘT lần thu: pháp nhân phát hành theo cấu hình cơ sở + NGÀY phát hành (cùng hàm với lúc lưu nháp),
 * rồi dãy (MST, ký hiệu). Người gọi PHẢI đã kiểm quyền kế toán của `centerId`. Đọc cấu hình qua `scopedDb` (actor).
 */
export async function goiYSoChoLanThu(input: {
  actor: Actor;
  centerId: string;
  centerCode: string;
  kyHieu: string;
  /** yyyy-mm-dd — ngày phát hành dự kiến. */
  ngay: string;
}): Promise<GoiYChoLanThu> {
  const cauHinh = await docCauHinhDangBat(input.actor, [input.centerId]);
  const pn = phapNhanTheoCauHinh({
    cauHinh,
    centerId: input.centerId,
    ngay: input.ngay,
    danhSachPhapNhan: CAU_HINH_HOA_DON_MAC_DINH.phapNhan,
    macDinh: phapNhanChoDon(input.centerCode, CAU_HINH_HOA_DON_MAC_DINH),
    // Thiếu cấu hình ⇒ KHÔNG gợi ý số cho một pháp nhân đoán: cùng cổng với lúc LƯU, để gợi ý và lưu không bao giờ lệch.
    khiThieuCauHinh: "CHAN",
  });
  if (!pn.ok) return { ok: false, error: pn.error };
  const goiY = await goiYSoChoDay({ mst: pn.phapNhan.maSoThue, kyHieu: input.kyHieu, centerId: input.centerId });
  return { ok: true, goiY, kyHieu: input.kyHieu.trim().toUpperCase(), mst: pn.phapNhan.maSoThue, phapNhanTen: pn.phapNhan.ten, nguonPhapNhan: pn.nguon };
}

/** Gợi ý số cho lần thu ĐANG MỞ trên màn (trang tính ở server, truyền xuống form để khỏi gọi lại khi mount). */
export type GoiYBanDau = { dongKey: string; ket: GoiYChoLanThu };
