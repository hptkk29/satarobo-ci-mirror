import "server-only";
import { writeAudit } from "@/lib/audit/audit-log";
import type { CongHoaDon } from "@/lib/misa/meinvoice/cong";
import { SYSTEM_ACTOR, SYSTEM_USER_ID } from "@/lib/auth/system-actor";
import { db } from "@/lib/db";
import { ngayVN } from "@/lib/format/thoi-gian-vn";
import { layCongHsmChoPhapNhan } from "../ket-noi/cong-theo-phap-nhan";
import { CAU_TAM_DUNG_KY, kyDangTamDung } from "../ky-chinh-sach/ky-chinh-sach-db";
import { baoHanMuc, ghiNhanChoHanMuc, ghiNhanTanSuatCao, gomHanMucMoi } from "../ky-chinh-sach/bao-han-muc-db";
import { laKyUsbBat } from "../feature";
import { phapNhanMaPhatHanhChoCoSo } from "../ket-noi/phap-nhan-phat-hanh";
import { cheDoLoDem, coSoLoDem, laMisaPhatHanhBat, type CheDoLoDem } from "../feature";
import { napHangChoHoaDon } from "../hang-cho";
import { khoHoaDonDaCauHinh } from "../kho-tep";
import { thangVN } from "../loc-hang-cho";
import { batDauPhatHanh, guiPhatHanh, LoiPhatHanh, thongDiepLoiPhatHanh } from "../phat-hanh-misa";
import { TEN_NHA_CUNG_CAP_API, type NhaCungCapApi } from "../phap-nhan";
import { napTrangPhieuCho } from "../trang-phieu-cho";
import { lyDoBoQuaLanThu, type DongUngVien, type MaBoQuaLanThu } from "./chon-lan-thu";
import { dongYeuCau } from "../xuat-lien/chay-xuat-lien";
import { nguoiMuaChoLoDem, tenHocVienChoLanThu, type MaBoQuaNguoiMua, type NguonNguoiMuaLoDem } from "./nguoi-mua-tieu-dung";

// lib/finance/hoa-don/xuat-lo-dem/chay-lo-dem.ts — NGƯỜI CHẠY lô xuất hoá đơn 23h (BGĐ yêu cầu 03/11/2026).
//
// ─────────────────────────────────────────────────────────────────────────────
// LÀM GÌ
//   Mỗi đêm 23h30 (VN) [BGĐ đổi 09/11/2026: từ 23h00 sang 23h30; MỌI lần thu của ngày, KỂ CẢ phụ huynh đã yêu cầu hoá đơn mà không cần xuất liền], với các cơ sở đã bật thí điểm Invoice Hub: lấy các lần thu ĐANG CHỜ XUẤT —
//   phụ huynh KHÔNG khai thì xuất «người tiêu dùng»; phụ huynh ĐÃ khai (QR) hoặc Sale đã nhập thì xuất ĐÚNG thông tin đó (`nguoiMuaChoLoDem`) rồi ĐÓNG yêu cầu. Phụ huynh cần liền: Sale bấm «Xuất liền».
//   Chỉ BỎ QUA đơn mà phụ huynh vừa mở mã QR và CHƯA gửi gì (còn trong hạn liên kết) — đợi họ điền, đêm sau xuất.
//   rồi — tuỳ chế độ — chỉ LẬP BÁO CÁO (`CHAY_THU`) hoặc PHÁT HÀNH THẬT (`TU_DONG`), MỖI LẦN THU MỘT HOÁ ĐƠN.
//
// KHÔNG TỰ VIẾT LẠI MÁY PHÁT HÀNH
//   Phát hành đi qua CHÍNH `batDauPhatHanh` + `guiPhatHanh` mà nút «Phát hành» dùng: khoá đơn, mọi cổng của `chotHoaDon` (khoản chưa bị hoá đơn giữ,
//   yêu cầu hoàn, phạm vi kế toán, tiền ròng, nghi trùng), cấu hình hoá đơn của cơ sở, luật của nhà cung cấp (MISA/VIN), cổng theo PHÁP NHÂN.
//   Khác DUY NHẤT: người bấm là «hệ thống» (`SYSTEM_ACTOR`), và khối người mua do `nguoiMuaChoLoDem` quyết (đọc dưới khoá đơn).
//
// BA CHỐT AN TOÀN (đừng nới)
//   1. Cờ: `cheDoLoDem()` — hai công tắc tổng mặc định TẮT; chỉ cơ sở trong `coSoLoDem()` (thí điểm Hub) mới vào lô. Tắt ⇒ không đọc, không ghi gì.
//   2. Chọn lần thu ở `chon-lan-thu.ts`: chỉ lần thu hôm nay/hôm qua, mọi khoản đã được kế toán xác nhận, không ngoại lệ, phụ huynh không đang khai.
//      Lô KHÔNG tự xác nhận tiền (bộ quét `tu-xac-nhan-ngan-hang.ts` làm việc đó), KHÔNG xuất lùi ngày, và GIỮ đơn cọc chưa trả đủ (MỘT hoá đơn khi trả đủ).
//   3. Mỗi lần thu là một giao dịch riêng; lỗi một lần thu không làm hỏng các lần thu khác. `KHONG_RO` của nhà cung cấp → giữ nguyên, cron đối soát
//      (`hoa-don-misa-doi-soat`, 10 phút) tra lại bằng refId — lô KHÔNG phát hành lần hai.
//
// ⚠️ `taoBoiId` của hoá đơn lô đêm là `SYSTEM_USER_ID` ("system") — cột là chuỗi thường, không khoá ngoại tới `User`, và các đường đọc của máy
//   phát hành (`tx.user.findUnique` rồi rơi về id) chịu được việc không tìm thấy người. Nhật ký ghi `loDem: true` để truy ra.
// ─────────────────────────────────────────────────────────────────────────────

/** Trần số hoá đơn PHÁT HÀNH THẬT mỗi lượt — lượt sau (đêm sau) làm tiếp phần còn lại. Chạy thử không bị trần này (chỉ đếm). */
export const TRAN_PHAT_HANH_MOI_LUOT = 150;

const TRAN_MAU_BAO_CAO = 200;

export type MaBoQuaLoDem = MaBoQuaLanThu | MaBoQuaNguoiMua | "KHONG_NAP_DUOC_PHIEU" | "CONG_NHA_CUNG_CAP" | "PHAT_HANH_TU_CHOI" | "CHUA_DU_THOI_GIAN" | "VUOT_TRAN" | "VUOT_HAN_MUC";

export type DongBaoCaoLoDem = {
  maDon: string;
  coSo: string;
  ngayThu: string;
  soTien: number;
  nguonNguoiMua: NguonNguoiMuaLoDem | null;
  /** DA_XUAT · DANG_PHAT_HANH · SE_XUAT (chạy thử) · BO_QUA · LOI_PHAT_HANH */
  ketQua: "DA_XUAT" | "DANG_PHAT_HANH" | "SE_XUAT" | "BO_QUA" | "LOI_PHAT_HANH";
  lyDo: string | null;
};

export type KetQuaLoDem = {
  cheDo: CheDoLoDem;
  coSo: number;
  /** Số lần thu đang ở ngăn «Chờ xuất» của các cơ sở trong lô (trước khi lọc). */
  lanThuCho: number;
  /** Số lần thu qua mọi bộ lọc (chạy thử: "sẽ xuất"; tự động: "đã thử phát hành"). */
  duocChon: number;
  daXuat: number;
  dangPhatHanh: number;
  loiPhatHanh: number;
  boQua: Partial<Record<MaBoQuaLoDem, number>>;
  dungSom: boolean;
  /** Nhãn ngắn của lỗi cấp lượt (đọc lô thất bại…) — KHÔNG kèm câu lỗi gốc (có thể mang dữ liệu). */
  loi: string | null;
  mau: DongBaoCaoLoDem[];
};

const rong = (cheDo: CheDoLoDem): KetQuaLoDem => ({
  cheDo,
  coSo: 0,
  lanThuCho: 0,
  duocChon: 0,
  daXuat: 0,
  dangPhatHanh: 0,
  loiPhatHanh: 0,
  boQua: {},
  dungSom: false,
  loi: null,
  mau: [],
});

const maLoi = (e: unknown): string => {
  const ma = (e as { code?: unknown } | null)?.code;
  if (typeof ma === "string" && /^[A-Z0-9_]{2,12}$/.test(ma)) return ma;
  return e instanceof Error && /^[A-Za-z]{2,40}$/.test(e.name) ? e.name : "LOI";
};

const tang = (kq: KetQuaLoDem, ma: MaBoQuaLoDem) => {
  kq.boQua[ma] = (kq.boQua[ma] ?? 0) + 1;
};

/** Cổng của MỘT nhà cung cấp, hỏi MỘT lần mỗi lượt (không hỏi lại cho từng lần thu). */
/** `usb: true` = pháp nhân ký USB token (không có cổng HSM): lô đêm vẫn LẬP bản hoá đơn rồi để cho kế toán ký (BGĐ 04/11/2026). */
// `nhaCungCap` = nhà cung cấp của cổng VỪA LẤY (05/11/2026) — truyền thẳng vào `batDauPhatHanh`, không suy lại từ `phanMem`.
type CongNcc = { ok: true; cong: CongHoaDon; phapNhanMa: string; nhaCungCap: NhaCungCapApi } | { ok: false; lyDo: string; usb?: true; nhaCungCap?: NhaCungCapApi };

export async function chayLoDem(input: { cheDo: Exclude<CheDoLoDem, "TAT">; now: Date; conThoiGian: () => boolean }): Promise<KetQuaLoDem> {
  const kq = rong(input.cheDo);
  const homNay = ngayVN(input.now);
  const tuDong = input.cheDo === "TU_DONG";

  let coSo: string[];
  try {
    coSo = await coSoLoDem();
  } catch (e) {
    kq.loi = `CO:${maLoi(e)}`;
    return kq;
  }
  kq.coSo = coSo.length;
  if (coSo.length === 0) return kq;

  const thanhPho = new Map((await db.center.findMany({ where: { id: { in: coSo } }, select: { id: true, city: true } })).map((c) => [c.id, c.city] as const));
  // Cổng theo PHÁP NHÂN của cơ sở (không theo nhà cung cấp): hai pháp nhân cùng VIN có tài khoản khác nhau. Pháp nhân ký USB token ⇒ `ok: false`
  // (hoá đơn KHÔNG tự phát hành — chờ kế toán ký lô), lý do hiện ở báo cáo.
  const congTheoPhapNhan = new Map<string, CongNcc>();
  let phatHanhBat: boolean | null = null;
  const layCong = async (ncc: NhaCungCapApi, centerId: string): Promise<CongNcc> => {
    const ten = TEN_NHA_CUNG_CAP_API[ncc];
    const phapNhanMa = await phapNhanMaPhatHanhChoCoSo(SYSTEM_ACTOR, centerId, homNay);
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
  for (const coSoId of coSo) {
    if (!input.conThoiGian()) {
      kq.dungSom = true;
      break;
    }
    let dong;
    try {
      dong = (await napHangChoHoaDon(SYSTEM_ACTOR, { canViewPii: true, boLoc: { coSo: coSoId, thang: thangVN(input.now) } })).dong;
    } catch (e) {
      kq.loi ??= `HANG_CHO:${maLoi(e)}`;
      continue;
    }
    const cho = dong.filter((d) => d.ngan === "cho");
    kq.lanThuCho += cho.length;
    if (cho.length === 0) continue;

    // Hai câu tra cho cả cơ sở (không N+1): yêu cầu của phụ huynh đang chờ · khoản chưa được kế toán xác nhận.
    const orderIds = [...new Set(cho.map((d) => d.orderId))];
    const khoanIds = [...new Set(cho.flatMap((d) => d.khoanIds))];
    // Yêu cầu CÒN MỞ của các đơn: chưa gửi gì (`guiLuc` null, còn hạn) ⇒ đợi phụ huynh điền; ĐÃ gửi ⇒ đi cùng lô rồi ĐÓNG sau khi xuất.
    const [yeuCauMo, chuaXacNhan] = await Promise.all([
      db.hoaDonYeuCauNguoiMua.findMany({
        where: { orderId: { in: orderIds }, centerId: coSoId, trangThai: "DANG_MO" },
        select: { id: true, orderId: true, centerId: true, guiLuc: true, hetHanLuc: true },
      }),
      db.payment.findMany({ where: { id: { in: khoanIds }, accountantStatus: { not: "CONFIRMED" } }, select: { id: true } }),
    ]);
    const boiCanh = {
      homNay,
      coSoTrongLo: new Set(coSo),
      donKhachDangKhai: new Set(yeuCauMo.filter((y) => y.guiLuc === null && y.hetHanLuc.getTime() > input.now.getTime()).map((y) => y.orderId)),
      khoanChuaXacNhan: new Set(chuaXacNhan.map((p) => p.id)),
    };

    const yeuCauDaGui = new Map(yeuCauMo.filter((y) => y.guiLuc !== null).map((y) => [y.orderId, y] as const));
    const daDongYeuCau = new Set<string>();
    // Cũ nhất trước: nếu hết trần/giờ thì phần còn lại là phần MỚI hơn, đêm sau vẫn trong cửa sổ.
    for (const d of [...cho].sort((a, b) => a.ngayThu.localeCompare(b.ngayThu) || a.ghiNhanLuc.localeCompare(b.ghiNhanLuc))) {
      const ghi = (ketQua: DongBaoCaoLoDem["ketQua"], lyDo: string | null, nguon: NguonNguoiMuaLoDem | null) => {
        if (kq.mau.length < TRAN_MAU_BAO_CAO) {
          kq.mau.push({ maDon: d.maDon, coSo: d.coSo.ma ?? d.coSo.ten, ngayThu: d.ngayThu, soTien: d.soTien, nguonNguoiMua: nguon, ketQua, lyDo });
        }
      };
      // `bo` chỉ dùng SAU bộ lọc `lyDoBoQuaLanThu` (lần thu đã đủ điều kiện mà vẫn bị bỏ lại) — những lần thu bị lọc ở bước đầu là hàng chờ bình thường
      // của kế toán nên chỉ đếm, không ghi vào mẫu báo cáo.
      const bo = (ma: MaBoQuaLoDem, lyDo: string) => {
        tang(kq, ma);
        ghi("BO_QUA", lyDo, null);
      };

      const ung: DongUngVien = {
        ngan: d.ngan,
        ngayThu: d.ngayThu,
        coSoId: d.coSoId,
        phatHanhHien: d.phatHanhMisa.hien,
        coNgoaiLe: d.hanhDong.ngoaiLe != null,
        orderId: d.orderId,
        khoanIds: d.khoanIds,
        cocChuaTraDu: d.cocChuaTraDu,
      };
      const loai = lyDoBoQuaLanThu(ung, boiCanh);
      if (loai) {
        tang(kq, loai);
        continue;
      }
      if (!input.conThoiGian()) {
        kq.dungSom = true;
        bo("CHUA_DU_THOI_GIAN", "Hết thời gian của lượt — đêm sau làm tiếp");
        break;
      }

      // Nạp phiếu (tên học viên, khối đơn) bằng CHÍNH hàm màn dùng; khối người mua chọn thử ở đây để báo cáo — máy phát hành chọn LẠI dưới khoá đơn.
      /** Đã có hoá đơn cho đơn này ⇒ ĐÓNG yêu cầu phụ huynh đã gửi (liên kết hết dùng được). Một lần mỗi đơn; lỗi đóng không làm mất hoá đơn. */
      const dongYeuCauSauXuat = async (orderId: string) => {
        const yc = yeuCauDaGui.get(orderId);
        if (!yc || daDongYeuCau.has(orderId)) return;
        daDongYeuCau.add(orderId);
        try {
          await dongYeuCau({ id: yc.id, centerId: yc.centerId }, input.now, "Hệ thống (lô hoá đơn cuối ngày 23h30)");
        } catch (e) {
          kq.loi ??= `DONG:${maLoi(e)}`;
        }
      };

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
      const thamSo = {
        tenHocVien: tenHocVienChoLanThu({ saleDaNhap: nap.hocVien?.ten ?? null, theoKhoan: nap.tenHocVienTheoKhoan }),
        tinhThanh: thanhPho.get(coSoId)?.trim() || null,
      };
      const quyet = nguoiMuaChoLoDem(nap.khoiDon, thamSo);
      if (!quyet.ok) {
        bo(quyet.ma, quyet.lyDo);
        continue;
      }

      kq.duocChon += 1;
      if (!tuDong) {
        ghi("SE_XUAT", null, quyet.nguon);
        continue;
      }
      if (phatHanhDaThu >= TRAN_PHAT_HANH_MOI_LUOT) {
        kq.dungSom = true;
        bo("VUOT_TRAN", `Đã tới trần ${TRAN_PHAT_HANH_MOI_LUOT} hoá đơn mỗi lượt — đêm sau làm tiếp`);
        continue;
      }
      const cn = await layCong(d.phatHanhMisa.nhaCungCap, coSoId);
      // Pháp nhân KÝ USB: LẬP bản hoá đơn (mọi cổng của `batDauPhatHanh` y như HSM) nhưng KHÔNG gửi — kế toán ký sau; lệnh ký do bước quét tạo (người yêu cầu = hệ thống).
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
      phatHanhDaThu += 1;
      try {
        const bd = await batDauPhatHanh({
          nguoiBam: { id: SYSTEM_USER_ID, name: "Hệ thống (lô hoá đơn cuối ngày 23h30)" },
          actor: SYSTEM_ACTOR,
          orderId: d.orderId,
          centerId: coSoId,
          lanThuKey: d.key,
          khoan: d.khoan,
          nguon: nap,
          cheDo: cn.ok ? cn.cong.cheDo : "HSM",
          nhaCungCap: nccDung,
          now: input.now,
          loDem: thamSo,
          kieu: cn.ok ? "TU_DONG_HSM" : "TU_DONG_USB",
        });
        if (cn.ok && bd.canhBaoTanSuat) ghiNhanTanSuatCao(gom, { phapNhanMa: cn.phapNhanMa, coSoId });
        if (!cn.ok) {
          kq.dangPhatHanh += 1;
          ghi("DANG_PHAT_HANH", "Đã lập hoá đơn — chờ kế toán ký bằng USB token", quyet.nguon);
          continue;
        }
        const s = await guiPhatHanh({ hoaDonId: bd.hoaDonId, cong: cn.cong, now: new Date(), nguoiGoiId: null });
        if (s.trangThai === "DA_XAC_NHAN") {
          kq.daXuat += 1;
          ghi("DA_XUAT", null, quyet.nguon);
          await dongYeuCauSauXuat(d.orderId);
        } else if (s.trangThai === "DANG_PHAT_HANH") {
          kq.dangPhatHanh += 1;
          ghi("DANG_PHAT_HANH", s.thongDiep, quyet.nguon);
          await dongYeuCauSauXuat(d.orderId);
        } else if (s.trangThai === "LOI_PHAT_HANH") {
          kq.loiPhatHanh += 1;
          ghi("LOI_PHAT_HANH", s.thongDiep, quyet.nguon);
        } else {
          ghi("BO_QUA", "Hoá đơn vừa đổi trạng thái giữa chừng", quyet.nguon);
        }
      } catch (e) {
        // Chạm hạn mức / pháp nhân tạm dừng: KHÔNG tính vào trần mỗi lượt (không có hoá đơn nào được tạo) và gom để báo MỘT lần cuối lượt.
        if (e instanceof LoiPhatHanh && (e.ma === "VUOT_HAN_MUC" || e.ma === "TAM_DUNG_KY")) {
          phatHanhDaThu -= 1;
          if (cn.ok) ghiNhanChoHanMuc(gom, { phapNhanMa: cn.phapNhanMa, coSoId });
          bo("VUOT_HAN_MUC", e.message);
          continue;
        }
        // Từ chối nghiệp vụ (khoản đã bị giữ, người mua vừa đổi, cấu hình cơ sở…) = bỏ lại cho kế toán, KHÔNG phải lỗi hệ thống.
        const tb = thongDiepLoiPhatHanh(e);
        if (tb) {
          bo("PHAT_HANH_TU_CHOI", tb);
        } else {
          kq.loiPhatHanh += 1;
          kq.loi ??= `PHAT_HANH:${maLoi(e)}`;
          ghi("LOI_PHAT_HANH", `Lỗi kỹ thuật (${maLoi(e)})`, quyet.nguon);
        }
      }
    }
  }
  // Báo hạn mức MỘT lần cuối lượt (tin gộp theo pháp nhân; lỗi gửi tin không làm hỏng lượt).
  await baoHanMuc(gom, input.now);
  return kq;
}

/**
 * Điểm vào của cron: cả hai công tắc TẮT ⇒ `null` và KHÔNG chạm bảng nào của Hub. Bật ⇒ chạy, rồi ghi MỘT dòng nhật ký tổng kết
 * (`HoaDonLoDem` / `LO_DEM_CHAY`, không PII: chỉ đếm + mã đơn). Mọi lỗi cấp lượt được bắt và trả về dạng nhãn ngắn.
 */
export async function chayLoDemCuaCron(input: { now: Date; conThoiGian: () => boolean }): Promise<KetQuaLoDem | null> {
  let cheDo: CheDoLoDem;
  try {
    cheDo = await cheDoLoDem();
  } catch (e) {
    return { ...rong("TAT"), loi: `CO:${maLoi(e)}` };
  }
  if (cheDo === "TAT") return null;

  let kq: KetQuaLoDem;
  try {
    kq = await chayLoDem({ cheDo, now: input.now, conThoiGian: input.conThoiGian });
  } catch (e) {
    kq = { ...rong(cheDo), loi: `LO:${maLoi(e)}` };
  }
  try {
    await writeAudit({
      actor: { id: null, name: "Hệ thống (lô hoá đơn cuối ngày 23h30)" },
      module: "finance",
      entityType: "HoaDonLoDem",
      entityId: `lo-dem:${ngayVN(input.now)}`,
      action: "LO_DEM_CHAY",
      newValues: {
        cheDo: kq.cheDo,
        coSo: kq.coSo,
        lanThuCho: kq.lanThuCho,
        duocChon: kq.duocChon,
        daXuat: kq.daXuat,
        dangPhatHanh: kq.dangPhatHanh,
        loiPhatHanh: kq.loiPhatHanh,
        boQua: kq.boQua,
        dungSom: kq.dungSom,
        loi: kq.loi,
        // Không tên người mua: chỉ mã đơn + số tiền + kết quả.
        mau: kq.mau.map((m) => ({ maDon: m.maDon, soTien: m.soTien, ketQua: m.ketQua, nguon: m.nguonNguoiMua })),
      },
    });
  } catch (e) {
    kq.loi ??= `NHAT_KY:${maLoi(e)}`;
  }
  return kq;
}
