/**
 * lib/nguon/ma-nv-gioi-thieu-db.ts — TẦNG ĐỌC của cột "Mã NV giới thiệu" (Excel nhập lead). Luật quyết định ở
 * `ma-nv-gioi-thieu.ts` (thuần); tệp này chỉ gom dữ liệu cho CẢ LÔ rồi gọi nó.
 *
 * ── Tra bằng `db` KHÔNG scope (T11) ──────────────────────────────────────────────────────────────────────────
 * Cùng lý do `thu-thap-tin-hieu.ts`: nhân viên ở cơ sở khác vẫn là người giới thiệu hợp lệ; qua client đã bọc phạm vi là bỏ sót
 * IM LẶNG. Kiểu tham số `DbKhongScope` (= `typeof db`) khiến `tsc` từ chối `scopedDb(...)`.
 *
 * ── Số câu tra CỐ ĐỊNH theo lô, và KHÔNG tốn câu nào khi không có mã ─────────────────────────────────────────
 * Không dòng nào có mã ⇒ 0 truy vấn (đường nhập cũ y hệt, ca `[NHH-SRC-07e-perf]` đếm câu). Có ≥ 1 mã ⇒ 3 câu: nhân viên · lịch sử
 * đổi mã (AuditLog) · kiểu người giới thiệu của các nhóm — không phụ thuộc số dòng.
 */
import { layNhomNhanSuMacDinh } from "./feature";
import { chuanHoaMaNhanVien, type DoiMa } from "./ma-nhan-vien";
import { moTaLoiAnToan } from "./noi-day";
import { dungBangTraMaNv, quyetDinhMaNvGioiThieu, type KetQuaMaNv, type NhomYeuCau } from "./ma-nv-gioi-thieu";
import type { DbKhongScope } from "./thu-thap-tin-hieu";

/** Một lead (đã gộp các dòng cùng SĐT): ô mã + nhãn nguồn người gõ + ngày dùng để giải mã. */
export type DongMaNv = { maTho: string | null; nhanKhai: string | null; ngayGiaiMa: Date };

/** `TAT` = quản lý nguồn đang TẮT: mã có trong file nhưng sẽ KHÔNG được ghi — đường gọi phải nói một lần cho cả file. */
export type KetQuaMaNvTheoLo = KetQuaMaNv | { kieu: "TAT" };

const coMa = (d: DongMaNv): boolean => d.maTho !== null && d.maTho.trim() !== "";

export async function giaiMaNvGioiThieuTheoLo(
  dbKhongScope: DbKhongScope,
  input: {
    /** `laQuanLyNguonBat()` do đường gọi đọc — BẮT BUỘC, không mặc định (luật 7). */
    nguonBat: boolean;
    /** Lúc nhập — mốc lõi quy nguồn xét nhãn. */
    bayGio: Date;
    dong: readonly DongMaNv[];
  },
): Promise<KetQuaMaNvTheoLo[]> {
  const khongCo: KetQuaMaNvTheoLo[] = input.dong.map(() => ({ kieu: "KHONG_CO" }));
  if (!input.dong.some(coMa)) return khongCo;
  if (!input.nguonBat) return input.dong.map((d) => (coMa(d) ? { kieu: "TAT" as const } : { kieu: "KHONG_CO" as const }));

  try {
    const [nhanVien, lsRaw, nhomRows, nhomNhanSu] = await Promise.all([
      dbKhongScope.employee.findMany({ select: { id: true, employeeCode: true, status: true } }),
      // Lịch sử đổi mã — nguồn DUY NHẤT còn giữ ánh xạ theo thời gian (cùng câu với `di-tru-db.ts`).
      dbKhongScope.$queryRaw<{ entityId: string; createdAt: Date; maCu: string | null; maMoi: string | null }[]>`
        SELECT "entityId", "createdAt",
               "oldValues"->>'employeeCode' AS "maCu", "newValues"->>'employeeCode' AS "maMoi"
        FROM "AuditLog"
        WHERE "entityType" = 'Employee' AND 'employeeCode' = ANY("changedFields")`,
      dbKhongScope.leadSourceGroup.findMany({ select: { code: true, referrerRequirement: true } }),
      layNhomNhanSuMacDinh(),
    ]);
    const idNhanVien = new Set(nhanVien.map((e) => e.id));
    const lichSu: DoiMa[] = [];
    for (const r of lsRaw) {
      // Dòng có entityId không phải Employee.id (đường import ghi `String(id ?? employeeCode)`) và dòng không có mã mới: bỏ.
      if (r.maMoi === null || !idNhanVien.has(r.entityId)) continue;
      lichSu.push({
        employeeId: r.entityId,
        maCu: r.maCu === null ? null : chuanHoaMaNhanVien(r.maCu),
        maMoi: chuanHoaMaNhanVien(r.maMoi),
        luc: r.createdAt,
      });
    }
    const bang = dungBangTraMaNv(nhanVien, lichSu);
    const nhomYeuCau: NhomYeuCau = new Map(nhomRows.map((g) => [g.code, g.referrerRequirement] as const));

    return input.dong.map((d) =>
      quyetDinhMaNvGioiThieu({
        maTho: d.maTho,
        nhanKhai: d.nhanKhai,
        ngayGiaiMa: d.ngayGiaiMa,
        bayGio: input.bayGio,
        bang,
        nhomYeuCau,
        nhomNhanSu,
      }),
    );
  } catch (err) {
    // Không tra được ⇒ KHÔNG đoán người. Lead vẫn được tạo (T4); người nhập thấy cảnh báo ở từng dòng có mã.
    console.error(`[nguon] giải mã NV giới thiệu lỗi — mã bị bỏ qua, lead vẫn được tạo: ${moTaLoiAnToan(err)}`);
    return input.dong.map((d): KetQuaMaNvTheoLo =>
      coMa(d)
        ? { kieu: "BO_QUA", lyDo: "lỗi hệ thống khi tra mã nhân viên — mã không được áp dụng, lead vẫn được tạo" }
        : { kieu: "KHONG_CO" },
    );
  }
}
