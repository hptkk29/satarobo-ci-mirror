// lib/hoa-hong/mo-phong-hanh-dong.ts — ĐIỀU PHỐI thử tính cho Server Action (`.../chinh-sach/_actions.ts`): tra bản nháp theo tầm nhìn →
// dựng bối cảnh → `moPhongChinhSach`. CHỈ ĐỌC (xem lưới `[NHH-POL-10-W*]`: không import hàm ghi nào).
//
// Server Action CHỈ làm: `auth()` → `assertPermission("commission_policies:manage")` → `resolveActor` → gọi hàm này. Phần cách ly cơ sở
// nằm ở đây vì nó chạy được dưới Postgres thật (Server Action thì không):
//   · bản nháp tra qua `scopedDb(actor)` — ngoài tầm nhìn ⇒ "không tìm thấy", cùng câu với "không tồn tại" (không lộ id của cơ sở khác);
//   · dữ liệu khoản thu chỉ gồm các cơ sở trong tầm nhìn chính sách của người bấm.
// ⚠️ `now` BẮT BUỘC (luật 19).
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";

import { dungBoiCanhTuMoc } from "./boi-canh";
import { tamNhinChinhSach } from "./chinh-sach-doc";
import { docQuyTacCuaVersion } from "./chinh-sach-service";
import { HoaHongError } from "./kieu";
import { khoangMacDinh, kiemKhoang, type KetQuaThuTinh } from "./mo-phong";
import { KY_SOM_NHAT, moPhongChinhSach } from "./mo-phong-db";

/** Trần số khoản xét mỗi lượt. Mỗi khoản ~10 câu đọc; 1.500 khoản ≈ vài chục giây trên DB cùng máy. Vượt ⇒ xét khoản MỚI nhất và BÁO. */
export const TRAN_SO_KHOAN_THU_TINH = 1500;

const KHONG_THAY = "Không tìm thấy chính sách này (đã bị xoá, hoặc nằm ngoài phạm vi bạn được xem).";

export async function thuTinhPhienBan(a: {
  actor: Actor;
  now: Date;
  versionId: string;
  /** "YYYY-MM-DD" giờ VN; `null` = mặc định 3 tháng trọn vẹn gần nhất. Cả hai cùng `null` hoặc cùng có giá trị. */
  tuNgay: string | null;
  denNgay: string | null;
  /** Thu hẹp theo đơn vị (OrgUnit); `null` = toàn bộ phạm vi của người bấm. */
  orgUnitId: string | null;
}): Promise<KetQuaThuTinh> {
  if ((a.tuNgay === null) !== (a.denNgay === null)) return { ok: false, chung: "Chọn đủ cả ngày bắt đầu và ngày kết thúc.", loiKhoang: "Chọn đủ cả ngày bắt đầu và ngày kết thúc." };
  const khoang = a.tuNgay !== null && a.denNgay !== null ? { tuNgay: a.tuNgay, denNgay: a.denNgay } : khoangMacDinh(a.now);
  const loiKhoang = kiemKhoang(khoang.tuNgay, khoang.denNgay);
  if (loiKhoang) return { ok: false, chung: loiKhoang, loiKhoang };

  const ver = await scopedDb(a.actor).commissionPolicyVersion.findUnique({ where: { id: a.versionId }, select: { id: true, policyId: true, updatedAt: true } });
  if (!ver) return { ok: false, chung: KHONG_THAY };

  let pathPhamVi: string | null = null;
  if (a.orgUnitId !== null) {
    const dv = await db.orgUnit.findFirst({ where: { id: a.orgUnitId, deletedAt: null }, select: { path: true } });
    if (!dv?.path) return { ok: false, chung: "Không tìm thấy đơn vị đã chọn." };
    pathPhamVi = dv.path;
  }

  try {
    const [bc, quyTacDeXuat] = await Promise.all([dungBoiCanhTuMoc(db, a.now, KY_SOM_NHAT), docQuyTacCuaVersion(db, ver.id)]);
    const ketQua = await moPhongChinhSach({
      client: db,
      bc,
      now: a.now,
      quyTacDeXuat,
      policyIdDeXuat: ver.policyId,
      ...khoang,
      coSoTrongTamNhin: tamNhinChinhSach(a.actor),
      pathPhamVi,
      tranSoKhoan: TRAN_SO_KHOAN_THU_TINH,
    });
    return { ok: true, ketQua, phienBanCapNhatLuc: ver.updatedAt.toISOString(), chayLuc: a.now.toISOString() };
  } catch (e) {
    if (e instanceof HoaHongError) return { ok: false, chung: e.message };
    // Lỗi không lường trước ⇒ KHÔNG đưa chi tiết ra client (có thể chứa SQL/tên bảng); chỉ log tên lỗi.
    console.error("[hoa-hong/thu-tinh] lỗi", e instanceof Error ? e.name : "?");
    return { ok: false, chung: "Không thử tính được lúc này — thử lại, hoặc báo bộ phận kỹ thuật." };
  }
}
