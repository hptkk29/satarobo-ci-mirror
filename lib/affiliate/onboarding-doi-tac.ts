/**
 * lib/affiliate/onboarding-doi-tac.ts — CHECKLIST «ĐÃ ĐỦ ĐỂ PHÁT LINK CHƯA» của một đối tác (AFF-L3a). THUẦN: không DB, không đồng hồ (`now` là tham số — luật 19).
 *
 * ── MỘT cổng, không bản thứ hai (luật 12b) ───────────────────────────────────────────────────────────────────────
 * «Đủ để phát link» KHÔNG phải một danh sách điều kiện viết tay. Nó là câu trả lời của CHÍNH cổng mà lúc phát link, lúc khách bấm link và lúc nhận biểu mẫu cùng hỏi: `kiemChuoiLink`
 * (`ghi-link-dau-vao.ts`). Màn này dựng một chuỗi ỨNG VIÊN cho từng (chương trình × website) rồi hỏi nó; lý do hiện ra là `NHAN_CHUOI_LINK_KHONG_HOP_LE[mã]` cho MỌI mã trong `tatCa` — không câu
 * chữ riêng. Viết điều kiện riêng ở đây là có ngày checklist báo «đủ» mà nút «Phát link» từ chối (hoặc ngược lại).
 *
 * ── Đường dẫn ứng viên ──────────────────────────────────────────────────────────────────────────────────────────
 * Chưa có link nào để lấy đường dẫn đích, nên lấy từ TRANG ĐÍCH đang bật đầu tiên của website: mẫu chính xác dùng nguyên văn, mẫu tiền tố `/x/*` lấy phần gốc `/x` (dấu * không phải đường
 * dẫn hợp lệ). Website không có trang đích đang bật ⇒ đường dẫn `/` và cổng tự báo «trang đích không còn» — lý do đúng, không phải lỗi dựng.
 */
import { kiemChuoiLink, lyDoNguonChanLink, NHAN_CHUOI_LINK_KHONG_HOP_LE, type ChuoiLink, type NguonCuaLink } from "./ghi-link-dau-vao";
import { kiemThemMembership } from "./ghi-membership-dau-vao";
import { chuanHoaDuongDanMau } from "./website-hop-le";

/** Mã cục bộ khi campaign CHƯA gắn website nào — không có chuỗi nào để hỏi cổng. */
export const LY_DO_CAMPAIGN_CHUA_GAN_WEBSITE = "Campaign chưa gắn website nào — gắn website ở trang chi tiết campaign.";

/** Đường dẫn đích ứng viên lấy từ các trang đích của website (xem đầu tệp). */
export function duongDanUngVien(trangDich: readonly { pathPattern: string; isActive: boolean }[]): string {
  for (const t of trangDich) {
    if (!t.isActive) continue;
    const m = chuanHoaDuongDanMau(t.pathPattern);
    if (!m.ok) continue;
    if (m.kieu === "CHINH_XAC") return m.mau;
    const goc = m.mau.slice(0, -2); // bỏ "/*"
    return goc === "" ? "/" : goc;
  }
  return "/";
}

export type UngVienPhatLink = {
  membershipId: string;
  campaignMa: string;
  campaignTen: string;
  /** Chuỗi ứng viên cho MỘT website của campaign (đã dựng bằng `chuoiTuDong` ở tầng đọc). Campaign chưa gắn website ⇒ không có phần tử nào. */
  websites: readonly { tenWebsite: string; chuoi: ChuoiLink }[];
  /** Nguồn khách của (đối tác × campaign) — cùng câu trả lời mà cổng phát link (`kiemPhatLink`) dùng. BẮT BUỘC khai (luật 7): quên là checklist «đủ» trong khi nút «Phát link» từ chối. */
  nguon: NguonCuaLink;
};

export type KetQuaSanSangChuongTrinh = {
  membershipId: string;
  campaignMa: string;
  campaignTen: string;
  sanSang: boolean;
  /** Website dùng được để phát link (rỗng khi chưa sẵn sàng). */
  websiteDungDuoc: string[];
  /** Mọi lý do chưa sẵn sàng. Khi có website dùng được thì rỗng. */
  lyDo: string[];
};

export type KetQuaSanSangPhatLink = { sanSang: boolean; theoChuongTrinh: KetQuaSanSangChuongTrinh[] };

/**
 * Một chương trình sẵn sàng ⇔ CÓ ÍT NHẤT MỘT website mà chuỗi ứng viên qua `kiemChuoiLink`. Chưa sẵn sàng ⇒ lý do là hợp các mã vi phạm của MỌI website, theo thứ tự cổng (không lặp).
 * Đối tác sẵn sàng ⇔ có ít nhất một chương trình sẵn sàng.
 */
export function danhGiaPhatLink(ungVien: readonly UngVienPhatLink[], now: Date): KetQuaSanSangPhatLink {
  const theoChuongTrinh = ungVien.map((u): KetQuaSanSangChuongTrinh => {
    if (u.websites.length === 0) {
      const nguonLoi = lyDoNguonChanLink(u.nguon);
      return {
        membershipId: u.membershipId,
        campaignMa: u.campaignMa,
        campaignTen: u.campaignTen,
        sanSang: false,
        websiteDungDuoc: [],
        lyDo: [LY_DO_CAMPAIGN_CHUA_GAN_WEBSITE, ...(nguonLoi !== null ? [`Chưa có nguồn khách dùng được trong campaign: ${nguonLoi}`] : [])],
      };
    }
    const dung: string[] = [];
    const lyDo: string[] = [];
    for (const w of u.websites) {
      const kq = kiemChuoiLink(w.chuoi, now);
      if (kq.ok) {
        dung.push(w.tenWebsite);
        continue;
      }
      for (const ma of kq.tatCa) {
        const cau = NHAN_CHUOI_LINK_KHONG_HOP_LE[ma];
        // Nhiều website cùng vướng một lý do chung (đối tác chưa hoạt động…) chỉ nói một lần; lý do riêng của website thì kèm tên website.
        const rieng = ma === "WEBSITE_KHONG_HOAT_DONG" || ma === "THEO_DOI_DANG_TAT" || ma === "TRANG_DICH_KHONG_CON" || ma === "SITE_KHONG_GAN_CAMPAIGN";
        const dong = rieng && u.websites.length > 1 ? `${cau} (${w.tenWebsite})` : cau;
        if (!lyDo.includes(dong)) lyDo.push(dong);
      }
    }
    // Nguồn khách: cổng phát link CHẶN khi đối tác chưa quy được nguồn trong campaign (`kiemPhatLink`) ⇒ checklist cũng phải nói «chưa sẵn sàng», kèm đúng lý do đó.
    const lyDoNguon = lyDoNguonChanLink(u.nguon);
    if (lyDoNguon !== null) {
      const cau = `Chưa có nguồn khách dùng được trong campaign: ${lyDoNguon}`;
      if (!lyDo.includes(cau)) lyDo.push(cau);
    }
    const sanSang = dung.length > 0 && lyDoNguon === null;
    return { membershipId: u.membershipId, campaignMa: u.campaignMa, campaignTen: u.campaignTen, sanSang, websiteDungDuoc: sanSang ? dung : [], lyDo: sanSang ? [] : lyDo };
  });
  return { sanSang: theoChuongTrinh.some((t) => t.sanSang), theoChuongTrinh };
}

// ── Các bước của chuỗi onboarding ────────────────────────────────────────────────────────────────────────────

export type TrangThaiBuoc = "XONG" | "CHUA" | "CHAN" | "TUY_CHON";
export type MaBuoc = "HO_SO" | "KICH_HOAT" | "GHI_DANH" | "NGUON" | "TAI_KHOAN" | "PHAT_LINK";

export type BuocOnboarding = { ma: MaBuoc; ten: string; trangThai: TrangThaiBuoc; ghiChu: string };

export type DauVaoBuoc = {
  doiTac: { status: "DRAFT" | "PENDING" | "ACTIVE" | "SUSPENDED" | "ENDED"; coLoai: boolean };
  /** Số dòng thành viên (campaign) theo trạng thái — chỉ tính campaign chưa kết thúc? Không: tính mọi dòng, ENDED để riêng. */
  thanhVien: { PENDING: number; ACTIVE: number; SUSPENDED: number; ENDED: number };
  /** Trong các thành viên chưa kết thúc: bao nhiêu campaign KHÔNG giải ra được nguồn (cần xem tay). */
  soChuongTrinhThieuNguon: number;
  /** Tài khoản đang vào được cổng (ACTIVE). */
  soTaiKhoanHoatDong: number;
  sanSangPhatLink: boolean;
};

/**
 * Trình tự THẬT: hồ sơ → kích hoạt → ghi danh → nguồn → tài khoản → phát link. KHÔNG phải trình tự «ghi danh trước, duyệt sau»: cổng ghi danh (`kiemThemMembership`) chỉ nhận đối tác ĐANG HOẠT
 * ĐỘNG, nên bước ghi danh bị CHẶN cho tới khi đối tác được duyệt — và bước ghi danh nói đúng điều đó.
 */
export function cacBuocOnboarding(d: DauVaoBuoc): BuocOnboarding[] {
  // «Ghi danh được không» hỏi CHÍNH cổng `kiemThemMembership` (campaign đại diện ở trạng thái đang chạy để chỉ còn lại vế đối tác) — không chép điều kiện «đối tác phải ACTIVE» ở đây.
  const congGhiDanh = kiemThemMembership({ campaign: { status: "ACTIVE" }, doiTac: { status: d.doiTac.status }, hienCo: null });
  const dangCoThanhVien = d.thanhVien.PENDING + d.thanhVien.ACTIVE + d.thanhVien.SUSPENDED;
  const buoc: BuocOnboarding[] = [];

  buoc.push({
    ma: "HO_SO",
    ten: "Hồ sơ & loại đối tác",
    trangThai: d.doiTac.coLoai ? "XONG" : "CHUA",
    ghiChu: d.doiTac.coLoai ? "Đã chọn loại đối tác." : "Chưa chọn loại — loại quyết định cần duyệt hay không và nguồn mặc định của khách. Bấm «Sửa hồ sơ».",
  });

  const ttKichHoat: Record<DauVaoBuoc["doiTac"]["status"], { tt: TrangThaiBuoc; ghi: string }> = {
    ACTIVE: { tt: "XONG", ghi: "Đối tác đang hoạt động." },
    PENDING: { tt: "CHUA", ghi: "Đang chờ duyệt — bấm «Duyệt» để kích hoạt." },
    DRAFT: { tt: "CHUA", ghi: "Còn là bản nháp — bấm «Kích hoạt»." },
    SUSPENDED: { tt: "CHAN", ghi: "Đối tác đang tạm ngưng — mở lại thì mới ghi danh và phát link được." },
    ENDED: { tt: "CHAN", ghi: "Đối tác đã kết thúc — hồ sơ đã đóng." },
  };
  buoc.push({ ma: "KICH_HOAT", ten: "Duyệt / kích hoạt đối tác", trangThai: ttKichHoat[d.doiTac.status].tt, ghiChu: ttKichHoat[d.doiTac.status].ghi });

  buoc.push({
    ma: "GHI_DANH",
    ten: "Ghi danh vào campaign",
    trangThai: d.thanhVien.ACTIVE > 0 ? "XONG" : !congGhiDanh.ok ? "CHAN" : "CHUA",
    ghiChu:
      d.thanhVien.ACTIVE > 0
        ? `Đang tham gia ${d.thanhVien.ACTIVE} campaign.`
        : !congGhiDanh.ok
          ? congGhiDanh.loi
          : d.thanhVien.PENDING > 0
            ? `${d.thanhVien.PENDING} campaign đang chờ duyệt thành viên.`
            : "Chưa ghi danh vào campaign nào.",
  });

  buoc.push({
    ma: "NGUON",
    ten: "Nguồn khách theo campaign",
    trangThai: dangCoThanhVien === 0 ? "CHUA" : d.soChuongTrinhThieuNguon === 0 ? "XONG" : "CHUA",
    ghiChu:
      dangCoThanhVien === 0
        ? "Chưa có campaign nào để xem trước."
        : d.soChuongTrinhThieuNguon === 0
          ? "Mọi campaign đều giải ra được nguồn khách."
          : `${d.soChuongTrinhThieuNguon} campaign chưa giải ra được nguồn — khách của đối tác ở đó sẽ rơi vào «cần xem tay». Cấu hình quy tắc / nguồn mặc định ở campaign hoặc loại đối tác.`,
  });

  buoc.push({
    ma: "TAI_KHOAN",
    ten: "Tài khoản truy cập cổng",
    trangThai: d.soTaiKhoanHoatDong > 0 ? "XONG" : "TUY_CHON",
    ghiChu: d.soTaiKhoanHoatDong > 0 ? `${d.soTaiKhoanHoatDong} tài khoản vào được cổng.` : "Tuỳ chọn — liên kết tài khoản phụ huynh có sẵn nếu đối tác cần xem số liệu ở cổng.",
  });

  buoc.push({
    ma: "PHAT_LINK",
    ten: "Đủ điều kiện phát link",
    trangThai: d.sanSangPhatLink ? "XONG" : "CHUA",
    ghiChu: d.sanSangPhatLink ? "Có ít nhất một campaign đủ điều kiện phát link." : "Chưa campaign nào đủ điều kiện — xem lý do từng campaign bên dưới.",
  });
  return buoc;
}
