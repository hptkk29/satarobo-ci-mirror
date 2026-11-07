import "server-only";
import { writeAudit } from "@/lib/audit/audit-log";
import type { CongHoaDon } from "@/lib/misa/meinvoice/cong";
import { ngayVN } from "@/lib/format/thoi-gian-vn";
import { SYSTEM_ACTOR, SYSTEM_USER_ID } from "@/lib/auth/system-actor";
import { db } from "@/lib/db";
import { layCongHsmChoPhapNhan } from "../ket-noi/cong-theo-phap-nhan";
import { CAU_TAM_DUNG_KY, kyDangTamDung } from "../ky-chinh-sach/ky-chinh-sach-db";
import { baoHanMuc, ghiNhanChoHanMuc, ghiNhanTanSuatCao, gomHanMucMoi, type GomHanMuc } from "../ky-chinh-sach/bao-han-muc-db";
import { laKyUsbBat } from "../feature";
import { phapNhanMaPhatHanhChoCoSo } from "../ket-noi/phap-nhan-phat-hanh";
import { coSoNguoiMuaDuoc, docCauHinhTuXuat, laMisaPhatHanhBat } from "../feature";
import { napHangChoHoaDon } from "../hang-cho";
import { khoHoaDonDaCauHinh } from "../kho-tep";
import { batDauPhatHanh, guiPhatHanh, LoiPhatHanh, thongDiepLoiPhatHanh } from "../phat-hanh-misa";
import { TEN_NHA_CUNG_CAP_API, type NhaCungCapApi } from "../phap-nhan";
import { napTrangPhieuCho } from "../trang-phieu-cho";
import { conTrongHanTuXuat, lyDoBoQuaTuXuat, type MaBoQuaTuXuat } from "./chon-lan-thu";

// lib/finance/hoa-don/tu-xuat-sau-gio/chay-tu-xuat.ts — NGƯỜI CHẠY «tự xuất hoá đơn sau n giờ kể từ lúc phụ huynh điền form QR» (BGĐ yêu cầu 03/11/2026).
//
// ─────────────────────────────────────────────────────────────────────────────
// LÀM GÌ
//   Mỗi lượt cron (pha P4 của `hoa-don-misa-doi-soat`, 10 phút một lần): tìm yêu cầu thông tin người mua mà phụ huynh ĐÃ GỬI quá n giờ, rồi PHÁT HÀNH hoá đơn cho các lần thu đang chờ xuất
//   của đơn đó — MỖI LẦN THU MỘT HOÁ ĐƠN, với thông tin người mua nằm sẵn trên đơn (phụ huynh gửi xong là vào đơn ngay; nhân viên sửa sau thì ghi đè — ai ghi sau thắng).
//   Phát hành xong thì ĐÓNG yêu cầu (DANG_MO → DA_AP_DUNG): liên kết hết dùng được, phụ huynh không thể «sửa» một hoá đơn đã xuất.
//
// KHÔNG TỰ VIẾT LẠI MÁY PHÁT HÀNH — đi qua CHÍNH `batDauPhatHanh` + `guiPhatHanh` mà nút «Phát hành» và lô 23h dùng (khoá đơn, mọi cổng của `chotHoaDon`, cấu hình hoá đơn của cơ sở,
//   cổng theo pháp nhân). Khác DUY NHẤT: người bấm là «hệ thống» (`SYSTEM_ACTOR`). Khoá đơn + cổng «khoản chưa bị hoá đơn giữ» là thứ chống xuất hai lần với lô 23h và với người bấm tay.
//   Không truyền `loDem`: người mua là thông tin PHỤ HUYNH khai (hoặc nhân viên sửa), không phải «người tiêu dùng» — máy phát hành đọc từ đơn và từ chối nếu còn thiếu.
//
// AN TOÀN (đừng nới)
//   1. Cờ: `hoaDon.tuXuatBat` (mặc định TẮT) ∧ luồng người mua bật ∧ cơ sở thí điểm Hub. Tắt ⇒ trả `null`, KHÔNG chạm bảng nào của Hub.
//   2. Chọn lần thu ở `chon-lan-thu.ts`: mọi khoản đã được kế toán xác nhận, không ngoại lệ. Hệ thống KHÔNG tự xác nhận tiền.
//   3. Trần mỗi lượt (`TRAN_PHAT_HANH_MOI_LUOT`, `TRAN_YEU_CAU_MOI_LUOT`) + ngân sách thời gian (`conThoiGian`): cron này còn đối soát hoá đơn treo, không được đói.
//   4. Mỗi lần thu là một giao dịch riêng; lỗi một lần thu không làm hỏng các lần thu khác. `KHONG_RO` của nhà cung cấp → giữ nguyên, pha P1 của cùng cron tra lại bằng refId.
//   5. Yêu cầu gửi quá `TOI_DA_NGAY_CHO_TU_XUAT` ngày mà chưa xuất được thì ngừng tự xuất (kế toán xử lý tay) — và không đói yêu cầu mới.
//
// ⚠️ `taoBoiId` của hoá đơn là `SYSTEM_USER_ID` ("system") — như lô 23h (xem đầu `xuat-lo-dem/chay-lo-dem.ts`).
// ─────────────────────────────────────────────────────────────────────────────

/** Trần số hoá đơn PHÁT HÀNH THẬT mỗi lượt (10 phút một lượt) — phần còn lại để lượt sau. */
export const TRAN_PHAT_HANH_MOI_LUOT = 10;
/** Trần số yêu cầu xét mỗi lượt. */
export const TRAN_YEU_CAU_MOI_LUOT = 25;
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
  soGio: number;
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

const rong = (soGio: number): KetQuaTuXuat => ({ soGio, coSo: 0, yeuCauToiGio: 0, daXuat: 0, dangPhatHanh: 0, loiPhatHanh: 0, daDongYeuCau: 0, boQua: {}, dungSom: false, loi: null, mau: [] });

const maLoi = (e: unknown): string => {
  const ma = (e as { code?: unknown } | null)?.code;
  if (typeof ma === "string" && /^[A-Z0-9_]{2,12}$/.test(ma)) return ma;
  return e instanceof Error && /^[A-Za-z]{2,40}$/.test(e.name) ? e.name : "LOI";
};

const tang = (kq: KetQuaTuXuat, ma: MaBoQuaTuXuatLuot) => {
  kq.boQua[ma] = (kq.boQua[ma] ?? 0) + 1;
};

// `nhaCungCap` = nhà cung cấp của cổng VỪA LẤY (05/11/2026) — truyền thẳng vào `batDauPhatHanh`, không suy lại từ `phanMem`.
type CongNcc = { ok: true; cong: CongHoaDon; phapNhanMa: string; nhaCungCap: NhaCungCapApi } | { ok: false; lyDo: string; usb?: true; nhaCungCap?: NhaCungCapApi };

/** Một yêu cầu đã tới giờ → hoá đơn cho các lần thu đang chờ xuất của đơn. Trả số hoá đơn được TẠO (đã xác nhận hoặc đang phát hành). */
async function xuLyMotYeuCau(
  kq: KetQuaTuXuat,
  yc: { orderId: string; centerId: string },
  ctx: { now: Date; conThoiGian: () => boolean; layCong: (ncc: NhaCungCapApi, centerId: string) => Promise<CongNcc>; daPhatHanh: () => number; themPhatHanh: (n?: number) => void; gom: GomHanMuc },
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
    const loai = lyDoBoQuaTuXuat({ ngan: d.ngan, phatHanhHien: d.phatHanhMisa.hien, coNgoaiLe: d.hanhDong.ngoaiLe != null, khoanIds: d.khoanIds }, bc);
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
        nguoiBam: { id: SYSTEM_USER_ID, name: "Hệ thống (tự xuất sau khi phụ huynh điền form)" },
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
async function dongYeuCau(yc: { id: string; centerId: string }, now: Date): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const upd = await tx.hoaDonYeuCauNguoiMua.updateMany({ where: { id: yc.id, centerId: yc.centerId, trangThai: "DANG_MO" }, data: { trangThai: "DA_AP_DUNG", updatedAt: now } });
    if (upd.count !== 1) return false;
    await writeAudit({
      tx,
      actor: { id: null, name: "Hệ thống (tự xuất sau khi phụ huynh điền form)" },
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

export async function chayTuXuat(input: { soGio: number; now: Date; conThoiGian: () => boolean }): Promise<KetQuaTuXuat> {
  const kq = rong(input.soGio);
  const coSo = await coSoNguoiMuaDuoc();
  kq.coSo = coSo.length;
  if (coSo.length === 0) return kq;

  const toiGio = new Date(input.now.getTime() - input.soGio * 3_600_000);
  const sanNgay = new Date(input.now.getTime() - 7 * 86_400_000);
  const dsYeuCau = await db.hoaDonYeuCauNguoiMua.findMany({
    where: { trangThai: "DANG_MO", centerId: { in: coSo }, guiLuc: { not: null, lte: toiGio, gte: sanNgay } },
    orderBy: { guiLuc: "asc" },
    take: TRAN_YEU_CAU_MOI_LUOT,
    select: { id: true, orderId: true, centerId: true, guiLuc: true },
  });
  // Bộ lọc `gte: sanNgay` ở câu tra và `conTrongHanTuXuat` ở đây nói CÙNG một luật; giữ cả hai để một bên sai không mở cửa.
  const yeuCau = dsYeuCau.filter((y) => y.guiLuc !== null && conTrongHanTuXuat(y.guiLuc, input.now));
  kq.yeuCauToiGio = yeuCau.length;

  // Cổng theo PHÁP NHÂN của cơ sở. Pháp nhân ký USB token ⇒ `ok: false` — cron KHÔNG BAO GIỜ tự ký/phát hành cho họ (chờ kế toán ký lô).
  const congTheoPhapNhan = new Map<string, CongNcc>();
  let phatHanhBat: boolean | null = null;
  const layCong = async (ncc: NhaCungCapApi, centerId: string): Promise<CongNcc> => {
    const ten = TEN_NHA_CUNG_CAP_API[ncc];
    const phapNhanMa = await phapNhanMaPhatHanhChoCoSo(SYSTEM_ACTOR, centerId, ngayVN(input.now));
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

  let phatHanhDaThu = 0;
  const gom = gomHanMucMoi();
  for (const yc of yeuCau) {
    if (!input.conThoiGian()) {
      kq.dungSom = true;
      break;
    }
    let taoDuoc: number;
    try {
      taoDuoc = await xuLyMotYeuCau(kq, yc, {
        now: input.now,
        conThoiGian: input.conThoiGian,
        layCong,
        daPhatHanh: () => phatHanhDaThu,
        themPhatHanh: (n = 1) => {
          phatHanhDaThu += n;
        },
        gom,
      });
    } catch (e) {
      kq.loi ??= `YEU_CAU:${maLoi(e)}`;
      continue;
    }
    if (taoDuoc > 0) {
      try {
        if (await dongYeuCau(yc, input.now)) kq.daDongYeuCau += 1;
      } catch (e) {
        kq.loi ??= `DONG:${maLoi(e)}`;
      }
    }
    if (kq.dungSom) break;
  }
  // Báo hạn mức MỘT lần cuối lượt (tin gộp theo pháp nhân; lỗi gửi tin không làm hỏng lượt).
  await baoHanMuc(gom, input.now);
  return kq;
}

/**
 * Điểm vào của cron (pha P4). Công tắc TẮT ⇒ `null` và KHÔNG chạm bảng nào. Bật ⇒ chạy, rồi — CHỈ khi có việc làm — ghi MỘT dòng nhật ký tổng kết (`HoaDonTuXuat` / `TU_XUAT_CHAY`, không PII:
 * chỉ đếm + mã đơn); lượt trống (10 phút một lần) không rải nhật ký. Mọi lỗi cấp lượt được bắt và trả về dạng nhãn ngắn.
 */
export async function chayTuXuatCuaCron(input: { now: Date; conThoiGian: () => boolean }): Promise<KetQuaTuXuat | null> {
  let cfg: Awaited<ReturnType<typeof docCauHinhTuXuat>>;
  try {
    cfg = await docCauHinhTuXuat();
  } catch (e) {
    return { ...rong(0), loi: `CO:${maLoi(e)}` };
  }
  if (!cfg.bat) return null;

  let kq: KetQuaTuXuat;
  try {
    kq = await chayTuXuat({ soGio: cfg.soGio, now: input.now, conThoiGian: input.conThoiGian });
  } catch (e) {
    kq = { ...rong(cfg.soGio), loi: `LUOT:${maLoi(e)}` };
  }
  // Chỉ ghi khi CÓ ĐIỀU GÌ XẢY RA (đã tạo / lỗi): yêu cầu chờ tiền được xác nhận sẽ bị xét lại mỗi 10 phút trong tối đa 7 ngày — ghi mỗi lượt là rải ~1000 dòng nhật ký không nói thêm gì.
  const coViec = kq.daXuat + kq.dangPhatHanh + kq.loiPhatHanh + kq.daDongYeuCau > 0 || kq.loi !== null;
  if (coViec) {
    try {
      await writeAudit({
        actor: { id: null, name: "Hệ thống (tự xuất sau khi phụ huynh điền form)" },
        module: "finance",
        entityType: "HoaDonTuXuat",
        entityId: `tu-xuat:${input.now.toISOString().slice(0, 16)}`,
        action: "TU_XUAT_CHAY",
        newValues: {
          soGio: kq.soGio,
          coSo: kq.coSo,
          yeuCauToiGio: kq.yeuCauToiGio,
          daXuat: kq.daXuat,
          dangPhatHanh: kq.dangPhatHanh,
          loiPhatHanh: kq.loiPhatHanh,
          daDongYeuCau: kq.daDongYeuCau,
          boQua: kq.boQua,
          dungSom: kq.dungSom,
          loi: kq.loi,
          mau: kq.mau.map((m) => ({ maDon: m.maDon, soTien: m.soTien, ketQua: m.ketQua })),
        },
      });
    } catch (e) {
      kq.loi ??= `NHAT_KY:${maLoi(e)}`;
    }
  }
  return kq;
}
