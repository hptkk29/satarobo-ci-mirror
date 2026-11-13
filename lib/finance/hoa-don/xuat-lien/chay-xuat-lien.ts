import "server-only";
import { writeAudit } from "@/lib/audit/audit-log";
import type { CongHoaDon } from "@/lib/misa/meinvoice/cong";
import { ngayVN } from "@/lib/format/thoi-gian-vn";
import { SYSTEM_ACTOR } from "@/lib/auth/system-actor";
import { db } from "@/lib/db";
import { layCongHsmChoPhapNhan } from "../ket-noi/cong-theo-phap-nhan";
import { CAU_TAM_DUNG_KY, kyDangTamDung } from "../ky-chinh-sach/ky-chinh-sach-db";
import { baoHanMuc, ghiNhanChoHanMuc, ghiNhanTanSuatCao, gomHanMucMoi, type GomHanMuc } from "../ky-chinh-sach/bao-han-muc-db";
import { laKyUsbBat } from "../feature";
import { phapNhanMaPhatHanhChoCoSo } from "../ket-noi/phap-nhan-phat-hanh";
import { laMisaPhatHanhBat } from "../feature";
import { napHangChoHoaDon } from "../hang-cho";
import { khoHoaDonDaCauHinh } from "../kho-tep";
import { batDauPhatHanh, guiPhatHanh, LoiPhatHanh, thongDiepLoiPhatHanh } from "../phat-hanh-misa";
import { TEN_NHA_CUNG_CAP_API, type NhaCungCapApi } from "../phap-nhan";
import { napTrangPhieuCho } from "../trang-phieu-cho";
import { NHAN_BO_QUA_TU_XUAT, lyDoBoQuaTuXuat, type MaBoQuaTuXuat } from "./chon-lan-thu";

// lib/finance/hoa-don/xuat-lien/chay-xuat-lien.ts — «XUẤT LIỀN» (nút của Sale, BGĐ đổi yêu cầu 09/11/2026). [Trước đó tệp này là «tự xuất sau n giờ kể từ lúc phụ huynh điền form QR» (BGĐ 03/11) — đã GỠ.]
//
// ─────────────────────────────────────────────────────────────────────────────
// LÀM GÌ
//   Phụ huynh đã gửi thông tin xuất hoá đơn và CẦN LIỀN: Sale đối chiếu ở hộp xác nhận rồi bấm ⇒ `xuatLienDon` PHÁT HÀNH hoá đơn cho các lần thu đang chờ xuất của đơn — MỖI LẦN THU MỘT HOÁ ĐƠN, với thông
//   tin người mua nằm sẵn trên đơn — rồi ĐÓNG yêu cầu (DANG_MO → DA_AP_DUNG: liên kết hết dùng được, phụ huynh không «sửa» hoá đơn đã xuất) và xếp thư gửi phụ huynh NGAY.
//   Phụ huynh không cần liền thì KHÔNG bấm: lần thu đi cùng lô cuối ngày 23h30 (`xuat-lo-dem`).
//
// KHÔNG TỰ VIẾT LẠI MÁY PHÁT HÀNH — đi qua CHÍNH `batDauPhatHanh` + `guiPhatHanh` mà nút «Phát hành» và lô cuối ngày dùng (khoá đơn, mọi cổng của `chotHoaDon`, cấu hình hoá đơn của cơ sở, cổng theo pháp nhân,
//   hạn mức ký tự động). Không truyền `loDem`: người mua là thông tin PHỤ HUYNH khai (hoặc nhân viên sửa), không phải «người tiêu dùng» — máy phát hành đọc từ đơn và từ chối nếu còn thiếu.
//
// AN TOÀN (đừng nới)
//   1. Chọn lần thu ở `chon-lan-thu.ts`: mọi khoản đã được kế toán xác nhận, không ngoại lệ. Hệ thống KHÔNG tự xác nhận tiền — Sale cũng không xác nhận tiền được.
//   2. Mỗi lần thu là một giao dịch riêng; lỗi một lần thu không làm hỏng các lần thu khác. `KHONG_RO` của nhà cung cấp → giữ nguyên, cron đối soát tra lại bằng refId.
//   3. Quyền + cờ cơ sở + dấu đối chiếu kiểm ở ACTION (`orders/_actions-nguoi-mua.ts`) TRƯỚC khi gọi tệp này.
// ─────────────────────────────────────────────────────────────────────────────

/** Trần số hoá đơn PHÁT HÀNH THẬT mỗi lượt (10 phút một lượt) — phần còn lại để lượt sau. */
export const TRAN_PHAT_HANH_MOI_LUOT = 10;
const TRAN_MAU_BAO_CAO = 100;

export type MaBoQuaTuXuatLuot = MaBoQuaTuXuat | "KHONG_NAP_DUOC_PHIEU" | "CONG_NHA_CUNG_CAP" | "PHAT_HANH_TU_CHOI" | "VUOT_TRAN" | "VUOT_HAN_MUC";

export type DongBaoCaoTuXuat = {
  maDon: string;
  ngayThu: string;
  soTien: number;
  /** DA_XUAT · DANG_PHAT_HANH · LOI_PHAT_HANH · BO_QUA */
  ketQua: "DA_XUAT" | "DANG_PHAT_HANH" | "LOI_PHAT_HANH" | "BO_QUA";
  lyDo: string | null;
};

export type KetQuaTuXuat = {
  coSo: number;
  /** Yêu cầu đã tới giờ (trước khi xét lần thu). */
  yeuCauToiGio: number;
  daXuat: number;
  dangPhatHanh: number;
  loiPhatHanh: number;
  /** Yêu cầu đã ĐÓNG vì có ít nhất một hoá đơn được tạo. */
  daDongYeuCau: number;
  boQua: Partial<Record<MaBoQuaTuXuatLuot, number>>;
  dungSom: boolean;
  /** Nhãn ngắn của lỗi cấp lượt — KHÔNG kèm câu lỗi gốc (có thể mang dữ liệu). */
  loi: string | null;
  mau: DongBaoCaoTuXuat[];
};

const rong = (): KetQuaTuXuat => ({ coSo: 0, yeuCauToiGio: 0, daXuat: 0, dangPhatHanh: 0, loiPhatHanh: 0, daDongYeuCau: 0, boQua: {}, dungSom: false, loi: null, mau: [] });

const maLoi = (e: unknown): string => {
  const ma = (e as { code?: unknown } | null)?.code;
  if (typeof ma === "string" && /^[A-Z0-9_]{2,12}$/.test(ma)) return ma;
  return e instanceof Error && /^[A-Za-z]{2,40}$/.test(e.name) ? e.name : "LOI";
};

/**
 * Cổng phát hành theo PHÁP NHÂN, nhớ trong MỘT lượt (không hỏi lại cho từng lần thu). Tách khỏi luồng «tự xuất sau n giờ» đã gỡ (09/11/2026) để «Xuất liền» của Sale dùng CHÍNH nó — đúng từng chữ cũ.
 */
function taoLayCong(now: Date): (ncc: NhaCungCapApi, centerId: string) => Promise<CongNcc> {
  // Cổng theo PHÁP NHÂN của cơ sở. Pháp nhân ký USB token ⇒ `ok: false` — cron KHÔNG BAO GIỜ tự ký/phát hành cho họ (chờ kế toán ký lô).
  const congTheoPhapNhan = new Map<string, CongNcc>();
  let phatHanhBat: boolean | null = null;
  const layCong = async (ncc: NhaCungCapApi, centerId: string): Promise<CongNcc> => {
    const ten = TEN_NHA_CUNG_CAP_API[ncc];
    const phapNhanMa = await phapNhanMaPhatHanhChoCoSo(SYSTEM_ACTOR, centerId, ngayVN(now));
    const khoa = phapNhanMa ?? `?${centerId}`;
    const da = congTheoPhapNhan.get(khoa);
    if (da) {
      // Cổng đã nhớ trong lượt NÀY: hỏi lại tạm dừng ngay trước mỗi lần dùng — Quản trị tối cao có thể bấm dừng giữa lượt chạy.
      if (da.ok && (await kyDangTamDung(da.phapNhanMa)).tamDung) return { ok: false, lyDo: CAU_TAM_DUNG_KY };
      return da;
    }
    phatHanhBat ??= await laMisaPhatHanhBat();
    let r: CongNcc;
    if (!phatHanhBat) r = { ok: false, lyDo: `Phát hành qua ${ten} chưa được bật (Cấu hình vận hành)` };
    else if (!khoHoaDonDaCauHinh()) r = { ok: false, lyDo: "Kho lưu hoá đơn chưa cấu hình" };
    else if (!phapNhanMa) r = { ok: false, lyDo: "Không xác định được pháp nhân phát hành của cơ sở" };
    else {
      const kq = await layCongHsmChoPhapNhan(phapNhanMa, "GUI");
      const nccCong = kq.ok ? kq.nhaCungCap : kq.usb ? kq.nhaCungCap : undefined;
      // Dòng đã dựng theo nhà cung cấp lúc TẢI; pháp nhân vừa đổi nhà cung cấp giữa chừng ⇒ bỏ qua dòng này, lượt sau chạy theo cấu hình mới (không gửi sang nơi khác).
      if (nccCong !== undefined && nccCong !== ncc) r = { ok: false, lyDo: "Nhà cung cấp hoá đơn của pháp nhân vừa được đổi — lượt sau sẽ chạy theo cấu hình mới" };
      else {
        r = kq.ok
          ? { ok: true, cong: kq.cong, phapNhanMa, nhaCungCap: kq.nhaCungCap }
          : { ok: false, lyDo: kq.lyDo, ...(kq.usb ? { usb: true as const, ...(kq.nhaCungCap ? { nhaCungCap: kq.nhaCungCap } : {}) } : {}) };
      }
    }
    congTheoPhapNhan.set(khoa, r);
    return r;
  };
  return layCong;
}

const tang = (kq: KetQuaTuXuat, ma: MaBoQuaTuXuatLuot) => {
  kq.boQua[ma] = (kq.boQua[ma] ?? 0) + 1;
};

// `nhaCungCap` = nhà cung cấp của cổng VỪA LẤY (05/11/2026) — truyền thẳng vào `batDauPhatHanh`, không suy lại từ `phanMem`.
type CongNcc = { ok: true; cong: CongHoaDon; phapNhanMa: string; nhaCungCap: NhaCungCapApi } | { ok: false; lyDo: string; usb?: true; nhaCungCap?: NhaCungCapApi };

/** Một yêu cầu đã tới giờ → hoá đơn cho các lần thu đang chờ xuất của đơn. Trả số hoá đơn được TẠO (đã xác nhận hoặc đang phát hành). */
async function xuLyMotYeuCau(
  kq: KetQuaTuXuat,
  yc: { orderId: string; centerId: string },
  ctx: { now: Date; nguoiBam: { id: string; name: string }; xuatLien?: boolean; conThoiGian: () => boolean; layCong: (ncc: NhaCungCapApi, centerId: string) => Promise<CongNcc>; daPhatHanh: () => number; themPhatHanh: (n?: number) => void; gom: GomHanMuc },
): Promise<number> {
  let dong;
  try {
    dong = (await napHangChoHoaDon(SYSTEM_ACTOR, { canViewPii: true, orderId: yc.orderId })).dong;
  } catch (e) {
    kq.loi ??= `HANG_CHO:${maLoi(e)}`;
    return 0;
  }
  const cho = dong.filter((d) => d.ngan === "cho");
  if (cho.length === 0) return 0;
  const chuaXacNhan = await db.payment.findMany({ where: { id: { in: [...new Set(cho.flatMap((d) => d.khoanIds))] }, accountantStatus: { not: "CONFIRMED" } }, select: { id: true } });
  const bc = { khoanChuaXacNhan: new Set(chuaXacNhan.map((p) => p.id)) };

  let taoDuoc = 0;
  // Cũ nhất trước: hoá đơn đánh số theo thứ tự phát hành, lần thu cũ nên có số nhỏ hơn.
  for (const d of [...cho].sort((a, b) => a.ngayThu.localeCompare(b.ngayThu) || a.ghiNhanLuc.localeCompare(b.ghiNhanLuc))) {
    const ghi = (ketQua: DongBaoCaoTuXuat["ketQua"], lyDo: string | null) => {
      if (kq.mau.length < TRAN_MAU_BAO_CAO) kq.mau.push({ maDon: d.maDon, ngayThu: d.ngayThu, soTien: d.soTien, ketQua, lyDo });
    };
    const bo = (ma: MaBoQuaTuXuatLuot, lyDo: string) => {
      tang(kq, ma);
      ghi("BO_QUA", lyDo);
    };
    const loai = lyDoBoQuaTuXuat({ ngan: d.ngan, phatHanhHien: d.phatHanhMisa.hien, coNgoaiLe: d.hanhDong.ngoaiLe != null, cocChuaTraDu: d.cocChuaTraDu, khoanIds: d.khoanIds }, bc);
    if (loai) {
      tang(kq, loai);
      continue;
    }
    if (!ctx.conThoiGian()) {
      kq.dungSom = true;
      return taoDuoc;
    }
    if (ctx.daPhatHanh() >= TRAN_PHAT_HANH_MOI_LUOT) {
      kq.dungSom = true;
      bo("VUOT_TRAN", `Đã tới trần ${TRAN_PHAT_HANH_MOI_LUOT} hoá đơn mỗi lượt — lượt sau làm tiếp`);
      return taoDuoc;
    }
    let nap;
    try {
      nap = await napTrangPhieuCho(SYSTEM_ACTOR, d);
    } catch (e) {
      kq.loiPhatHanh += 1;
      bo("KHONG_NAP_DUOC_PHIEU", `Không nạp được phiếu (${maLoi(e)})`);
      continue;
    }
    if (!nap.ok) {
      bo("KHONG_NAP_DUOC_PHIEU", nap.error);
      continue;
    }
    const cn = await ctx.layCong(d.phatHanhMisa.nhaCungCap, yc.centerId);
    // Pháp nhân KÝ USB: LẬP bản hoá đơn nhưng KHÔNG gửi — kế toán ký sau; lệnh ký do bước quét tạo (người yêu cầu = hệ thống).
    const choKyUsb = !cn.ok && cn.usb === true && cn.nhaCungCap !== undefined && (await laKyUsbBat());
    if (!cn.ok && !choKyUsb) {
      bo("CONG_NHA_CUNG_CAP", cn.lyDo);
      continue;
    }
    // Cổng (HSM hoặc nhánh chờ ký USB) luôn mang nhà cung cấp của nó; thiếu ⇒ bỏ qua dòng (không đoán nhà cung cấp để ghi lên hoá đơn).
    const nccDung = cn.nhaCungCap;
    if (nccDung === undefined) {
      bo("CONG_NHA_CUNG_CAP", "Không xác định được nhà cung cấp của cổng phát hành");
      continue;
    }
    // Hạn mức ký TỰ ĐỘNG (pháp nhân HSM) KHÔNG kiểm ở đây: kiểm + giữ chỗ nằm TRONG giao dịch tạo hoá đơn của `batDauPhatHanh` (`kieu: "TU_DONG_HSM"`), nguyên tử với
    // hoá đơn khác của cùng pháp nhân. Chưa khai / vượt / đang tạm dừng ⇒ ném `LoiPhatHanh` (rollback), lần thu ở lại «Chờ xuất» cho kế toán kiểm — không mất dữ liệu.
    ctx.themPhatHanh();
    try {
      const bd = await batDauPhatHanh({
        nguoiBam: ctx.nguoiBam,
        actor: SYSTEM_ACTOR,
        orderId: yc.orderId,
        centerId: yc.centerId,
        lanThuKey: d.key,
        khoan: d.khoan,
        nguon: nap,
        cheDo: cn.ok ? cn.cong.cheDo : "HSM",
        nhaCungCap: nccDung,
        now: ctx.now,
        kieu: cn.ok ? "TU_DONG_HSM" : "TU_DONG_USB",
        ...(ctx.xuatLien ? { xuatLien: true } : {}),
      });
      if (cn.ok && bd.canhBaoTanSuat) ghiNhanTanSuatCao(ctx.gom, { phapNhanMa: cn.phapNhanMa, coSoId: yc.centerId });
      if (!cn.ok) {
        kq.dangPhatHanh += 1;
        taoDuoc += 1;
        ghi("DANG_PHAT_HANH", "Đã lập hoá đơn — chờ kế toán ký bằng USB token");
        continue;
      }
      const s = await guiPhatHanh({ hoaDonId: bd.hoaDonId, cong: cn.cong, now: new Date(), nguoiGoiId: null });
      if (s.trangThai === "DA_XAC_NHAN") {
        kq.daXuat += 1;
        taoDuoc += 1;
        ghi("DA_XUAT", null);
      } else if (s.trangThai === "DANG_PHAT_HANH") {
        kq.dangPhatHanh += 1;
        taoDuoc += 1;
        ghi("DANG_PHAT_HANH", s.thongDiep);
      } else if (s.trangThai === "LOI_PHAT_HANH") {
        kq.loiPhatHanh += 1;
        ghi("LOI_PHAT_HANH", s.thongDiep);
      } else {
        ghi("BO_QUA", "Hoá đơn vừa đổi trạng thái giữa chừng");
      }
    } catch (e) {
      // Chạm hạn mức / pháp nhân tạm dừng: KHÔNG tính vào trần mỗi lượt (không có hoá đơn nào được tạo) và gom để báo MỘT lần cuối lượt.
      if (e instanceof LoiPhatHanh && (e.ma === "VUOT_HAN_MUC" || e.ma === "TAM_DUNG_KY")) {
        ctx.themPhatHanh(-1);
        if (cn.ok) ghiNhanChoHanMuc(ctx.gom, { phapNhanMa: cn.phapNhanMa, coSoId: yc.centerId });
        bo("VUOT_HAN_MUC", e.message);
        continue;
      }
      // Từ chối nghiệp vụ (người mua còn thiếu, khoản đã bị giữ, cấu hình cơ sở…) = bỏ lại cho kế toán, KHÔNG phải lỗi hệ thống.
      const tb = thongDiepLoiPhatHanh(e);
      if (tb) bo("PHAT_HANH_TU_CHOI", tb);
      else {
        kq.loiPhatHanh += 1;
        kq.loi ??= `PHAT_HANH:${maLoi(e)}`;
        ghi("LOI_PHAT_HANH", `Lỗi kỹ thuật (${maLoi(e)})`);
      }
    }
  }
  return taoDuoc;
}

/** Đóng yêu cầu sau khi đã có hoá đơn: liên kết hết dùng được. `updateMany` có điều kiện `trangThai` nên đua với người thu hồi / cấp lại không ghi đè. Nhật ký không chứa giá trị ô. */
export async function dongYeuCau(yc: { id: string; centerId: string }, now: Date, nguoi: string = "Hệ thống (tự xuất sau khi phụ huynh điền form)"): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const upd = await tx.hoaDonYeuCauNguoiMua.updateMany({ where: { id: yc.id, centerId: yc.centerId, trangThai: "DANG_MO" }, data: { trangThai: "DA_AP_DUNG", updatedAt: now } });
    if (upd.count !== 1) return false;
    await writeAudit({
      tx,
      actor: { id: null, name: nguoi },
      module: "hoa-don",
      entityType: "HoaDonYeuCauNguoiMua",
      entityId: yc.id,
      action: "DONG_YEU_CAU_SAU_TU_XUAT",
      oldValues: { trangThai: "DANG_MO" },
      newValues: { trangThai: "DA_AP_DUNG" },
      changedFields: ["trangThai"],
      orgUnitId: yc.centerId,
    });
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// XUẤT LIỀN — nút của SALE (BGĐ đổi yêu cầu 09/11/2026)
//   Phụ huynh có yêu cầu hoá đơn và CẦN LIỀN: Sale đối chiếu thông tin với phụ huynh ở hộp xác nhận rồi bấm — hệ thống phát hành NGAY các lần thu đang chờ xuất của đơn
//   và xếp thư gửi phụ huynh NGAY (không đợi hai nhịp cron). Phụ huynh không cần liền thì KHÔNG bấm: lần thu ở lại «Chờ xuất» và đi cùng lô cuối ngày 23h30
//   (`xuat-lo-dem`), để Sale / phụ huynh còn thời gian đối chiếu — KHÔNG còn «tự xuất sau n giờ».
//
//   Đi qua CHÍNH `xuLyMotYeuCau` của luồng tự xuất cũ — mọi cổng giữ nguyên: lần thu phải đủ tiền, mọi khoản ĐÃ được kế toán xác nhận (Sale không xác nhận tiền được),
//   không ngoại lệ, nút «Phát hành» phải hiện, cổng theo pháp nhân, hạn mức ký tự động, khoá đơn. Khác: người bấm là Sale (nhật ký ghi tên), bỏ trần theo lượt (một đơn).
// ─────────────────────────────────────────────────────────────────────────────

const NHAN_BO_QUA_XUAT_LIEN: Record<MaBoQuaTuXuatLuot, string> = {
  ...NHAN_BO_QUA_TU_XUAT,
  KHONG_NAP_DUOC_PHIEU: "Không dựng được phiếu của lần thu",
  CONG_NHA_CUNG_CAP: "Cổng nhà cung cấp hoá đơn chưa sẵn sàng (chưa cấu hình, hoặc pháp nhân đang tạm dừng / ký USB)",
  PHAT_HANH_TU_CHOI: "Hệ thống từ chối phát hành (thông tin người mua / khoản thu chưa đạt)",
  VUOT_TRAN: "Vượt trần số hoá đơn mỗi lượt",
  VUOT_HAN_MUC: "Vượt hạn mức ký tự động của pháp nhân",
};

export type KetQuaXuatLien = {
  /** Có ít nhất một hoá đơn được TẠO (đã xác nhận hoặc đang phát hành). */
  taoDuoc: number;
  daXuat: number;
  dangPhatHanh: number;
  loiPhatHanh: number;
  boQua: Partial<Record<MaBoQuaTuXuatLuot, number>>;
  /** Từng lần thu: kết quả + lý do (đã là câu tiếng Việt, không mang dữ liệu người mua). */
  dong: DongBaoCaoTuXuat[];
  /** Lý do chung đã dịch ra tiếng Việt từ `boQua` — cho ca lần thu bị loại TRƯỚC khi có dòng báo cáo (Sale vẫn được biết vì sao không xuất). */
  lyDo: string[];
  /** Thư gửi phụ huynh đã được xếp và gửi ngay trong lượt này chưa (`false` = để nhịp cron gửi tiếp, vẫn không mất). */
  guiNgay: boolean;
  /** Thời gian xử lý trong máy chủ (ms), từ lúc bắt đầu tới lúc xong — để Sale/nhật ký biết nhanh hay chậm. */
  mili: number;
};

/**
 * Xếp thư NGAY thay vì đợi hai nhịp cron (sự kiện `hoa-don.gui` → hàng đợi → gửi). Mọi lỗi ở đây KHÔNG làm hỏng việc xuất: hoá đơn đã phát hành, thư vẫn sẽ đi ở nhịp cron kế tiếp.
 * `hoaDonBat` đọc cờ như đúng nhịp cron (`laHoaDonBat`); cờ TẮT ⇒ không đụng hàng đợi hoá đơn.
 */
async function guiThuNgay(): Promise<boolean> {
  try {
    const { ensureHandlersRegistered } = await import("@/lib/events/register");
    const { dispatchPendingEvents } = await import("@/lib/events/dispatcher");
    const { processEmailQueue } = await import("@/lib/email/queue");
    const { laHoaDonBat } = await import("../feature");
    ensureHandlersRegistered();
    await dispatchPendingEvents();
    const r = await processEmailQueue(10, { guiHoaDon: await laHoaDonBat().catch(() => false) });
    return r.sent > 0;
  } catch {
    return false;
  }
}

export async function xuatLienDon(input: { orderId: string; centerId: string; nguoiBam: { id: string; name: string }; now: Date }): Promise<KetQuaXuatLien> {
  const batDau = Date.now();
  const kq = rong();
  const layCong = taoLayCong(input.now);
  const gom = gomHanMucMoi();
  let daThu = 0;
  let taoDuoc = 0;
  try {
    taoDuoc = await xuLyMotYeuCau(kq, { orderId: input.orderId, centerId: input.centerId }, {
      now: input.now,
      nguoiBam: input.nguoiBam,
      xuatLien: true,
      conThoiGian: () => true,
      layCong,
      daPhatHanh: () => daThu,
      themPhatHanh: (n = 1) => {
        daThu += n;
      },
      gom,
    });
  } catch (e) {
    kq.loi ??= `XUAT_LIEN:${maLoi(e)}`;
  }
  await baoHanMuc(gom, input.now).catch(() => undefined);

  // Đã có hoá đơn ⇒ ĐÓNG yêu cầu (liên kết hết dùng được: phụ huynh không «sửa» một hoá đơn đã xuất) + xếp thư ngay.
  let guiNgay = false;
  if (taoDuoc > 0) {
    try {
      const yc = await db.hoaDonYeuCauNguoiMua.findFirst({ where: { orderId: input.orderId, centerId: input.centerId, trangThai: "DANG_MO" }, select: { id: true, centerId: true } });
      if (yc) await dongYeuCau(yc, input.now, `Sale ${input.nguoiBam.name} (xuất liền)`);
    } catch {
      /* đóng yêu cầu hỏng không làm mất hoá đơn đã tạo — cron dọn yêu cầu sẽ đóng sau */
    }
    if (kq.daXuat > 0) guiNgay = await guiThuNgay();
  }
  try {
    await writeAudit({
      actor: { id: input.nguoiBam.id, name: input.nguoiBam.name },
      module: "finance",
      entityType: "Order",
      entityId: input.orderId,
      action: "XUAT_LIEN",
      newValues: { daXuat: kq.daXuat, dangPhatHanh: kq.dangPhatHanh, loiPhatHanh: kq.loiPhatHanh, boQua: kq.boQua, guiNgay, mili: Date.now() - batDau },
      orgUnitId: input.centerId,
    });
  } catch {
    /* nhật ký hỏng không chặn kết quả — người bấm vẫn thấy kết quả thật */
  }
  const lyDo = (Object.keys(kq.boQua) as MaBoQuaTuXuatLuot[]).map((m) => NHAN_BO_QUA_XUAT_LIEN[m] ?? m);
  return { taoDuoc, daXuat: kq.daXuat, dangPhatHanh: kq.dangPhatHanh, loiPhatHanh: kq.loiPhatHanh, boQua: kq.boQua, dong: kq.mau, lyDo, guiNgay, mili: Date.now() - batDau };
}
