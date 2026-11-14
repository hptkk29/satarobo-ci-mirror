/**
 * lib/nguon/chi-tiet-nguon.ts — PHẦN THUẦN của «Chính sách áp dụng» ở chi tiết một nguồn (SPEC nguồn động §4 mục 3/7).
 *
 * Hai việc, không DB:
 *  1. `moTaNguoiHuong` — «ai nhận» của một vai, đọc từ THUỘC TÍNH vai (`resolverType` / `resolverKey`), KHÔNG so mã vai: danh mục vai cũng là dữ liệu mở.
 *  2. `tachHoaHongNguon` — tách các dòng của ma trận thành «Hoa hồng NGUỒN» (vai `isAcquisition` — thu hút khách, chịu cửa sổ ghi công) và «Hoa hồng giao dịch
 *     KHÁC» (Sale · Sale Admin · QLCS · Marketing · GV Trial …). Hai nhóm tách riêng vì chúng trả lời hai câu hỏi khác nhau: «nguồn này khiến ai được thưởng vì đem khách
 *     về» và «giao dịch này nuôi những ai khác» — trộn là người đọc cộng nhầm.
 *
 * Tổng phần trăm cộng bằng SỐ NGUYÊN micro (cùng phép với ma trận và `kiemTran`), không cộng chuỗi/thập phân.
 */
import type { OMaTran } from "@/lib/hoa-hong/ma-tran-chinh-sach";
import { microSangPhanTram } from "@/lib/hoa-hong/phan-tram";
import { tiLeSangMicro } from "@/lib/hoa-hong/tien";

export type VaiHuongTho = {
  code: string;
  name: string;
  resolverType: string;
  resolverKey: string | null;
  isAcquisition: boolean;
};

/** Người phụ trách nguồn (nhân sự), như đọc từ `LeadSourceGroup.ownerEmployee`. */
export type ChuNguon = { ten: string; maNv: string | null; coTaiKhoan: boolean } | null;

export type MoTaNguoiHuong = {
  /** Câu một dòng để in cạnh tên vai. */
  nhan: string;
  /** `true` ⇒ phần của vai này sẽ bị TREO (hàng chờ) vì thiếu người — màn hình phải nói ra, không để «0đ giả». */
  thieu: boolean;
};

const THEO_TUNG_LEAD: Readonly<Record<string, string>> = {
  REFERRER_PARENT: "Phụ huynh giới thiệu — theo từng lead",
  REFERRER_PARENT_SALE: "Sale phụ trách phụ huynh giới thiệu — ảnh chụp lúc ghi nhận nguồn, theo từng lead",
  REFERRER_EMPLOYEE: "Nhân sự giới thiệu — theo từng lead",
  AFFILIATE: "Đối tác giới thiệu — theo từng lead",
};

export function moTaNguoiHuong(vai: VaiHuongTho, chu: ChuNguon): MoTaNguoiHuong {
  switch (vai.resolverType) {
    case "SOURCE_OWNER":
      if (!chu) return { nhan: "Người phụ trách nguồn — CHƯA khai (phần này sẽ treo ở hàng chờ)", thieu: true };
      if (!chu.coTaiKhoan) return { nhan: `${chu.ten}${chu.maNv ? ` (${chu.maNv})` : ""} — chưa có tài khoản nên phần này sẽ treo ở hàng chờ`, thieu: true };
      return { nhan: `${chu.ten}${chu.maNv ? ` (${chu.maNv})` : ""} — người phụ trách nguồn`, thieu: false };
    case "DIRECT_PERSON":
      return { nhan: (vai.resolverKey && THEO_TUNG_LEAD[vai.resolverKey]) || "Người được chỉ định theo từng lead", thieu: false };
    case "TRANSACTION_ROLE":
      return { nhan: "Người giữ vai trên giao dịch (theo từng đơn)", thieu: false };
    case "ORG_UNIT_ROLE":
      return { nhan: "Người được phân công cho cơ sở", thieu: false };
    case "SOURCE_MEMBER":
      return { nhan: "Thành viên nguồn — chưa hỗ trợ (phần này sẽ treo ở hàng chờ)", thieu: true };
    default:
      return { nhan: vai.name, thieu: false };
  }
}

export type DongChiTiet = {
  vai: { code: string; name: string; laThuHut: boolean };
  nguoiHuong: MoTaNguoiHuong;
  o: OMaTran;
};

export type NhomHoaHong = {
  dong: DongChiTiet[];
  /** Tổng các tỉ lệ PERCENT của nhóm, dạng "9" / "8,5". */
  tongPhanTram: string;
  /** Có dòng chồng lấn / kiểu tính không quy ra % ⇒ tổng chỉ là phần biết được. */
  khongTinDuoc: boolean;
};

export type HoaHongTach = { nguon: NhomHoaHong; khac: NhomHoaHong };

function gom(dong: DongChiTiet[]): NhomHoaHong {
  let micro = BigInt(0);
  let khongTin = false;
  for (const d of dong) {
    if (d.o.kieu === "PERCENT") micro += tiLeSangMicro(d.o.tiLe);
    else if (d.o.kieu === "CHONG_LAN" || d.o.kieu === "CO_DINH" || d.o.kieu === "KHAC_KIEU") khongTin = true;
  }
  return { dong, tongPhanTram: microSangPhanTram(micro), khongTinDuoc: khongTin };
}

/**
 * Tách dòng ma trận (đã gắn vai + người hưởng) thành «hoa hồng nguồn» và «giao dịch khác» THEO `isAcquisition` của vai — thuộc tính của dòng master,
 * không so mã. Vai không có rule nào áp (`KHONG_CO`) vẫn được giữ trong danh sách: người đọc cần thấy «vai này KHÔNG được gì từ nguồn này».
 */
export function tachHoaHongNguon(dong: readonly DongChiTiet[]): HoaHongTach {
  return {
    nguon: gom(dong.filter((d) => d.vai.laThuHut)),
    khac: gom(dong.filter((d) => !d.vai.laThuHut)),
  };
}
