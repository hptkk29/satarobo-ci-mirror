/**
 * PHIẾU «để lại thông tin» của Tủ sách + Sức khỏe (07/11/2026) — hợp đồng THUẦN giữa form (trình duyệt) và máy chủ.
 *
 * Luật cứng (thiết kế artifact «Sata Robo — Website mới», hộp lead-gate): phiếu CHỈ gồm thông tin liên hệ — họ tên · SĐT · tỉnh/thành · phường/xã (BẮT BUỘC) ·
 * số nhà (tuỳ chọn) · hai ô đồng ý. KHÔNG có trường nào cho câu trả lời / kết quả sức khỏe: dữ liệu sức khỏe không bao giờ rời trình duyệt qua phiếu này.
 * Cố ý không có `.passthrough()`: `z.object` GỠ khoá lạ, nên trình duyệt có gắn thêm "ketQua"/"traLoi" thì máy chủ cũng không nhận (lưới [CTT-PH-04]).
 *
 * Địa chỉ đi qua `kiemTraDiaChi` của DISC (cùng danh mục `vietnam-address-data`, cùng luật «phường thuộc ĐÚNG thành phố»).
 */
import { z } from "zod";
import { canonicalPhone } from "@/lib/phone";
import { kiemTraDiaChi, type DiaChiKhai } from "@/lib/disc/dia-chi";

export const NGUON_CONG_THONG_TIN = ["tu-sach", "suc-khoe"] as const;
export type NguonCongThongTin = (typeof NGUON_CONG_THONG_TIN)[number];

// eslint-disable-next-line no-control-regex
const KY_TU_DIEU_KHIEN = /[\u0000-\u001f\u007f]+/g;

export const phieuSchema = z.object({
  hoTen: z.string().max(100),
  soDienThoai: z.string().max(30),
  thanhPho: z.string().max(100),
  phuong: z.string().max(120),
  soNha: z.string().max(200).nullish(),
  dongY: z.object({ xuLyHoSo: z.boolean(), tiepThi: z.boolean() }),
  nguon: z.enum(NGUON_CONG_THONG_TIN),
  /** Ngữ cảnh ngắn của lần để lại thông tin, vd `ebook:12` — chỉ để ghi chú lead; không nhận gì khác. */
  nguCanh: z.string().max(40).nullish(),
  /** Ô BẪY ẩn khỏi người dùng: người thật luôn để trống. Có chữ ⇒ coi là máy (route trả thành công giả, không tạo lead). */
  bay: z.string().max(200).nullish(),
});

export type PhieuHopLe = {
  hoTen: string;
  /** SĐT chuẩn hoá `84…`. */
  soDienThoai: string;
  diaChi: DiaChiKhai;
  tiepThi: boolean;
  nguon: NguonCongThongTin;
  nguCanh: string | null;
};

export type TruongLoi = "hoTen" | "soDienThoai" | "thanhPho" | "phuong" | "soNha" | "dongY" | "khac";
export type KetQuaPhieu =
  | { ok: true; phieu: PhieuHopLe; laMay: boolean }
  | { ok: false; loi: { truong: TruongLoi; thongBao: string }[] };

const sachChuoi = (s: string) => s.replace(KY_TU_DIEU_KHIEN, " ").replace(/\s+/g, " ").trim();

/** Ngữ cảnh chỉ nhận ký tự an toàn (chữ, số, `:` `-` `_`): nó đi vào ghi chú lead nên không để lọt xuống dòng/ký tự lạ. */
const NGU_CANH_AN_TOAN = /^[a-z0-9:_-]{1,40}$/i;

export function kiemTraPhieu(raw: unknown): KetQuaPhieu {
  const p = phieuSchema.safeParse(raw);
  if (!p.success) return { ok: false, loi: [{ truong: "khac", thongBao: "Dữ liệu gửi lên chưa đúng" }] };
  const d = p.data;
  const loi: { truong: TruongLoi; thongBao: string }[] = [];

  const hoTen = sachChuoi(d.hoTen);
  if (hoTen.length < 2) loi.push({ truong: "hoTen", thongBao: "Anh chị nhập họ và tên giúp Sata Robo nhé." });

  const sdt = d.soDienThoai.replace(/[\s.\-()]/g, "");
  const chuan = canonicalPhone(sdt);
  if (!sdt) loi.push({ truong: "soDienThoai", thongBao: "Anh chị nhập số điện thoại nhé." });
  else if (!chuan) loi.push({ truong: "soDienThoai", thongBao: "Số điện thoại gồm 10 chữ số, bắt đầu bằng 0." });

  if (!d.dongY.xuLyHoSo) loi.push({ truong: "dongY", thongBao: "Anh chị cần đồng ý để Sata Robo gửi kết quả." });

  const dc = kiemTraDiaChi({ thanhPho: d.thanhPho, phuong: d.phuong, soNha: d.soNha ?? null, coSoGanNha: null });
  let diaChi: DiaChiKhai | null = null;
  if (!dc.ok) {
    for (const l of dc.loi) {
      const truong: TruongLoi = l.truong.endsWith("thanhPho") ? "thanhPho" : l.truong.endsWith("phuong") ? "phuong" : "soNha";
      loi.push({ truong, thongBao: truong === "phuong" ? "Anh chị chọn phường/xã trong danh sách — Sata Robo cần thông tin này để kết nối cơ sở gần nhà." : l.thongBao });
    }
  } else if (!dc.diaChi) {
    loi.push({ truong: "phuong", thongBao: "Anh chị chọn phường/xã trong danh sách — Sata Robo cần thông tin này để kết nối cơ sở gần nhà." });
  } else {
    diaChi = dc.diaChi;
  }

  const nguCanh = d.nguCanh ? d.nguCanh.trim() : null;
  if (nguCanh && !NGU_CANH_AN_TOAN.test(nguCanh)) loi.push({ truong: "khac", thongBao: "Dữ liệu gửi lên chưa đúng" });

  if (loi.length > 0 || !diaChi || !chuan) return { ok: false, loi };
  return {
    ok: true,
    laMay: !!(d.bay && d.bay.trim()),
    phieu: { hoTen, soDienThoai: chuan, diaChi, tiepThi: d.dongY.tiepThi, nguon: d.nguon, nguCanh },
  };
}
