/**
 * lib/nguon/nguon-cho-form-nhap.ts — dữ liệu + cổng "ÉP CHỌN NGUỒN" cho form nhập lead (06 §5.6, 03 §2.10). Chỉ ĐỌC.
 *
 * Hai việc, MỘT nguồn sự thật (luật 12b) — trang vẽ ô chọn và Server Action chặn phiếu thiếu nguồn cùng hỏi một hàm:
 *   · `loadNguonChoFormNhap` — cho TRANG: có vẽ ô chọn nguồn không (theo từng cơ sở) + danh sách nguồn chọn được.
 *   · `epChonNguonChoMaCoSo`  — cho ACTION: phiếu của cơ sở này có BẮT BUỘC chọn nguồn không.
 *
 * Từ 12/10/2026: master `nguon.enabled` BẬT ⇒ form LUÔN bắt chọn nguồn từ danh mục động (mọi cơ sở, kể cả phiếu "để hệ thống tự chia"); master TẮT ⇒ trả null / false ngay,
 * không đọc gì thêm ⇒ hành vi cũ y nguyên. Cờ theo cơ sở `nguon.epChonNguon` không còn quyết form này (chỉ còn quyết nhập Excel gặp nhãn lạ).
 */
import { db } from "@/lib/db";
import { locNhomChon, type NhomChon } from "./chon-nguon";
import { laQuanLyNguonBat } from "./feature";

export type NguonChoFormNhap = {
  /** Nguồn chọn được (ACTIVE ∧ selectable). */
  danhMuc: NhomChon[];
  /** Phiếu CHƯA chọn cơ sở ("để hệ thống tự chia") có ép chọn không — giá trị toàn hệ. */
  epMacDinh: boolean;
  /** Mã cơ sở → có ép chọn không. Đủ MỌI cơ sở của danh sách truyền vào. */
  epTheoCoSo: Record<string, boolean>;
};

/**
 * Phiếu nhập khách của cơ sở `maCoSo` có BẮT BUỘC chọn nguồn từ danh mục động không.
 *
 * 12/10/2026 — ĐỔI LUẬT (chủ dự án): module Nguồn BẬT (`nguon.enabled`) ⇒ form nhập khách LUÔN bắt chọn nguồn từ `LeadSourceGroup` ở MỌI cơ sở; không còn ô
 * gõ tự do + mảng nhãn gõ cứng làm lối vòng. Master TẮT ⇒ false (hành vi cũ y nguyên — prod hôm nay). Cờ theo cơ sở `nguon.epChonNguon` KHÔNG còn ảnh hưởng form này
 * (chỉ còn điều khiển nhập Excel gặp nhãn lạ: `cachXuLyNhanLa`). `maCoSo` giữ trong chữ ký để nơi gọi không đổi; không dùng.
 */
export async function epChonNguonChoMaCoSo(maCoSo: string | null | undefined): Promise<boolean> {
  void maCoSo;
  return laQuanLyNguonBat();
}

/**
 * Dữ liệu cho form (`now` BẮT BUỘC — nguồn hết hiệu lực không có mặt ở ô chọn). `null` ⇒ KHÔNG vẽ ô chọn nguồn ở đâu cả (master tắt, hoặc không cơ sở nào ép chọn) — form giữ ô gõ tự do như cũ.
 * Không ép ở đâu thì cũng không đọc danh mục nguồn: form cũ không tốn thêm một câu nào.
 */
export async function loadNguonChoFormNhap(coSo: readonly { code: string }[], now: Date): Promise<NguonChoFormNhap | null> {
  if (!(await laQuanLyNguonBat())) return null;
  const [epMacDinh, theo] = await Promise.all([
    epChonNguonChoMaCoSo(null),
    Promise.all(coSo.map(async (c) => [c.code, await epChonNguonChoMaCoSo(c.code)] as const)),
  ]);
  const epTheoCoSo = Object.fromEntries(theo);
  const nhom = await db.leadSourceGroup.findMany({
    select: { id: true, code: true, name: true, description: true, referrerRequirement: true, requiresNote: true, selectable: true, status: true, sortOrder: true, effectiveFrom: true, effectiveTo: true },
  });
  return { danhMuc: locNhomChon(nhom, now), epMacDinh, epTheoCoSo };
}
