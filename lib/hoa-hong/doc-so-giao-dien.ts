// lib/hoa-hong/doc-so-giao-dien.ts — ĐỌC cho tab Sổ (06 §5.3): trang sổ + các lựa chọn của bộ lọc.
//
// KHÔNG viết câu truy vấn sổ thứ hai (luật 12b): trang gọi `docSoHoaHong` — hàm đọc DUY NHẤT, nơi Sale bị ép về dòng của mình, QLCS bị cắt theo
// tầm nhìn cơ sở và `boLoc.nguoiHuong` của người khác bị ép về chính mình. Tệp này chỉ (1) thêm TÊN học viên cho các dòng đã qua cổng đó và (2) liệt kê các
// lựa chọn bộ lọc từ CHÍNH tập dòng người xem được thấy — nên không lộ "có tồn tại kỳ/người nào ngoài tầm nhìn".
//
// Tra tên học viên bằng `db` KHÔNG scope là chủ đích, y hệt `docSoHoaHong` đọc dòng của Sale CS1 ở CS2: tập id đã đi qua cổng phạm vi người xem; tra theo id
// không mở thêm dòng nào. Chỉ lấy `name`, không SĐT/email.
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";

import { docMocCutover } from "./cutover";
import { docSoHoaHong, phamViNguoiXem, type BoLocSo, type DongSoHienThi, type KetQuaDocSo } from "./doc-so";

/**
 * Mốc chuyển sang sổ mới ("2026-10") hoặc null khi chưa đặt. Cho dải thông tin "hoa hồng đến hết <kỳ trước mốc> vẫn chốt ở sổ cũ" (06 §6). Đọc qua `docMocCutover` —
 * nơi DUY NHẤT đọc khoá `hoaHong.kyCutover`; trang không tự đọc `SystemSetting`.
 */
export function docMocSoMoi(): Promise<string | null> {
  return docMocCutover(db);
}

export type DongSoTrang = DongSoHienThi & { tenHocVien: string | null };
export type TrangSo = Omit<KetQuaDocSo, "dong"> & { dong: DongSoTrang[] };

export async function docTrangSo(actor: Actor, boLoc: BoLocSo): Promise<TrangSo> {
  const kq = await docSoHoaHong(db, actor, boLoc);
  const ids = [...new Set(kq.dong.map((d) => d.studentId).filter((x): x is string => x !== null))];
  const hs = ids.length > 0 ? await db.student.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const ten = new Map(hs.map((h) => [h.id, h.name]));
  return { ...kq, dong: kq.dong.map((d) => ({ ...d, tenHocVien: d.studentId ? (ten.get(d.studentId) ?? null) : null })) };
}

export type LuaChonBoLocSo = {
  /** Các kỳ ("2026-10") có dòng trong tầm nhìn, mới nhất trước. */
  thang: string[];
  /** Người hưởng có dòng trong tầm nhìn — RỖNG với người chỉ có `view-self` (họ chỉ có chính mình). */
  nguoiHuong: { id: string; ten: string }[];
  nhomNguon: { code: string; ten: string }[];
  vai: { code: string; ten: string }[];
  loaiGiaoDich: { code: string; ten: string }[];
};

const TOI_DA_NGUOI = 300;

export async function docLuaChonBoLocSo(actor: Actor): Promise<LuaChonBoLocSo> {
  const { xemCoSo, dieuKien } = phamViNguoiXem(actor);
  const where = { AND: dieuKien };
  const [ky, nguoi, nhom, vai, loai] = await Promise.all([
    db.commissionTransaction.findMany({ where, distinct: ["periodId"], select: { period: { select: { period: true } } }, take: 400 }),
    xemCoSo
      ? db.commissionTransaction.groupBy({
          by: ["beneficiaryUserId", "beneficiaryName"],
          where: { AND: [...dieuKien, { beneficiaryUserId: { not: null } }] },
          orderBy: { beneficiaryName: "asc" },
          take: TOI_DA_NGUOI,
        })
      : Promise.resolve([]),
    db.leadSourceGroup.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { code: true, name: true } }),
    db.beneficiaryRole.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, name: true } }),
    db.commissionTransactionType.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, name: true } }),
  ]);
  return {
    thang: [...new Set(ky.map((k) => k.period.period))].sort().reverse(),
    // Tên trên dòng là ảnh chụp lúc ghi: cùng một người có thể mang hai tên khác nhau qua thời gian ⇒ gộp theo id (tên đầu tiên theo thứ tự chữ cái).
    nguoiHuong: [...new Map(nguoi.flatMap((n) => (n.beneficiaryUserId ? [[n.beneficiaryUserId, n.beneficiaryName] as const] : []))).entries()].map(([id, ten]) => ({ id, ten })),
    nhomNguon: nhom.map((g) => ({ code: g.code, ten: g.name })),
    vai: vai.map((v) => ({ code: v.code, ten: v.name })),
    loaiGiaoDich: loai.map((t) => ({ code: t.code, ten: t.name })),
  };
}
