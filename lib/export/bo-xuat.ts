// lib/export/bo-xuat.ts — SỔ ĐĂNG KÝ duy nhất cho route `/api/admin/xuat/[ma]`.
//
// Gộp hai họ tệp vốn khác nhau đúng MỘT điểm — dòng tiêu đề:
//   · `nhap-lai.ts` (7 màn) — tiêu đề là KHOÁ MÁY, vì tệp phải nhập lại được;
//   · `bao-cao.ts`  (5 màn) — tiêu đề là NHÃN TIẾNG VIỆT, vì tệp để đọc và gửi đi.
//
// Gộp ở đây chứ không chẻ thành hai route: cổng quyền, audit, watermark và cách đặt tên tệp
// là như nhau cho cả 12. Hai route là hai chỗ để quên một cổng — và cổng hay bị quên là cổng
// mới thêm, vì cổng cũ đã nằm đó sẵn.
import { BO_NAP, MA_NHAP_LAI } from "./nhap-lai";
import { BO_NAP_BAO_CAO, MA_BAO_CAO } from "./bao-cao";
import type { KetQuaNap } from "./nhap-lai";
import type { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";

type ScopedDb = ReturnType<typeof scopedDb>;

export type SpecXuat = {
  nap: (sdb: ScopedDb, actor: Actor) => Promise<KetQuaNap<never>>;
  /**
   * `true` = dòng tiêu đề in KHOÁ MÁY và tệp nhập lại được.
   *
   * Đừng bật cho một tệp báo cáo "cho đồng bộ": người đọc sẽ phải tự dịch `choXacNhan` sang
   * "chờ kế toán xác nhận", và không màn nhập nào ăn tệp đó nên chẳng được gì.
   */
  tieuDeLaKhoa: boolean;
};

export const BO_XUAT: Record<string, SpecXuat> = {
  ...Object.fromEntries(
    Object.entries(BO_NAP).map(([ma, nap]) => [ma, { nap, tieuDeLaKhoa: true } as SpecXuat]),
  ),
  ...Object.fromEntries(
    // Bộ báo cáo không cần `actor` (đã đi qua `scopedDb`), nên bọc lại cho khớp chữ ký.
    Object.entries(BO_NAP_BAO_CAO).map(([ma, nap]) => [
      ma,
      { nap: (sdb: ScopedDb) => nap(sdb), tieuDeLaKhoa: false } as SpecXuat,
    ]),
  ),
};

export const MOI_MA_CO_ROUTE = [...MA_NHAP_LAI, ...MA_BAO_CAO];
