// @vitest-environment jsdom
/**
 * [CTN-UI-*] Các MỤC của trang chi tiết nguồn — trên PHẦN TỬ THẬT (jsdom), props thuần (không DB). SPEC nguồn động §4 mục 4/5.
 *
 *   [CTN-UI-01] Thông tin + Attribution: đủ trường; không in id thô; cửa sổ riêng ↔ mặc định; «chọn được ở ô nhập» đi qua CHÍNH `nguonChonDuoc`
 *   [CTN-UI-02] bốn trạng thái của MỖI mục: có dữ liệu · rỗng · LỖI (role=alert) · KHÔNG QUYỀN (nêu khoá thật) — một mục hỏng không che mục khác
 *   [CTN-UI-03] Đối tượng liên quan: đếm theo loại, rỗng nói thật
 *   [CTN-UI-04] Chính sách áp dụng: hoa hồng NGUỒN tách khỏi giao dịch KHÁC; cờ tắt ⇒ phiên bản kèm lý do; engine tắt có dòng nói; trần null ≠ «trong trần»; vượt trần chỉ đường
 *   [CTN-UI-05] tiền: null ⇒ KHÔNG số nào (≠ 0đ); có số ⇒ kèm phạm vi
 *   [CTN-UI-06] liên kết «Tạo chính sách»: ma trận (đối chứng dương: đủ điều kiện ⇒ có liên kết đúng href)
 *   [CTN-UI-07] Lịch sử: rỗng · chạm trần nói «có thể còn» · đủ thì nói đủ · liên kết xem tất cả / thu gọn
 *   [CTN-UI-08] Tracking + Thống kê: số THẬT, rỗng nói thật
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// `MucDoiTuong` kéo nút «Chụp lại chủ nguồn» → Server Action thật → next-auth (không dựng được trong jsdom). Mục này chỉ cần nút KHÔNG vẽ khi không truyền `chupLai`.
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/nguon/_actions-chup-lai", () => ({ chupLaiChuNguonAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import type { ChinhSachApDungCuaNguon, HoaHongCuaNguon, MucLichSuNguon, NguonDeSuaView } from "@/lib/nguon/doc-chi-tiet-nguon";
import type { ChiTietNguon } from "@/lib/nguon/doc-danh-muc";
import type { KetQuaMuc } from "@/lib/nguon/doc-trang-chi-tiet";
import { MucChinhSach } from "./muc-chinh-sach";
import { MucDoiTuong } from "./muc-doi-tuong";
import { MucLichSu } from "./muc-lich-su";
import { MucAttribution, MucThongTin } from "./muc-thong-tin";
import { MucThongKe, MucTracking } from "./muc-tracking-thong-ke";
import { NHAN_LOAI_NGUON } from "./nhan-chi-tiet";

afterEach(cleanup);

const NOW = new Date("2026-10-09T03:00:00.000Z");
const ok = <T,>(du: T): KetQuaMuc<T> => ({ ok: true, du });
const LOI = { ok: false, loai: "LOI" } as const;
const QUYEN = { ok: false, loai: "QUYEN" } as const;

const nguonMau = (p: Partial<NguonDeSuaView> = {}): NguonDeSuaView => ({
  id: "n1",
  code: "ZALO_OA",
  name: "Zalo OA",
  description: "Khách nhắn qua Zalo OA",
  sourceType: "MARKETING",
  referrerRequirement: "NONE",
  requiresNote: false,
  selectable: true,
  status: "ACTIVE",
  isSystem: false,
  sortOrder: 40,
  attributionWindowDays: null,
  commissionEnabled: false,
  ownerOrgUnitId: null,
  ownerEmployee: null,
  effectiveFrom: null,
  effectiveTo: null,
  capNhatLuc: "2026-10-09T03:00:00.000Z",
  daDung: { attribution: false, touchpoint: false, phienBanChinhSach: false, so: false, page: false, nhomNhanSuMacDinh: false, daDung: false },
  khoa: [],
  chuyenDuoc: ["INACTIVE", "ARCHIVED"],
  dinhTien: { chinhSachRieng: false, coDongThuHutRieng: false, ruleChuNguonBatKy: false, ruleChuChay: false },
  ...p,
});

const chiTietMau = (p: Partial<ChiTietNguon["thongKe"]> = {}): ChiTietNguon => ({
  nguon: { id: "n1", code: "ZALO_OA", documentNo: null, name: "Zalo OA", description: null, referrerRequirement: "NONE", requiresNote: false, selectable: true, isSystem: false, sortOrder: 40, status: "ACTIVE" },
  cuaSoGhiCongNgay: 90,
  cuaSoRiengNgay: null,
  pageDaMap: [{ pageId: "page-1", campaignCode: "THANG10" }],
  thongKe: {
    tong: 12,
    ba30: 5,
    bay7: 2,
    coNguoiGioiThieu: 4,
    thieuNguoi: 3,
    theoTrangThaiLead: [{ trangThai: "MOI", so: 12 }],
    theoDuongVao: [{ duongVao: "zalo", so: 12 }],
    hangChoTheoLyDo: { UNKNOWN: 0, THIEU_NGUOI: 3, THIEU_GIAI_TRINH: 0, CANH_BAO: 1 },
    ...p,
  },
});

describe("[CTN-UI-01] Thông tin + Attribution", () => {
  it("in đủ trường; nhóm nguồn có nhãn VN; KHÔNG in id đơn vị/nhân sự thô", () => {
    render(
      <MucThongTin
        nguon={ok(nguonMau({ ownerOrgUnitId: "cmgorgunit0123456789abcd", ownerEmployee: { id: "cmgemp0123456789abcdefg", ten: "Trần Thị Lan", maNv: "NV007", coTaiKhoan: true } }))}
        tenDonVi="Cơ sở 1 — Nguyễn Hữu Thọ"
        now={NOW}
      />,
    );
    const muc = screen.getByRole("region", { name: "Thông tin" });
    expect(within(muc).getByText("ZALO_OA")).toBeTruthy();
    expect(within(muc).getByText(NHAN_LOAI_NGUON.MARKETING)).toBeTruthy();
    expect(within(muc).getByText("Cơ sở 1 — Nguyễn Hữu Thọ")).toBeTruthy();
    expect(within(muc).getByText(/Trần Thị Lan/)).toBeTruthy();
    expect(muc.textContent).not.toMatch(/cmgorgunit|cmgemp/);
  });

  it("nguồn đã dùng ⇒ nói VÌ SAO không đổi được mã (lý do lấy từ cổng ghi)", () => {
    render(<MucThongTin nguon={ok(nguonMau({ khoa: [{ truong: "code", lyDo: "Nguồn đã có lead, chính sách, sổ hoặc Page tham chiếu." }] }))} tenDonVi={null} now={NOW} />);
    expect(screen.getByText(/Không đổi được mã: Nguồn đã có lead/)).toBeTruthy();
  });

  it("nhân sự phụ trách chưa có tài khoản ⇒ cảnh báo phần hoa hồng sẽ treo", () => {
    render(<MucThongTin nguon={ok(nguonMau({ ownerEmployee: { id: "e", ten: "Lê Văn Chủ", maNv: null, coTaiKhoan: false } }))} tenDonVi={null} now={NOW} />);
    expect(screen.getByText(/chưa có tài khoản/)).toBeTruthy();
  });

  it("«Chọn được ở ô nhập» đi qua nguonChonDuoc: nháp / hết hạn / không selectable ⇒ Không + đúng lý do; đang dùng ⇒ Có", () => {
    const chon = (p: Partial<NguonDeSuaView>) => {
      cleanup();
      render(<MucThongTin nguon={ok(nguonMau(p))} tenDonVi={null} now={NOW} />);
      return screen.getByText("Chọn được ở ô nhập").nextElementSibling!.textContent!;
    };
    expect(chon({})).toMatch(/^Có/);
    expect(chon({ status: "DRAFT" })).toMatch(/^Không.*chưa ở trạng thái «Đang dùng»/);
    expect(chon({ selectable: false })).toMatch(/^Không.*ô nhập không cho chọn/);
    expect(chon({ effectiveTo: "2026-10-01T00:00:00.000Z" })).toMatch(/^Không.*ngoài khoảng hiệu lực/);
  });

  it("Attribution: cửa sổ RIÊNG ↔ MẶC ĐỊNH; không đọc được số ngày vẫn không bịa", () => {
    const { rerender } = render(<MucAttribution nguon={ok(nguonMau({ attributionWindowDays: 45 }))} cuaSoMacDinh={90} />);
    expect(screen.getByText("45 ngày")).toBeTruthy();
    expect(screen.getByText(/cửa sổ riêng của nguồn này/)).toBeTruthy();
    rerender(<MucAttribution nguon={ok(nguonMau())} cuaSoMacDinh={90} />);
    expect(screen.getByText("90 ngày")).toBeTruthy();
    expect(screen.getByText(/mặc định chung của hệ thống/)).toBeTruthy();
    rerender(<MucAttribution nguon={ok(nguonMau())} cuaSoMacDinh={null} />);
    expect(screen.getByText(/không đọc được số ngày/)).toBeTruthy();
    expect(screen.queryByText(/ngày kể từ/)).toBeNull();
  });

  it("Attribution: cách xác định + giải trình theo thuộc tính của nguồn", () => {
    render(<MucAttribution nguon={ok(nguonMau({ referrerRequirement: "EMPLOYEE", requiresNote: true }))} cuaSoMacDinh={90} />);
    expect(screen.getByText(/Người nhập phải chọn: nhân sự/)).toBeTruthy();
    expect(screen.getByText(/Bắt buộc \(từ 10 ký tự\)/)).toBeTruthy();
  });
});

describe("[CTN-UI-02] bốn trạng thái, mỗi mục tự nói", () => {
  it("LỖI: role=alert, các mục khác vẫn vẽ", () => {
    render(
      <>
        <MucThongTin nguon={LOI} tenDonVi={null} now={NOW} />
        <MucTracking chiTiet={ok(chiTietMau())} />
        <MucThongKe chiTiet={LOI} />
      </>,
    );
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(2);
    expect(alerts[0]!.textContent).toMatch(/Không đọc được mục này/);
    expect(within(screen.getByRole("region", { name: "Tracking" })).getByText("page-1")).toBeTruthy(); // mục lành vẫn đọc được
  });

  it("KHÔNG QUYỀN: nêu khoá thật `sources:view`, không phải 403 trần", () => {
    render(<MucAttribution nguon={QUYEN} cuaSoMacDinh={null} />);
    const note = screen.getByRole("note");
    expect(note.textContent).toMatch(/Bạn không có quyền xem mục này/);
    expect(within(note).getByText("sources:view").tagName).toBe("CODE");
  });
});

describe("[CTN-UI-03] Đối tượng liên quan", () => {
  it("đếm theo loại, chỉ loại có lead; «Còn thiếu người» chỉ khi nguồn cần người", () => {
    render(<MucDoiTuong nguon={ok(nguonMau({ referrerRequirement: "EMPLOYEE" }))} nguoiGioiThieu={ok({ EMPLOYEE: 7, PARENT: 0, AFFILIATE: 2 })} chiTiet={ok(chiTietMau())} />);
    const muc = screen.getByRole("region", { name: "Đối tượng liên quan" });
    expect(within(muc).getByText("Giới thiệu bởi nhân sự").nextElementSibling!.textContent).toBe("7 lead");
    expect(within(muc).getByText("Giới thiệu bởi đối tác · cộng tác viên").nextElementSibling!.textContent).toBe("2 lead");
    expect(within(muc).queryByText("Giới thiệu bởi phụ huynh")).toBeNull();
    expect(within(muc).getByText("Còn thiếu người").nextElementSibling!.textContent).toBe("3 lead");
  });
  it("nguồn không cần người + chưa lead nào ⇒ nói thật, không dòng thiếu người", () => {
    render(<MucDoiTuong nguon={ok(nguonMau())} nguoiGioiThieu={ok({ EMPLOYEE: 0, PARENT: 0, AFFILIATE: 0 })} chiTiet={ok(chiTietMau())} />);
    expect(screen.getByText(/Chưa có lead nào của nguồn này mang người giới thiệu/)).toBeTruthy();
    expect(screen.queryByText("Còn thiếu người")).toBeNull();
  });
  it("đếm hỏng ⇒ chỉ phần đếm báo lỗi, chủ nguồn vẫn hiện", () => {
    render(<MucDoiTuong nguon={ok(nguonMau({ ownerEmployee: { id: "e", ten: "Lê Văn Chủ", maNv: "NV9", coTaiKhoan: true } }))} nguoiGioiThieu={LOI} chiTiet={ok(chiTietMau())} />);
    expect(screen.getByText(/Lê Văn Chủ/)).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});

// ── Chính sách ────────────────────────────────────────────────────────────────────────────────────────
const nguonGoc = { cuThe: false, policyId: "p1", policyCode: "HV_MOI", version: 1, phamVi: "GLOBAL" as const };
const dongVai = (code: string, name: string, laThuHut: boolean, phanTram: string | null, thieu = false): ChinhSachApDungCuaNguon["theoLoai"][number]["nguon"]["dong"][number] => ({
  vai: { code, name, laThuHut },
  nguoiHuong: { nhan: thieu ? `${name} — CHƯA khai` : `${name} — người nhận`, thieu },
  o: phanTram === null ? { cot: "n1", kieu: "KHONG_CO" } : { cot: "n1", kieu: "PERCENT", tiLe: "0.01", phanTram, ...nguonGoc },
});
const nhom = (dong: ReturnType<typeof dongVai>[], tong: string) => ({ dong, tongPhanTram: tong, khongTinDuoc: false });

const chinhSachMau = (p: { tran?: string | null; vuot?: boolean | null; tong?: string; bat?: boolean; phienBan?: ChinhSachApDungCuaNguon["phienBanRieng"] } = {}): ChinhSachApDungCuaNguon => ({
  nguon: { code: "ZALO_OA", name: "Zalo OA", status: "ACTIVE", commissionEnabled: p.bat ?? true, isSystem: false },
  chu: null,
  phienBanRieng: p.phienBan ?? [],
  theoLoai: (["NEW", "RENEWAL"] as const).map((loai) => ({
    loai,
    nguon: nhom([dongVai("REFERRER_EMPLOYEE", "Nhân sự giới thiệu", true, "2")], "2"),
    khac: nhom([dongVai("SALE", "Sale chốt đơn", false, "4"), dongVai("GV_TRIAL", "Giáo viên học thử", false, null)], "4"),
    tongPhanTram: p.tong ?? "6",
    tranPhanTram: p.tran === undefined ? "9" : p.tran,
    vuotTran: p.vuot === undefined ? false : p.vuot,
    khongTinDuoc: false,
  })),
});

const noLink = { loai: "AN" } as const;

describe("[CTN-UI-04] Chính sách áp dụng", () => {
  it("hoa hồng NGUỒN tách khỏi giao dịch KHÁC: vai thu hút chỉ ở bảng nguồn, vai nuôi giao dịch chỉ ở bảng khác; vai không được gì vẫn nằm trong bảng", () => {
    render(<MucChinhSach chinhSach={ok(chinhSachMau())} hoaHong={ok(null)} engineBat coQuyenSuaTran lienKet={noLink} />);
    const neu = document.querySelector('[data-loai-gd="NEW"]') as HTMLElement;
    const nguon = within(neu).getByRole("heading", { name: "Hoa hồng nguồn" }).closest("[data-nhom-hoa-hong]") as HTMLElement;
    const khac = within(neu).getByRole("heading", { name: "Hoa hồng giao dịch khác" }).closest("[data-nhom-hoa-hong]") as HTMLElement;
    expect(within(nguon).getByText("Nhân sự giới thiệu")).toBeTruthy();
    expect(within(nguon).queryByText("Sale chốt đơn")).toBeNull();
    expect(within(khac).getByText("Sale chốt đơn")).toBeTruthy();
    expect(within(khac).queryByText("Nhân sự giới thiệu")).toBeNull();
    const gv = within(khac).getByText("Giáo viên học thử").closest("tr")!;
    expect(within(gv).getByText("Không có")).toBeTruthy(); // vai không có rule vẫn hiện, nói «Không có»
    expect(within(within(nguon).getByText("Nhân sự giới thiệu").closest("tr")!).getByText("2%")).toBeTruthy();
    expect(within(neu).getByText("Khách hàng mới")).toBeTruthy();
  });

  it("loại giao dịch mà MỌI vai đều «Không có» ⇒ một câu thay vì tám dòng «Không có»; loại có chính sách vẫn đủ bảng (đối chứng dương)", () => {
    const c = chinhSachMau();
    c.theoLoai[1] = {
      ...c.theoLoai[1]!,
      nguon: nhom([dongVai("REFERRER_EMPLOYEE", "Nhân sự giới thiệu", true, null)], "0"),
      khac: nhom([dongVai("SALE", "Sale chốt đơn", false, null)], "0"),
    };
    render(<MucChinhSach chinhSach={ok(c)} hoaHong={ok(null)} engineBat coQuyenSuaTran lienKet={noLink} />);
    const tai = document.querySelector('[data-loai-gd="RENEWAL"]') as HTMLElement;
    expect(tai.hasAttribute("data-loai-trong")).toBe(true);
    expect(within(tai).getByText(/Chưa có chính sách nào áp dụng cho loại giao dịch này/)).toBeTruthy();
    expect(within(tai).queryByRole("table")).toBeNull();
    const moi = document.querySelector('[data-loai-gd="NEW"]') as HTMLElement;
    expect(moi.hasAttribute("data-loai-trong")).toBe(false);
    expect(within(moi).getAllByRole("table")).toHaveLength(2);
  });

  it("người nhận bị thiếu (SOURCE_OWNER chưa khai) ⇒ nêu ra, không giấu", () => {
    const c = chinhSachMau();
    c.theoLoai[0]!.nguon = nhom([dongVai("SOURCE_OWNER", "Người phụ trách nguồn", true, "1", true)], "1");
    render(<MucChinhSach chinhSach={ok(c)} hoaHong={ok(null)} engineBat coQuyenSuaTran lienKet={noLink} />);
    expect(screen.getAllByText(/CHƯA khai/).length).toBeGreaterThan(0);
  });

  it("cờ «tham gia hoa hồng theo nguồn» TẮT ⇒ nói Không + liệt kê phiên bản bị bỏ qua kèm LÝ DO", () => {
    render(
      <MucChinhSach
        chinhSach={ok(
          chinhSachMau({
            bat: false,
            phienBan: [{ policyCode: "ZALO_RIENG", tenChinhSach: "Zalo riêng", versionNo: 1, status: "ACTIVE", hieuLucTu: "2026-10-01T00:00:00.000Z", hieuLucDen: null, soRule: 2, biBoQua: true, lyDoBoQua: "Nguồn này chưa bật «tham gia hoa hồng theo nguồn»." }],
          }),
        )}
        hoaHong={ok(null)}
        engineBat
        coQuyenSuaTran
        lienKet={noLink}
      />,
    );
    expect(screen.getByText("Hoa hồng theo nguồn").nextElementSibling!.textContent).toMatch(/^Không/);
    const pb = document.querySelector('[data-phien-ban="ZALO_RIENG-1"]') as HTMLElement;
    expect(pb.textContent).toMatch(/Không chạy: Nguồn này chưa bật/);
    expect(pb.textContent).toMatch(/Đang hiệu lực/); // nhãn trạng thái tiếng Việt, không mã ACTIVE
  });

  it("bản NHÁP ghi rõ chưa chạy; chưa có chính sách riêng ⇒ rỗng nói dùng chính sách chung", () => {
    const { unmount } = render(
      <MucChinhSach
        chinhSach={ok(chinhSachMau({ phienBan: [{ policyCode: "NHAP", tenChinhSach: "Bản nháp", versionNo: 1, status: "DRAFT", hieuLucTu: "2026-10-01T00:00:00.000Z", hieuLucDen: null, soRule: 1, biBoQua: false, lyDoBoQua: null }] }))}
        hoaHong={ok(null)}
        engineBat
        coQuyenSuaTran
        lienKet={noLink}
      />,
    );
    expect(screen.getByText(/Bản nháp — chưa chạy/)).toBeTruthy();
    unmount();
    render(<MucChinhSach chinhSach={ok(chinhSachMau())} hoaHong={ok(null)} engineBat coQuyenSuaTran lienKet={noLink} />);
    expect(screen.getByText(/chưa có chính sách riêng — giao dịch của nó dùng chính sách chung/)).toBeTruthy();
  });

  it("engine TẮT ⇒ có dòng nói chính sách chưa được dùng để tính; engine BẬT ⇒ không có dòng đó (đối chứng dương)", () => {
    const { unmount } = render(<MucChinhSach chinhSach={ok(chinhSachMau())} hoaHong={ok(null)} engineBat={false} coQuyenSuaTran lienKet={noLink} />);
    expect(document.querySelector('[data-trang-thai="engine-tat"]')).not.toBeNull();
    unmount();
    render(<MucChinhSach chinhSach={ok(chinhSachMau())} hoaHong={ok(null)} engineBat coQuyenSuaTran lienKet={noLink} />);
    expect(document.querySelector('[data-trang-thai="engine-tat"]')).toBeNull();
  });

  it("trần KHÔNG ĐỌC ĐƯỢC ⇒ «không đọc được trần», KHÔNG bao giờ «trong trần»", () => {
    render(<MucChinhSach chinhSach={ok(chinhSachMau({ tran: null, vuot: null }))} hoaHong={ok(null)} engineBat coQuyenSuaTran lienKet={noLink} />);
    expect(screen.getAllByText(/không đọc được trần/).length).toBe(2); // NEW + RENEWAL
    expect(screen.queryByText(/trong trần/)).toBeNull();
    expect(screen.queryByText(/VƯỢT/)).toBeNull();
  });

  it("trong trần ⇒ nói trong trần (đối chứng dương); VƯỢT trần ⇒ role=alert + chênh lệch + liên kết đúng tới Cấu hình vận hành", () => {
    const { unmount } = render(<MucChinhSach chinhSach={ok(chinhSachMau({ tong: "9", tran: "9", vuot: false }))} hoaHong={ok(null)} engineBat coQuyenSuaTran lienKet={noLink} />);
    expect(screen.getAllByText(/trong trần/).length).toBe(2);
    expect(screen.queryByRole("alert")).toBeNull();
    unmount();
    render(<MucChinhSach chinhSach={ok(chinhSachMau({ tong: "11", tran: "9", vuot: true }))} hoaHong={ok(null)} engineBat coQuyenSuaTran lienKet={noLink} />);
    const canhBao = screen.getAllByRole("alert")[0]!;
    expect(canhBao.textContent).toMatch(/VƯỢT trần/);
    expect(canhBao.textContent).toMatch(/Hệ thống không tự nâng trần/);
    const lk = within(canhBao).getByRole("link", { name: /Nâng trần tại Cấu hình vận hành/ });
    expect(lk.getAttribute("href")).toBe("/cau-hinh-van-hanh?tab=khach-hang");
    expect(lk.className).toContain("min-h-11"); // 375px: liên kết duy nhất của cảnh báo phải có vùng chạm ≥44px (W4, cùng KhoiVuotTran)
  });

  it("[W4-01] VƯỢT trần mà người xem KHÔNG có settings:edit ⇒ KHÔNG liên kết tới Cấu hình vận hành, nói ai nâng được (đối chứng dương ở ca trên)", () => {
    render(<MucChinhSach chinhSach={ok(chinhSachMau({ tong: "11", tran: "9", vuot: true }))} hoaHong={ok(null)} engineBat coQuyenSuaTran={false} lienKet={noLink} />);
    const canhBao = screen.getAllByRole("alert")[0]!;
    expect(canhBao.textContent).toMatch(/VƯỢT trần/);
    expect(within(canhBao).queryByRole("link")).toBeNull();
    expect(canhBao.textContent).toMatch(/Nhờ Quản trị hệ thống nâng/);
    expect(canhBao.textContent).toMatch(/Hệ thống không tự nâng trần/);
  });

  it("mục lỗi/không quyền ⇒ chỉ phần chính sách báo; phần «Đã ghi sổ» vẫn tự nói", () => {
    render(<MucChinhSach chinhSach={LOI} hoaHong={ok(null)} engineBat coQuyenSuaTran lienKet={noLink} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Bạn không có quyền xem hoa hồng/)).toBeTruthy();
  });
});

describe("[CTN-UI-05] tiền đã ghi sổ", () => {
  const tien = (p: Partial<HoaHongCuaNguon> = {}): HoaHongCuaNguon => ({
    nguon: { soDong: 1, tong: 200_000 },
    khac: { soDong: 2, tong: 600_000 },
    tong: { soDong: 3, tong: 800_000 },
    phamVi: "TAT_CA",
    ...p,
  });
  it("null (không quyền xem hoa hồng) ⇒ KHÔNG một con số tiền nào, KHÔNG «0đ»", () => {
    render(<MucChinhSach chinhSach={ok(chinhSachMau())} hoaHong={ok(null)} engineBat coQuyenSuaTran lienKet={noLink} />);
    const khung = screen.getByRole("heading", { name: "Đã ghi sổ" }).parentElement!;
    expect(khung.textContent).toMatch(/không có quyền xem hoa hồng/);
    expect(khung.textContent).not.toMatch(/\d\s?đ|0đ/);
  });
  it("có số ⇒ hai nhóm tách + nói rõ PHẠM VI; phạm vi hẹp thì ghi hẹp", () => {
    const { unmount } = render(<MucChinhSach chinhSach={ok(chinhSachMau())} hoaHong={ok(tien())} engineBat coQuyenSuaTran lienKet={noLink} />);
    const khung = screen.getByRole("heading", { name: "Đã ghi sổ" }).parentElement!;
    expect(within(khung).getByText("Hoa hồng nguồn").nextElementSibling!.textContent).toBe("200.000đ · 1 dòng");
    expect(within(khung).getByText("Hoa hồng giao dịch khác").nextElementSibling!.textContent).toBe("600.000đ · 2 dòng");
    expect(khung.textContent).toMatch(/Phạm vi số liệu: toàn hệ thống/);
    unmount();
    render(<MucChinhSach chinhSach={ok(chinhSachMau())} hoaHong={ok(tien({ phamVi: "CHI_CUA_TOI" }))} engineBat coQuyenSuaTran lienKet={noLink} />);
    expect(screen.getByText(/Phạm vi số liệu: chỉ phần của bạn/)).toBeTruthy();
  });
  it("quyền có nhưng chưa có dòng nào ⇒ nói chưa có (kèm phạm vi), không in 0đ", () => {
    render(<MucChinhSach chinhSach={ok(chinhSachMau())} hoaHong={ok(tien({ nguon: { soDong: 0, tong: 0 }, khac: { soDong: 0, tong: 0 }, tong: { soDong: 0, tong: 0 }, phamVi: "CO_SO_VA_CUA_TOI" }))} engineBat coQuyenSuaTran lienKet={noLink} />);
    expect(screen.getByText(/Chưa có khoản hoa hồng nào của nguồn này trong phạm vi bạn xem \(các cơ sở bạn quản lý/)).toBeTruthy();
  });
});

describe("[CTN-UI-06] liên kết «Tạo chính sách cho nguồn này» (luật 12)", () => {
  it("LIEN_KET ⇒ vẽ đúng href; LY_DO ⇒ chữ lý do KHÔNG phải liên kết; AN ⇒ không gì", () => {
    const { unmount } = render(<MucChinhSach chinhSach={ok(chinhSachMau())} hoaHong={ok(null)} engineBat coQuyenSuaTran lienKet={{ loai: "LIEN_KET", href: "/nguon-hoa-hong/chinh-sach/moi?nguon=ZALO_OA" }} />);
    expect(screen.getByRole("link", { name: "Tạo chính sách cho nguồn này" }).getAttribute("href")).toBe("/nguon-hoa-hong/chinh-sach/moi?nguon=ZALO_OA");
    unmount();
    const r2 = render(<MucChinhSach chinhSach={ok(chinhSachMau())} hoaHong={ok(null)} engineBat coQuyenSuaTran lienKet={{ loai: "LY_DO", lyDo: "Tạo chính sách cần quyền commission_policies:manage." }} />);
    expect(screen.queryByRole("link", { name: /Tạo chính sách/ })).toBeNull();
    expect(screen.getByText(/Chưa tạo chính sách cho nguồn này được/)).toBeTruthy();
    expect(screen.getByText(/commission_policies:manage/)).toBeTruthy();
    r2.unmount();
    render(<MucChinhSach chinhSach={ok(chinhSachMau())} hoaHong={ok(null)} engineBat coQuyenSuaTran lienKet={noLink} />);
    expect(document.querySelector("[data-lien-ket]")).toBeNull();
  });
});

describe("[CTN-UI-07] Lịch sử", () => {
  const dong = (i: number): MucLichSuNguon => ({ id: `l${i}`, luc: `2026-10-0${(i % 9) + 1}T03:00:00.000Z`, hanhDong: "NGUON_SUA", nguoi: "Quản trị A", lyDo: `Lý do số ${i} dài đủ`, truongDoi: ["name"], cu: { name: "A" }, moi: { name: "B" } });
  const props = { dangXemTatCa: false, hrefXemTatCa: "/x?lichSu=tat-ca#muc-lich-su", hrefThuGon: "/x#muc-lich-su" };

  it("rỗng ⇒ nói thật; lỗi ⇒ alert", () => {
    const { unmount } = render(<MucLichSu lichSu={ok({ muc: [], biCat: false })} {...props} />);
    expect(screen.getByText(/Chưa có thay đổi nào được ghi lại/)).toBeTruthy();
    unmount();
    render(<MucLichSu lichSu={LOI} {...props} />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("bị cắt ở mặc định ⇒ liên kết «Xem tối đa 200»; đã xem hết ⇒ nói ĐỦ và không có liên kết", () => {
    const { unmount } = render(<MucLichSu lichSu={ok({ muc: [dong(1), dong(2)], biCat: true })} {...props} />);
    expect(screen.getByRole("link", { name: /Xem tối đa 200 thay đổi/ }).getAttribute("href")).toBe("/x?lichSu=tat-ca#muc-lich-su");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    unmount();
    render(<MucLichSu lichSu={ok({ muc: [dong(1), dong(2)], biCat: false })} {...props} />);
    expect(screen.queryByRole("link", { name: /Xem tối đa/ })).toBeNull();
    expect(screen.getByText(/Hiển thị đủ 2 thay đổi/)).toBeTruthy();
  });

  it("chạm trần ở chế độ xem tất cả ⇒ nói «có thể còn» + có «Thu gọn»; KHÔNG khẳng định đủ", () => {
    render(<MucLichSu lichSu={ok({ muc: [dong(1)], biCat: true })} {...props} dangXemTatCa />);
    expect(screen.getByText(/có thể còn những thay đổi cũ hơn/)).toBeTruthy();
    expect(screen.queryByText(/Hiển thị đủ/)).toBeNull();
    expect(screen.getByRole("link", { name: "Thu gọn" }).getAttribute("href")).toBe("/x#muc-lich-su");
  });

  it("mục nhật ký có tiêu đề VN + lý do + cặp đổi; mã hành động thô không lọt ra", () => {
    render(<MucLichSu lichSu={ok({ muc: [dong(1)], biCat: false })} {...props} />);
    expect(screen.getByText("Sửa nguồn")).toBeTruthy();
    expect(screen.getByText(/Lý do: Lý do số 1/)).toBeTruthy();
    expect(screen.queryByText("NGUON_SUA")).toBeNull();
  });
});

describe("[CTN-UI-08] Tracking + Thống kê", () => {
  it("Tracking: Page đã gán + đường vào; rỗng nói thật", () => {
    const { unmount } = render(<MucTracking chiTiet={ok(chiTietMau())} />);
    expect(screen.getByText("page-1")).toBeTruthy();
    expect(screen.getByText(/chiến dịch THANG10/)).toBeTruthy();
    unmount();
    const c = chiTietMau({ theoDuongVao: [] });
    c.pageDaMap = [];
    render(<MucTracking chiTiet={ok(c)} />);
    expect(screen.getByText(/Chưa có Page nào được gán về nguồn này/)).toBeTruthy();
    expect(screen.getByText(/Chưa có lead nào mang nguồn này/)).toBeTruthy();
  });
  it("Thống kê: số THẬT; tổng 0 ⇒ trạng thái rỗng thay vì ba bảng toàn 0", () => {
    const { unmount } = render(<MucThongKe chiTiet={ok(chiTietMau())} />);
    expect(screen.getByText("7 ngày qua").nextElementSibling!.textContent).toBe("2");
    expect(screen.getByText("Tổng").nextElementSibling!.textContent).toBe("12");
    unmount();
    render(<MucThongKe chiTiet={ok(chiTietMau({ tong: 0, ba30: 0, bay7: 0, theoTrangThaiLead: [] }))} />);
    expect(screen.getByText(/Chưa có lead nào mang nguồn này trong phạm vi bạn xem/)).toBeTruthy();
    expect(screen.queryByText("7 ngày qua")).toBeNull();
  });
});
