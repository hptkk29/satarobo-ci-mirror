/**
 * lib/nguon/nguon-cho-form-nhap.ts — dữ liệu + cổng "ÉP CHỌN NGUỒN" cho form nhập lead (06 §5.6, 03 §2.10). Chỉ ĐỌC.
 *
 * Hai việc, MỘT nguồn sự thật (luật 12b) — trang vẽ ô chọn và Server Action chặn phiếu thiếu nguồn cùng hỏi một hàm:
 *   · `loadNguonChoFormNhap` — cho TRANG: có vẽ ô chọn nguồn không (theo từng cơ sở) + danh sách nguồn chọn được.
 *   · `epChonNguonChoMaCoSo`  — cho ACTION: phiếu của cơ sở này có BẮT BUỘC chọn nguồn không.
 *
 * Cờ ép chọn là cờ THEO CƠ SỞ (`CenterSetting`, khoá theo `OrgUnit.id`): pilot từng cơ sở. Phiếu "để hệ thống tự chia" (chưa có cơ sở)
 * dùng giá trị TOÀN HỆ. Cờ master `nguon.enabled` TẮT ⇒ trả null / false ngay, không đọc gì thêm ⇒ hành vi cũ y nguyên.
 *
 * ⚠️ Nơi khác KHÔNG được tự hỏi `laEpChonNguon` rồi tự suy cơ sở từ mã: mã cơ sở → `OrgUnit.id` là phép đổi dễ nhầm (`Center.id` ≠
 * `OrgUnit.id`; truyền nhầm là tra không ra dòng nào và lặng lẽ rơi về giá trị toàn hệ — xem `lib/nguon/feature.ts`).
 */
import { db } from "@/lib/db";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { locNhomChon, type NhomChon } from "./chon-nguon";
import { laEpChonNguon, laQuanLyNguonBat } from "./feature";

export type NguonChoFormNhap = {
  /** Nguồn chọn được (ACTIVE ∧ selectable). */
  danhMuc: NhomChon[];
  /** Phiếu CHƯA chọn cơ sở ("để hệ thống tự chia") có ép chọn không — giá trị toàn hệ. */
  epMacDinh: boolean;
  /** Mã cơ sở → có ép chọn không. Đủ MỌI cơ sở của danh sách truyền vào. */
  epTheoCoSo: Record<string, boolean>;
};

/** Phiếu của cơ sở `maCoSo` (null/rỗng = chưa chọn) có BẮT BUỘC chọn nguồn không. Master TẮT ⇒ false. */
export async function epChonNguonChoMaCoSo(maCoSo: string | null | undefined): Promise<boolean> {
  if (!(await laQuanLyNguonBat())) return false;
  const ma = (maCoSo ?? "").trim();
  if (ma === "") return laEpChonNguon(null);
  const c = await db.center.findUnique({ where: { code: ma }, select: { id: true } });
  // Mã lạ: không đoán cơ sở — dùng giá trị toàn hệ (đường nhập sẽ cảnh báo "cơ sở không nhận ra" ở chỗ khác).
  const orgUnitId = c ? await orgUnitIdForCenter(c.id) : null;
  return laEpChonNguon(orgUnitId);
}

/**
 * Dữ liệu cho form (`now` BẮT BUỘC — nguồn hết hiệu lực không có mặt ở ô chọn). `null` ⇒ KHÔNG vẽ ô chọn nguồn ở đâu cả (master tắt, hoặc không cơ sở nào ép chọn) — form giữ ô gõ tự do như cũ.
 * Không ép ở đâu thì cũng không đọc danh mục nguồn: form cũ không tốn thêm một câu nào.
 */
export async function loadNguonChoFormNhap(coSo: readonly { code: string }[], now: Date): Promise<NguonChoFormNhap | null> {
  if (!(await laQuanLyNguonBat())) return null;
  const [epMacDinh, theo] = await Promise.all([
    laEpChonNguon(null),
    Promise.all(coSo.map(async (c) => [c.code, await epChonNguonChoMaCoSo(c.code)] as const)),
  ]);
  const epTheoCoSo = Object.fromEntries(theo);
  if (!epMacDinh && !theo.some(([, ep]) => ep)) return null;
  const nhom = await db.leadSourceGroup.findMany({
    select: { id: true, code: true, name: true, description: true, referrerRequirement: true, requiresNote: true, selectable: true, status: true, sortOrder: true, effectiveFrom: true, effectiveTo: true },
  });
  return { danhMuc: locNhomChon(nhom, now), epMacDinh, epTheoCoSo };
}
