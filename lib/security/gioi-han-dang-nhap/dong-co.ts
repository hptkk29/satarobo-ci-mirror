import { createHash } from "node:crypto";

import { CHINH_SACH_DE_XUAT, MOI_LY_DO_CHAN, type ChinhSach, type LyDoChan } from "./chinh-sach";
import type { KhoDem } from "./kho";

/**
 * ĐỘNG CƠ giới hạn đăng nhập dùng chung web + mobile (xem `chinh-sach.ts`, nối sau cờ `LOGIN_LIMITER_V2`).
 *
 *   const q = await gioiHan.kiemTruoc({ ip, dinhDanh: dinhDanhChuanHoa(thoNhap), now });
 *   if (!q.cho) → trả lỗi CHUNG (KHÔNG nói lý do) — lý do chỉ ghi giám sát;
 *   … so mật khẩu … ĐÚNG và đủ điều kiện ⇒ `await q.thanhCong()` (hoàn lượt + ghi dấu ấy "đã từng thành công"); SAI ⇒ không làm gì (lượt đã bị tính).
 *
 * Tăng-trước-rồi-kiểm (đặt chỗ) chứ không đọc-rồi-ghi: 100 yêu cầu song song không lách được ngưỡng trong lúc bcrypt đang chạy.
 * KHÔNG nhận định danh thiết bị từ client (xem `chinh-sach.ts`): "quen" chỉ là dấu ấy do máy chủ ghi sau lần đăng nhập thành công của đúng cặp (định danh, IP).
 */
export type DauVao = { ip: string; dinhDanh: string; now: Date };
export type KetQuaKiemTruoc =
  | { cho: true; /** có đi qua L3 nhờ dấu ấy "đã từng thành công" (để giám sát) */ quen: boolean; hoan: () => Promise<void>; thanhCong: () => Promise<void> }
  | { cho: false; lyDo: LyDoChan; thuLaiSauGiay: number };

export class LoiKhongDemDuoc extends Error {
  constructor(public readonly nguyen: unknown) {
    super("Không đếm được lượt thử");
    this.name = "LoiKhongDemDuoc";
  }
}

const bam = (ngan: string, giaTri: string): string => createHash("sha256").update(`${ngan}:${giaTri}`, "utf8").digest("hex");

export function taoGioiHan(kho: KhoDem, cs: ChinhSach = CHINH_SACH_DE_XUAT) {
  const thuLai = Math.ceil(cs.cuaSoMs / 1000);
  return {
    async kiemTruoc(v: DauVao): Promise<KetQuaKiemTruoc> {
      const kIp = bam("gh:ip", v.ip);
      const kLuot = bam("gh:ip-luot", v.ip);
      const kCap = bam("gh:cap", `${v.dinhDanh}|${v.ip}`);
      const kId = bam("gh:id", v.dinhDanh);
      const kQuen = bam("gh:id-quen", `${v.dinhDanh}|${v.ip}`);
      const kOk = bam("gh:ok", `${v.dinhDanh}|${v.ip}`);
      const da: string[] = []; // khoá đã tăng — để hoàn lại khi đăng nhập ĐÚNG
      const chan = async (lyDo: LyDoChan): Promise<KetQuaKiemTruoc> => {
        // Giám sát: bộ đếm ẩn danh theo lý do (cửa sổ 1 giờ). Hỏng ⇒ bỏ qua — giám sát không được làm đổi quyết định chặn.
        await kho.tang(bam("gh:chan", lyDo), v.now, cs.giamSatMs).catch(() => undefined);
        return { cho: false, lyDo, thuLaiSauGiay: thuLai };
      };
      let quen = false;
      try {
        const luot = await kho.tang(kLuot, v.now, cs.cuaSoMs);
        if (luot > cs.ipLuot) return await chan("ip-luot");
        const ip = await kho.tang(kIp, v.now, cs.cuaSoMs);
        da.push(kIp);
        if (ip > cs.ipSai) return await chan("ip");
        const cap = await kho.tang(kCap, v.now, cs.cuaSoMs);
        da.push(kCap);
        if (cap > cs.capDinhDanhIp) return await chan("dinh-danh-ip"); // DỪNG: không làm phồng bộ đếm toàn cục của nạn nhân
        const id = await kho.tang(kId, v.now, cs.cuaSoMs);
        da.push(kId);
        if (id > cs.dinhDanhToanCuc) {
          // Dò phân tán đang diễn ra. Chỉ cặp ĐÃ TỪNG thành công (dấu ấy do máy chủ ghi) được thử thêm, và chỉ `quenToiDa` lượt — không bao giờ miễn trừ.
          const daTungOk = (await kho.doc(kOk, v.now, cs.hanTinCayMs)) > 0;
          if (!daTungOk) return await chan("dinh-danh-toan-cuc");
          const q = await kho.tang(kQuen, v.now, cs.cuaSoMs);
          da.push(kQuen);
          if (q > cs.quenToiDa) return await chan("dinh-danh-toan-cuc-quen");
          quen = true;
        }
      } catch (e) {
        throw new LoiKhongDemDuoc(e);
      }
      const hoanTat = async () => {
        for (const k of da) await kho.hoan(k, v.now, cs.cuaSoMs).catch(() => undefined); // hoàn hỏng ⇒ chỉ chặt hơn, không lỏng hơn
      };
      return {
        cho: true,
        quen,
        hoan: hoanTat,
        thanhCong: async () => {
          await hoanTat();
          // Ghi dấu ấy SAU khi mật khẩu đã đúng. Hỏng ⇒ bỏ qua (mất dấu ấy chỉ làm chặt hơn). Cửa sổ dài: `tang` giữ nguyên `cuaSoTu` đến khi hết hạn.
          await kho.tang(kOk, v.now, cs.hanTinCayMs).catch(() => undefined);
        },
      };
    },
  };
}
export type GioiHanDangNhap = ReturnType<typeof taoGioiHan>;

/** Số lần chặn theo lý do trong cửa sổ giám sát (1 giờ) — số ẩn danh, không có định danh/IP. */
export async function docGiamSat(kho: KhoDem, now: Date, cs: ChinhSach = CHINH_SACH_DE_XUAT): Promise<Record<LyDoChan, number>> {
  const kq = {} as Record<LyDoChan, number>;
  for (const l of MOI_LY_DO_CHAN) kq[l] = await kho.doc(bam("gh:chan", l), now, cs.giamSatMs);
  return kq;
}
