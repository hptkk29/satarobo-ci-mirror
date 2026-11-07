/**
 * ĐỊA CHỈ NƠI Ở của phụ huynh khai ở bước «Lưu» của DISC (05/11/2026) — dùng để chia lead về cơ sở GẦN NHÀ hơn (`lib/lead/chia-theo-phuong.ts`).
 *
 * Chủ dự án chốt: THÀNH PHỐ chọn sẵn «Tp Đà Nẵng» nhưng đổi được; PHƯỜNG/XÃ BẮT BUỘC chọn trong danh sách; SỐ NHÀ/ĐƯỜNG KHÔNG bắt buộc
 * (không chắc phụ huynh nhập rõ); thêm ô TUỲ CHỌN «cơ sở nào gần nhà bạn» (khách tự chọn thì thắng mọi quy tắc chia).
 *
 * ⚠️ Server-only: so khớp với danh mục `vietnam-address-data` (≈420 KB) — KHÔNG import tệp này từ code chạy ở trình duyệt. Form lấy danh sách
 * qua `GET /api/disc/dia-chi`.
 *
 * Cổng `luu.ts` nhận `diaChi` là TUỲ CHỌN ở phía máy chủ: bản JS cũ còn nằm trong tab trình duyệt (trước lúc triển khai) gửi lên không có trường này
 * vẫn phải lưu được — «bắt buộc phường/xã» là luật của FORM, và của `kiemTraDiaChi` KHI CÓ gửi.
 */
import { z } from "zod";
import { operationalLocations } from "@/lib/locations";
import { danhSachPhuongCuaTinh, idTinhTheoTen } from "@/lib/lead/phuong-xa";

export type DiaChiKhai = {
  readonly thanhPho: string;
  readonly phuong: string;
  /** Số nhà, đường — tuỳ chọn; một dòng, đã bỏ ký tự điều khiển. */
  readonly soNha: string | null;
  /** Mã cơ sở khách tự chọn («CS1»/«CS2»), hoặc null. */
  readonly coSoGanNha: string | null;
};

export const diaChiSchema = z.object({
  thanhPho: z.string().trim().min(1, "Vui lòng chọn thành phố").max(100),
  phuong: z.string().trim().min(1, "Vui lòng chọn phường/xã nơi nhà bạn ở").max(120),
  soNha: z.string().max(200).nullish(),
  coSoGanNha: z.string().trim().max(10).nullish(),
});

/** Mã các cơ sở đang vận hành mà khách chọn được (lấy từ danh sách công khai của trang — một nguồn). */
export function maCoSoChonDuoc(): string[] {
  return operationalLocations().map((l) => l.code);
}

// eslint-disable-next-line no-control-regex
const KY_TU_DIEU_KHIEN = /[\u0000-\u001f\u007f]+/g;

export type KetQuaDiaChi = { ok: true; diaChi: DiaChiKhai | null } | { ok: false; loi: { truong: string; thongBao: string }[] };

/**
 * `null`/`undefined` ⇒ KHÔNG khai (bản máy khách cũ) ⇒ `ok: true, diaChi: null`. Có khai ⇒ phải hợp lệ: thành phố và phường/xã đúng tên trong danh mục
 * (phường thuộc ĐÚNG thành phố đó), cơ sở chọn tay là một cơ sở đang vận hành.
 */
export function kiemTraDiaChi(raw: unknown): KetQuaDiaChi {
  if (raw === undefined || raw === null) return { ok: true, diaChi: null };
  const p = diaChiSchema.safeParse(raw);
  if (!p.success) return { ok: false, loi: p.error.issues.map((i) => ({ truong: `diaChi.${i.path.join(".")}`, thongBao: i.message })) };
  const d = p.data;
  const tinhId = idTinhTheoTen(d.thanhPho);
  if (!tinhId) return { ok: false, loi: [{ truong: "diaChi.thanhPho", thongBao: "Thành phố/tỉnh chưa đúng — vui lòng chọn lại trong danh sách" }] };
  if (!danhSachPhuongCuaTinh(tinhId).includes(d.phuong)) {
    return { ok: false, loi: [{ truong: "diaChi.phuong", thongBao: "Phường/xã không thuộc thành phố đã chọn — vui lòng chọn lại trong danh sách" }] };
  }
  const coSo = d.coSoGanNha ? d.coSoGanNha : null;
  if (coSo && !maCoSoChonDuoc().includes(coSo)) {
    return { ok: false, loi: [{ truong: "diaChi.coSoGanNha", thongBao: "Cơ sở đã chọn không hợp lệ" }] };
  }
  const soNha = (d.soNha ?? "").replace(KY_TU_DIEU_KHIEN, " ").replace(/\s+/g, " ").trim();
  return { ok: true, diaChi: { thanhPho: d.thanhPho, phuong: d.phuong, soNha: soNha ? soNha : null, coSoGanNha: coSo } };
}
