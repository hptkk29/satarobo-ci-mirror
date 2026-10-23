// lib/finance/hoa-don/nut-phat-hanh-misa.ts — MỘT dòng trên màn hoá đơn vẽ gì cho "Phát hành qua MISA"
// (bước 1, 30/09/2026). THUẦN — khuôn `trang-thai-hoa-don.ts`: quyết ở MỘT chỗ, component chỉ đọc, action
// đọc LẠI đúng kết quả này trên dòng loader dựng lại (luật 12: nút sáng mà action từ chối là lời hứa suông).
//
// Hai thứ khác nhau, đừng gộp:
//   · `hien`  — nút CÓ trên màn không: công tắc + cổng + quyền + ngăn + pháp nhân MISA + không phải thay thế.
//              Không hiện ⇒ không vẽ gì (hoặc một câu hướng dẫn `cau` khi có việc phải làm tay).
//   · `bat`   — nút hiện mà có bấm được không; tắt thì KÈM lý do nói bằng nguyên nhân.

import type { CongHoaDon } from "@/lib/misa/meinvoice/cong";
import { kiemNguoiMua } from "@/lib/misa/meinvoice/anh-xa";
import type { HanhDongDong, NutTat } from "./trang-thai-hoa-don";
import type { NguoiMuaHoaDon } from "./nguoi-mua";
import { nguoiMuaPhatHanh } from "./phieu-phat-hanh";

export type CauHinhMisaDong = { moiTruong: CongHoaDon["moiTruong"] };

export type NutPhatHanhMisa = NutTat & {
  hien: boolean;
  /** Câu in thay cho nút khi nút không hiện nhưng có việc phải làm tay (hoá đơn thay thế). */
  cau: string | null;
  moiTruong: CongHoaDon["moiTruong"] | null;
};

export const CAU_THAY_THE_LAM_TAY = "Hoá đơn thay thế: làm tại MISA rồi tải lên";

/**
 * Người mua có qua được LUẬT MISA không (email đuôi 2–6 chữ, MST 10 / 10-3 số, có MST thì có đơn vị + địa chỉ) —
 * hỏi ĐÚNG hàm máy trạng thái hỏi (`kiemNguoiMua` ⊂ `kiemPhieu`, lib/misa/meinvoice/anh-xa.ts) trên ĐÚNG khối sẽ
 * gửi (`nguoiMuaPhatHanh`). Không regex thứ hai ở đây (smoke 30/09: nút sáng với "a@b.c", MISA từ chối lúc gửi).
 */
function loiNguoiMuaMisa(nm: NguoiMuaHoaDon): string | null {
  const loi = kiemNguoiMua(nguoiMuaPhatHanh(nm));
  return loi ? `${loi} — sửa trên đơn rồi phát hành` : null;
}

export function nutPhatHanhMisa(input: {
  /** `null` = công tắc tắt HOẶC chưa cấu hình cổng (`layCongHoaDon()` null). */
  misa: CauHinhMisaDong | null;
  ngan: string;
  coQuyen: boolean;
  /** Pháp nhân của cơ sở giữ đơn dùng MISA meInvoice (`laPhapNhanMisa`). */
  phapNhanMisa: boolean;
  /** Lần thu có hoá đơn cũ ĐÃ HUỶ đứng trước ⇒ bản kế tiếp là hoá đơn THAY THẾ. */
  thayThe: boolean;
  hanhDong: Pick<HanhDongDong, "taiLen" | "ngoaiLe">;
  /** `thieuChoHoaDon(...).chan` — với API thì CHẶN (MISA sẽ từ chối tờ thiếu). */
  thieuNguoiMua: readonly string[];
  /** Người mua HIỆN TẠI của đơn (`nguoiMuaChoDon`) — kiểm luật MISA trước khi cho bấm. */
  nguoiMua: NguoiMuaHoaDon;
  /** `lyDoHoanChanXacNhan` — cùng câu `chotHoaDon` ném. */
  hoanChan: string | null;
}): NutPhatHanhMisa {
  const an = (cau: string | null = null): NutPhatHanhMisa => ({ hien: false, bat: false, cau, moiTruong: null });
  if (!input.misa || !input.coQuyen || !input.phapNhanMisa) return an();
  if (input.ngan !== "cho" && input.ngan !== "lech") return an();
  if (input.thayThe) return an(CAU_THAY_THE_LAM_TAY);

  const moiTruong = input.misa.moiTruong;
  const tat = (lyDo: string): NutPhatHanhMisa => ({ hien: true, bat: false, lyDo, cau: null, moiTruong });
  if (!input.hanhDong.taiLen.bat) return tat(input.hanhDong.taiLen.lyDo ?? "Chưa phát hành được");
  const ngoaiLe = input.hanhDong.ngoaiLe;
  if (ngoaiLe) {
    return tat(
      ngoaiLe.loai === "THEO_SO_DA_THU"
        ? "Lần thu còn thiếu tiền — chờ phụ huynh chuyển nốt, hoặc làm tay ở MISA rồi tải lên kèm lý do \"xuất theo số đã thu\""
        : "Lần thu nghi trùng — đối chiếu rồi làm tay ở MISA, tải lên kèm lý do \"không trùng\"",
    );
  }
  if (input.hoanChan) return tat(input.hoanChan);
  if (input.thieuNguoiMua.length > 0) {
    return tat(`Thông tin người mua trên đơn còn thiếu: ${input.thieuNguoiMua.join(", ")} — bổ sung trên đơn rồi phát hành`);
  }
  const loiMisa = loiNguoiMuaMisa(input.nguoiMua);
  if (loiMisa) return tat(loiMisa);
  return { hien: true, bat: true, cau: null, moiTruong };
}

/** Khối trạng thái của bản ĐANG / LỖI phát hành trên ngăn "Phát hành MISA". */
export type KhoiMisa = {
  trangThai: "DANG_PHAT_HANH" | "LOI_PHAT_HANH";
  hoaDonId: string;
  /** `updatedAt` ISO — "Phát hành lại" / "Bỏ, làm tay" ghi có điều kiện theo nó. */
  phienBan: string;
  /** "1C26TSR-123" khi MISA đã trả số (đang tải tệp). */
  so: string | null;
  loiMa: string | null;
  thongDiep: string | null;
  soLanGui: number;
  guiLucLabel: string | null;
  moPhong: boolean;
  /** Môi trường cổng đang cấu hình (để hộp "Phát hành lại" nói đúng nơi gửi); `null` = chưa cấu hình. */
  moiTruong: CongHoaDon["moiTruong"] | null;
  kiemTraLai: NutTat;
  phatHanhLai: NutTat;
  boLamTay: NutTat;
};

export function khoiMisa(input: {
  hd: {
    id: string;
    trangThai: "DANG_PHAT_HANH" | "LOI_PHAT_HANH";
    updatedAt: Date;
    kyHieu: string | null;
    soHoaDon: string | null;
    misaLoiMa: string | null;
    misaLoiThongDiep: string | null;
    misaSoLanGui: number;
    misaGuiLuc: Date | null;
    nguonPhatHanh: string;
  };
  misa: CauHinhMisaDong | null;
  coQuyen: boolean;
  thieuNguoiMua: readonly string[];
  /** Người mua HIỆN TẠI của đơn — "Phát hành lại" chụp lại đúng khối này, nên kiểm luật MISA trên nó. */
  nguoiMua: NguoiMuaHoaDon;
}): KhoiMisa {
  const { hd } = input;
  const lyDoQuyen = "Cần quyền payments:confirm tại cơ sở của đơn — hỏi Quản trị hệ thống";
  const lyDoCong = "Chưa bật / chưa cấu hình kết nối MISA — báo người vận hành";
  const dang = hd.trangThai === "DANG_PHAT_HANH";
  const loi = hd.trangThai === "LOI_PHAT_HANH";
  const nut = (dung: boolean, canCong: boolean, them: string | null = null): NutTat =>
    !dung
      ? { bat: false }
      : !input.coQuyen
        ? { bat: false, lyDo: lyDoQuyen }
        : canCong && !input.misa
          ? { bat: false, lyDo: lyDoCong }
          : them
            ? { bat: false, lyDo: them }
            : { bat: true };
  const vn = hd.misaGuiLuc ? new Date(hd.misaGuiLuc.getTime() + 7 * 3600_000).toISOString() : null;
  return {
    trangThai: hd.trangThai,
    hoaDonId: hd.id,
    phienBan: hd.updatedAt.toISOString(),
    so: hd.soHoaDon ? [hd.kyHieu, hd.soHoaDon].filter(Boolean).join("-") : null,
    loiMa: hd.misaLoiMa,
    thongDiep: hd.misaLoiThongDiep,
    soLanGui: hd.misaSoLanGui,
    guiLucLabel: vn ? `${vn.slice(11, 16)} ${vn.slice(8, 10)}/${vn.slice(5, 7)}/${vn.slice(0, 4)}` : null,
    moPhong: hd.nguonPhatHanh === "MISA_GIA_LAP",
    moiTruong: input.misa?.moiTruong ?? null,
    kiemTraLai: nut(dang, true),
    phatHanhLai: nut(
      loi,
      true,
      input.thieuNguoiMua.length > 0
        ? `Sửa thông tin người mua trên đơn trước: ${input.thieuNguoiMua.join(", ")}`
        : loiNguoiMuaMisa(input.nguoiMua),
    ),
    // "Bỏ, làm tay" không cần cổng: gỡ bản lỗi là việc của DB, và phải làm được cả khi MISA đang tắt.
    boLamTay: nut(loi, false),
  };
}
