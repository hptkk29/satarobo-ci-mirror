import { createHmac } from "node:crypto";

import type { CauChuanHoa, MaDang } from "./chuan-hoa";

/**
 * ENGINE CÂU HỎI — BƯỚC 2: HÌNH CHIẾU gửi xuống người làm bài (ALLOW-LIST, không bao giờ "bản gốc trừ vài khoá").
 *
 * Ba bảo đảm, mỗi bảo đảm có ca test riêng:
 *  1. KHÔNG có đáp án: mỗi nhánh dưới đây TỰ LIỆT KÊ các trường được gửi — thêm trường vào `meta` không bao giờ tự lọt xuống client.
 *  2. ID KHÔNG MÃ HOÁ ĐÁP ÁN: id của mục sắp xếp / ghép cặp / phân loại là HMAC(seed, câu | loại | chỉ số) — không phải chỉ số gốc, không phải
 *     "l0/r0", không đơn điệu theo thứ tự đúng. Cùng (seed, câu) ⇒ cùng id ⇒ tải lại lượt làm không đổi gì.
 *  3. XÁO ỔN ĐỊNH: thứ tự xáo suy từ `seed` (khoá của LƯỢT LÀM), không từ Math.random ⇒ khôi phục bản nháp trả đúng thứ tự cũ; và thứ tự xáo
 *     KHÔNG BAO GIỜ trùng thứ tự đúng (nếu hoán vị ngẫu nhiên ra đúng đáp án thì xoay một vị trí).
 * Thuần (không DB). Ảnh: bên gọi truyền `kyAnh` (ký URL ngắn hạn); không truyền ⇒ ảnh bị bỏ (fail-closed, không bao giờ URL công khai).
 */

export type TuyChonChieu = {
  /** Khoá của LƯỢT LÀM (đã trộn bí mật máy chủ). Cùng seed ⇒ cùng hình chiếu. */
  seed: string;
  xaoLuaChon: boolean;
  kyAnh?: (url: string) => string | null;
};

export const idMu = (seed: string, cauId: string, loai: string, chiSo: number): string => "x" + createHmac("sha256", seed).update(`${cauId}|${loai}|${chiSo}`).digest("hex").slice(0, 12);

/** PRNG mulberry32 từ hạt 32 bit. */
function mulberry32(h: number) {
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hoán vị của [0..n) suy từ (seed, khoá). `tranhDongNhat`: n ≥ 2 thì kết quả ≠ hoán vị đồng nhất. */
export function hoanViTheoHat(seed: string, khoa: string, n: number, tranhDongNhat: boolean): number[] {
  const hat = createHmac("sha256", seed).update(`xao|${khoa}`).digest().readUInt32BE(0);
  const rnd = mulberry32(hat);
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  if (tranhDongNhat && n >= 2 && p.every((v, i) => v === i)) p.push(p.shift()!); // xoay một vị trí
  return p;
}

export type CauChieu = Record<string, unknown> & { id: string; dang: MaDang; de: string; anh: string | null; diem: number };
export type KetQuaChieu = { ok: true; cau: CauChieu } | { ok: false; loi: string };

const lamTron = (x: number) => Math.round(x * 100) / 100;

export function chieuCauHoi(c: CauChuanHoa, opt: TuyChonChieu): KetQuaChieu {
  const g = c.goc;
  const anhDe = g.imageUrl ? (opt.kyAnh?.(g.imageUrl) ?? null) : null;
  const goc = { id: g.id, de: g.text, anh: anhDe, diem: lamTron(g.points) };
  const ky = (u: string | null | undefined): string | null => (u ? (opt.kyAnh?.(u) ?? null) : null);

  switch (c.dang) {
    case "chon_mot":
    case "chon_nhieu":
    case "dung_sai": {
      const thuTu = c.dang !== "dung_sai" && opt.xaoLuaChon ? hoanViTheoHat(opt.seed, `${g.id}|lc`, c.luaChon.length, false) : c.luaChon.map((_, i) => i);
      return { ok: true, cau: { ...goc, dang: c.dang, luaChon: thuTu.map((i) => ({ id: c.luaChon[i]!.id, noiDung: c.luaChon[i]!.text, anh: ky(c.luaChon[i]!.imageUrl) })) } };
    }
    case "ngan":
      return { ok: true, cau: { ...goc, dang: "ngan", doDaiToiDa: 200 } };
    case "tu_luan":
      return { ok: true, cau: { ...goc, dang: "tu_luan", doDaiToiDa: 5000 } };
    case "dien_khuyet":
      return { ok: true, cau: { ...goc, dang: "dien_khuyet", manh: [...c.manh] } };
    case "ghep_cap": {
      const t = hoanViTheoHat(opt.seed, `${g.id}|gt`, c.trai.length, true);
      const p = hoanViTheoHat(opt.seed, `${g.id}|gp`, c.phai.length, true);
      return {
        ok: true,
        cau: {
          ...goc,
          dang: "ghep_cap",
          ve_trai: t.map((i) => ({ id: idMu(opt.seed, g.id, "t", i), noiDung: c.trai[i]! })),
          ve_phai: p.map((i) => ({ id: idMu(opt.seed, g.id, "p", i), noiDung: c.phai[i]! })),
        },
      };
    }
    case "sap_xep": {
      const t = hoanViTheoHat(opt.seed, `${g.id}|sx`, c.muc.length, true);
      return { ok: true, cau: { ...goc, dang: "sap_xep", muc: t.map((i) => ({ id: idMu(opt.seed, g.id, "m", i), noiDung: c.muc[i]! })) } };
    }
    case "nop_san_pham":
      return { ok: true, cau: { ...goc, dang: "nop_san_pham", loaiTep: "video", soTepToiDa: 1 } };
    case "phan_loai": {
      const t = hoanViTheoHat(opt.seed, `${g.id}|pl`, c.the.length, false);
      return {
        ok: true,
        cau: {
          ...goc,
          dang: "phan_loai",
          nhom: c.nhom.map((n, i) => ({ id: idMu(opt.seed, g.id, "n", i), ten: n.ten })),
          the: t.map((i) => ({ id: idMu(opt.seed, g.id, "c", i), noiDung: c.the[i]!.noiDung })),
        },
      };
    }
    case "chon_tren_hinh": {
      const url = ky(c.hinh.url);
      if (!url) return { ok: false, loi: "Không ký được ảnh của câu chọn trên hình (kho riêng chưa cấu hình?) — không phục vụ câu này." };
      return { ok: true, cau: { ...goc, dang: "chon_tren_hinh", hinh: { url, rong: c.hinh.rong, cao: c.hinh.cao }, soDiemToiDa: c.soDiemToiDa } };
    }
    case "nhap_so":
      return { ok: true, cau: { ...goc, dang: "nhap_so", donVi: c.donVi, choPhepThapPhan: c.choPhepThapPhan } };
    case "sap_khoi_lenh":
      return {
        ok: true,
        cau: {
          ...goc,
          dang: "sap_khoi_lenh",
          hopKhoi: c.hopKhoi.map((k) => ({ id: k.id, nhan: k.nhan, loai: k.loai })),
          soKhoiToiDa: c.soKhoiToiDa,
          banDo: { hang: c.banDo.hang, cot: c.banDo.cot, tuong: c.banDo.tuong.map((w) => [w[0], w[1]]), dich: [...c.banDo.dich], batDau: [...c.banDo.batDau], huong: c.banDo.huong },
        },
      };
  }
}
