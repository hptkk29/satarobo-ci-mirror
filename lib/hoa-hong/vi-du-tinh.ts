// lib/hoa-hong/vi-du-tinh.ts — TÍNH VÍ DỤ ở bước "Thử tính" của builder (06 §5.2). THUẦN.
//
// ⚠️ Đây KHÔNG phải "thử tính trên 3 tháng gần nhất" (cần dữ liệu thực thu + engine sổ — chưa có, PR10): chỉ là phép nhân
// các tỉ lệ vừa gõ với MỘT khoản thu do người dùng nhập, để họ thấy "3% của 10.000.000đ là 300.000đ". Vì vậy không có chữ
// "tác động", "so với hiện tại" ở đâu trong giao diện của nó — nói quá khả năng là nói dối.
//
// Tiền làm tròn bằng ĐÚNG hàm của engine (`tienPhanTram`); tổng so trần trên TỈ LỆ bằng số nguyên micro (như `kiemTran`).
import { khoaO, LOAI_GD_SOAN, type FormChinhSach } from "./chinh-sach-form";
import { docPhanTram } from "./phan-tram";
import { microSangPhanTram } from "./phan-tram";
import { tiLeSangMicro, tienPhanTram } from "./tien";

type MucVai = { code: string; tien: number; loaiTru: boolean };

/** Duyệt các ô ĐANG chọn (loại × vai theo thứ tự) và đọc được: PERCENT hợp lệ hoặc EXCLUDE. Ô trống / gõ dở bị bỏ. */
function* cacO(f: FormChinhSach): Generator<{ loai: string; code: string; tiLe: string | null }> {
  for (const l of LOAI_GD_SOAN) {
    if (!f.loaiGd.includes(l)) continue;
    for (const code of f.vai) {
      const o = f.o[khoaO(l, code)];
      if (!o) continue;
      if (o.kieu === "EXCLUDE") {
        yield { loai: l, code, tiLe: null };
        continue;
      }
      const r = docPhanTram(o.phanTram);
      if (r.kieu === "ok") yield { loai: l, code, tiLe: r.tiLe };
    }
  }
}

export type TongLoai = { loai: string; tongPhanTram: string; /** `null` = chưa biết trần ⇒ không kết luận. */ vuotTran: boolean | null };

/** Tổng tỉ lệ theo loại giao dịch NGAY KHI GÕ (trong riêng chính sách này; trần so với MỘT mình nó — các chính sách khác do máy chủ kiểm). */
export function tongTheoLoai(f: FormChinhSach, tran: number | null): TongLoai[] {
  const micro = new Map<string, bigint>();
  for (const o of cacO(f)) micro.set(o.loai, (micro.get(o.loai) ?? BigInt(0)) + (o.tiLe === null ? BigInt(0) : tiLeSangMicro(o.tiLe)));
  const tranMicro = tran === null ? null : tiLeSangMicro(tran);
  return [...micro.entries()].map(([loai, m]) => ({ loai, tongPhanTram: microSangPhanTram(m), vuotTran: tranMicro === null ? null : m > tranMicro }));
}

export type ViDuLoai = TongLoai & { vai: MucVai[]; tongTien: number };

export function viDuTinh(f: FormChinhSach, coSo: number, tran: number | null): ViDuLoai[] {
  if (!Number.isInteger(coSo) || coSo <= 0) throw new Error(`Cơ sở tính không hợp lệ: ${coSo}`);
  const vai = new Map<string, MucVai[]>();
  for (const o of cacO(f)) {
    const ds = vai.get(o.loai) ?? [];
    ds.push(o.tiLe === null ? { code: o.code, tien: 0, loaiTru: true } : { code: o.code, tien: tienPhanTram(coSo, o.tiLe), loaiTru: false });
    vai.set(o.loai, ds);
  }
  const tong = new Map(tongTheoLoai(f, tran).map((t) => [t.loai, t]));
  return [...vai.entries()].map(([loai, ds]) => ({ ...tong.get(loai)!, vai: ds, tongTien: ds.reduce((s, x) => s + x.tien, 0) }));
}
