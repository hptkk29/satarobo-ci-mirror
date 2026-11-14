import "server-only";
import { SYSTEM_ACTOR } from "@/lib/auth/system-actor";
import { db } from "@/lib/db";
import { bamNguoiMua } from "./bam-nguoi-mua";
import { napHangChoHoaDon } from "./hang-cho";
import { daKhaiHoaDon, nguoiMuaChoDon, thieuChoHoaDon, type NguoiMuaHoaDon } from "./nguoi-mua";
import { napTrangPhieuCho } from "./trang-phieu-cho";
import { lyDoBoQuaTuXuat } from "./xuat-lien/chon-lan-thu";

// lib/finance/hoa-don/xuat-lien.ts — XEM TRƯỚC cho nút «Xuất liền» của Sale (BGĐ đổi yêu cầu 09/11/2026).
//
// Phụ huynh có yêu cầu hoá đơn VÀ cần liền: Sale đối chiếu thông tin với phụ huynh ở hộp xác nhận rồi mới bấm. Hộp đó đọc từ ĐÂY — CHÍNH các hàm hàng chờ / phiếu / chọn lần thu mà bước phát hành
// dùng (`xuLyMotYeuCau` ở `tu-xuat-sau-gio/chay-tu-xuat.ts`), nên cái Sale THẤY là cái sẽ được xuất, không phải một bản dựng lại có thể lệch.
//
// ⚠️ `dauVan` — dấu của đúng thứ Sale đang xem (người mua + từng lần thu + số tiền). Lúc bấm «Xuất» máy chủ dựng LẠI và so: phụ huynh gửi lại form, hoặc kế toán đổi khoản, trong lúc hộp đang mở
//    ⇒ lệch ⇒ từ chối và bắt Sale xem lại. Không có dấu này, «đối chiếu rồi mới xuất» chỉ là lời hứa suông (luật 12): hoá đơn đã phát hành không xoá được.
// ⚠️ Hàm này KHÔNG kiểm quyền của người gọi — action (`_actions-nguoi-mua.ts`) kiểm `duocXuLyYeuCau` + cờ cơ sở TRƯỚC khi gọi. Đọc bằng `SYSTEM_ACTOR` như bước phát hành (Sale không có
//    `payments:confirm` nên hàng chờ của riêng họ sẽ rỗng); mọi thứ trả ra chỉ gồm thông tin của MỘT đơn mà người gọi đã được kiểm là có quyền với nó.

export type LanThuXuatLien = { key: string; ngayThu: string; soTien: number; nhanNguon: string };
export type LanThuKhongXuatLien = { ngayThu: string; soTien: number; lyDo: string };

export type XemTruocXuatLien =
  | {
      ok: true;
      nguoiMua: NguoiMuaHoaDon;
      /** Tên học viên in trên tờ (từ phiếu) — để Sale đối chiếu «hoá đơn này của bé nào». */
      hocVien: string | null;
      emailNhan: string | null;
      lanThu: LanThuXuatLien[];
      /** Lần thu của đơn đang chờ xuất nhưng KHÔNG xuất liền được (kèm lý do) — Sale thấy để không tưởng đã xuất hết. */
      khongXuatLien: LanThuKhongXuatLien[];
      tongTien: number;
      dauVan: string;
    }
  | { ok: false; error: string };

const LY_DO: Record<string, string> = {
  NGAN_KHAC: "Không còn ở hàng «Chờ xuất»",
  KHONG_PHAT_HANH_DUOC: "Chưa phát hành được (pháp nhân không dùng API / thiếu cấu hình hoá đơn của cơ sở)",
  NGOAI_LE: "Lần thu thiếu tiền hoặc nghi trùng — cần kế toán quyết",
  KHOAN_CHUA_XAC_NHAN: "Còn khoản chưa được kế toán xác nhận — Sale không xác nhận tiền được, nhờ kế toán xác nhận rồi bấm lại",
};

export const dauVanXuatLien = (nm: NguoiMuaHoaDon, lanThu: readonly { key: string; soTien: number }[]): string =>
  `${bamNguoiMua(nm)}|${lanThu.map((l) => `${l.key}:${l.soTien}`).join(",")}`;

export async function xemTruocXuatLien(input: { orderId: string; centerId: string }): Promise<XemTruocXuatLien> {
  let dong;
  try {
    dong = (await napHangChoHoaDon(SYSTEM_ACTOR, { canViewPii: true, orderId: input.orderId })).dong;
  } catch {
    return { ok: false, error: "Không đọc được hàng chờ hoá đơn của đơn này — thử lại sau" };
  }
  const cho = dong.filter((d) => d.ngan === "cho" && d.coSoId === input.centerId);
  if (cho.length === 0) return { ok: false, error: "Đơn này không có lần thu nào đang chờ xuất hoá đơn (đã xuất, hoặc chưa có khoản thu)" };

  const chuaXacNhan = await db.payment.findMany({ where: { id: { in: [...new Set(cho.flatMap((d) => d.khoanIds))] }, accountantStatus: { not: "CONFIRMED" } }, select: { id: true } });
  const bc = { khoanChuaXacNhan: new Set(chuaXacNhan.map((p) => p.id)) };

  const duoc: typeof cho = [];
  const khong: LanThuKhongXuatLien[] = [];
  for (const d of [...cho].sort((a, b) => a.ngayThu.localeCompare(b.ngayThu) || a.ghiNhanLuc.localeCompare(b.ghiNhanLuc))) {
    const loai = lyDoBoQuaTuXuat({ ngan: d.ngan, phatHanhHien: d.phatHanhMisa.hien, coNgoaiLe: d.hanhDong.ngoaiLe != null, cocChuaTraDu: d.cocChuaTraDu, khoanIds: d.khoanIds }, bc);
    if (loai) khong.push({ ngayThu: d.ngayThu, soTien: d.soTien, lyDo: LY_DO[loai] ?? "Chưa xuất liền được" });
    else duoc.push(d);
  }
  if (duoc.length === 0) {
    return { ok: false, error: khong[0] ? `Chưa xuất liền được: ${khong[0].lyDo}` : "Chưa có lần thu nào đủ điều kiện xuất liền" };
  }

  let nap;
  try {
    nap = await napTrangPhieuCho(SYSTEM_ACTOR, duoc[0]!);
  } catch {
    return { ok: false, error: "Không dựng được phiếu của lần thu — thử lại sau" };
  }
  if (!nap.ok) return { ok: false, error: nap.error };

  // «Có yêu cầu hoá đơn» = đơn đã có thông tin người mua RIÊNG (phụ huynh gửi qua QR hoặc Sale đã nhập). Không có ⇒ không xuất «người tiêu dùng» ở nút này:
  // đó là việc của lô cuối ngày, còn nút này là «xuất đúng tờ phụ huynh xin».
  if (!daKhaiHoaDon(nap.khoiDon)) return { ok: false, error: "Đơn chưa có thông tin người mua riêng cho hoá đơn — để phụ huynh điền qua mã QR hoặc nhập ở khối «Người mua trên hoá đơn»" };
  const nguoiMua = nguoiMuaChoDon(nap.khoiDon);
  const thieu = thieuChoHoaDon(nguoiMua).chan;
  if (thieu.length > 0) return { ok: false, error: `Thông tin người mua còn thiếu: ${thieu.join("; ")}` };

  const lanThu = duoc.map((d) => ({ key: d.key, ngayThu: d.ngayThu, soTien: d.soTien, nhanNguon: d.nguonLabel }));
  return {
    ok: true,
    nguoiMua,
    hocVien: nap.hocVien?.ten ?? nap.tenHocVienTheoKhoan.find((t) => Boolean(t)) ?? null,
    emailNhan: nguoiMua.email,
    lanThu,
    khongXuatLien: khong,
    tongTien: lanThu.reduce((s, l) => s + l.soTien, 0),
    dauVan: dauVanXuatLien(nguoiMua, lanThu),
  };
}
