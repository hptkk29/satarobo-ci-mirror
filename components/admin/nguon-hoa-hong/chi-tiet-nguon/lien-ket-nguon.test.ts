// @vitest-environment node
/**
 * [CTN-LK-*] Liên kết ra khỏi trang chi tiết nguồn — việc nào được VẼ (luật 12). Thuần.
 *
 *   [CTN-LK-01] ma trận «Tạo chính sách cho nguồn này»: ĐỐI CHỨNG DƯƠNG (đủ điều kiện ⇒ LIEN_KET đúng href) + từng điều kiện thiếu ⇒ đúng một kết cục
 *   [CTN-LK-02] href: mã được mã hoá; tham số trùng với những gì trang đích đọc
 *   [CTN-LK-03] «Sửa nguồn» dẫn tới ĐÚNG trang sửa có thật (đọc cây `app/`): không query, không trỏ về chính trang chi tiết — lỗi gộp 09/10: hai agent dựng song song, một bên dựng biểu mẫu ở
 *               `/sua`, bên kia trỏ `?sua=1` mà không ai đọc; ca cũ ghim đúng URL sai nên vẫn xanh
 *   [CTN-LK-04] nút «Đổi trạng thái» của trang chi tiết: dựng từ mục «thông tin» đã đọc được; mục lỗi / thiếu quyền ⇒ KHÔNG nút (không đoán)
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { NguonDeSuaView } from "@/lib/nguon/doc-chi-tiet-nguon";
import { KHOA_SOAN_CHINH_SACH, KHOA_SUA_NGUON, hrefSuaNguon, hrefTaoChinhSachChoNguon, nguonChoNutTrangThai, quyetDinhTaoChinhSach } from "./lien-ket-nguon";

const DU = { tabChinhSachMoDuoc: true, coQuyenSoan: true, trangThai: "ACTIVE", laKhongRo: false, code: "ZALO_OA" } as const;

describe("[CTN-LK-01] «Tạo chính sách cho nguồn này»", () => {
  it("ĐỐI CHỨNG DƯƠNG: đủ điều kiện ⇒ liên kết tới trình soạn với ?nguon=<mã>", () => {
    expect(quyetDinhTaoChinhSach(DU)).toEqual({ loai: "LIEN_KET", href: "/nguon-hoa-hong/chinh-sach/moi?nguon=ZALO_OA" });
  });
  it("tab Chính sách không mở được (cờ engine tắt / thiếu quyền xem) ⇒ ẨN, không lý do (người này không có việc ở đó)", () => {
    expect(quyetDinhTaoChinhSach({ ...DU, tabChinhSachMoDuoc: false })).toEqual({ loai: "AN" });
  });
  it("không đọc được nguồn (trạng thái null) ⇒ ẨN, không đoán", () => {
    expect(quyetDinhTaoChinhSach({ ...DU, trangThai: null })).toEqual({ loai: "AN" });
  });
  it("thiếu commission_policies:manage ⇒ LÝ DO nêu đúng khoá, KHÔNG liên kết", () => {
    const r = quyetDinhTaoChinhSach({ ...DU, coQuyenSoan: false });
    expect(r.loai).toBe("LY_DO");
    expect(r.loai === "LY_DO" && r.lyDo).toContain(KHOA_SOAN_CHINH_SACH);
  });
  it("UNKNOWN ⇒ LÝ DO (không có hoa hồng theo nguồn); nguồn chưa Đang dùng ⇒ LÝ DO bảo kích hoạt trước", () => {
    expect(quyetDinhTaoChinhSach({ ...DU, laKhongRo: true }).loai).toBe("LY_DO");
    for (const t of ["DRAFT", "INACTIVE", "ARCHIVED"]) {
      const r = quyetDinhTaoChinhSach({ ...DU, trangThai: t });
      expect(r.loai, t).toBe("LY_DO");
      expect(r.loai === "LY_DO" && r.lyDo, t).toMatch(/Kích hoạt nguồn/);
    }
  });
});

describe("[CTN-LK-02] href", () => {
  it("mã có ký tự đặc biệt được mã hoá (không phá URL)", () => {
    expect(hrefSuaNguon("A B/C")).toBe("/nguon-hoa-hong/nguon/A%20B%2FC/sua");
    expect(hrefTaoChinhSachChoNguon("A&B")).toBe("/nguon-hoa-hong/chinh-sach/moi?nguon=A%26B");
  });
  it("khoá quyền khai ở đây là khoá thật của hai đích", () => {
    expect(KHOA_SUA_NGUON).toBe("sources:manage");
    expect(KHOA_SOAN_CHINH_SACH).toBe("commission_policies:manage");
  });
});

// ── [CTN-LK-03] đích của «Sửa nguồn» là trang sửa CÓ THẬT ──────────────────────────────────────────────────────────────

const GOC_ADMIN = resolve(process.cwd(), "app/(admin)/admin");
const TRANG_CHI_TIET = join(GOC_ADMIN, "nguon-hoa-hong", "nguon", "[maNguon]", "page.tsx");

/** Đổi một đường dẫn admin thành tệp `page.tsx` mà Next sẽ phục vụ nó: đoạn tĩnh thắng đoạn `[tham-số]`. `null` = không có trang nào. */
function trangCuaDuongDan(href: string): string | null {
  const doan = new URL(href, "http://x").pathname.split("/").filter(Boolean).map(decodeURIComponent);
  let thuMuc = GOC_ADMIN;
  for (const d of doan) {
    const con = readdirSync(thuMuc, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name);
    const chon = con.includes(d) ? d : con.find((n) => /^\[[^\]]+\]$/.test(n));
    if (!chon) return null;
    thuMuc = join(thuMuc, chon);
  }
  const trang = join(thuMuc, "page.tsx");
  return existsSync(trang) ? trang : null;
}

describe("[CTN-LK-03] «Sửa nguồn» dẫn tới trang sửa có thật", () => {
  it("[tự kiểm] bộ phân giải đường dẫn THẤY lỗi cũ: `…/<mã>?sua=1` rơi đúng về chính trang chi tiết (không phải trang sửa)", () => {
    expect(trangCuaDuongDan("/nguon-hoa-hong/nguon/ZALO_OA?sua=1")).toBe(TRANG_CHI_TIET);
    expect(trangCuaDuongDan("/nguon-hoa-hong/nguon/ZALO_OA/khong-co-trang-nay")).toBeNull();
  });

  it("href không mang query; trỏ tới một trang KHÁC trang chi tiết; trang đó là biểu mẫu sửa (đọc docFormSuaNguon)", () => {
    const href = hrefSuaNguon("ZALO_OA");
    expect([...new URL(href, "http://x").searchParams.keys()], "query").toEqual([]);
    const trang = trangCuaDuongDan(href);
    expect(trang, `không có trang nào ở ${href}`).not.toBeNull();
    expect(trang, "đích trùng chính trang chi tiết = nút bấm chỉ tải lại trang").not.toBe(TRANG_CHI_TIET);
    expect(readFileSync(trang!, "utf8")).toContain("docFormSuaNguon(");
  });

  it("đích «Tạo chính sách» cũng là trang có thật", () => {
    expect(trangCuaDuongDan(hrefTaoChinhSachChoNguon("ZALO_OA"))).not.toBeNull();
  });
});

// ── [CTN-LK-04] nút đổi trạng thái ────────────────────────────────────────────────────────────────────────────────────

const nguonView = (p: Partial<NguonDeSuaView> = {}): NguonDeSuaView =>
  ({
    id: "n1",
    code: "ZALO_OA",
    name: "Zalo OA",
    status: "ACTIVE",
    isSystem: false,
    capNhatLuc: "2026-10-09T03:00:00.000Z",
    ownerEmployee: null,
    dinhTien: { chinhSachRieng: false, coDongThuHutRieng: false, ruleChuNguonBatKy: false, ruleChuChay: false },
    ...p,
  }) as NguonDeSuaView;

describe("[CTN-LK-04] nguonChoNutTrangThai", () => {
  it("ĐỐI CHỨNG DƯƠNG: đọc được mục thông tin ⇒ đủ trường mà nút cần (mốc khoá lạc quan = capNhatLuc; chủ + chính sách riêng + rule chủ-nguồn chạy để nút nói thật)", () => {
    expect(nguonChoNutTrangThai({ ok: true, du: nguonView() })).toEqual({
      id: "n1",
      code: "ZALO_OA",
      name: "Zalo OA",
      status: "ACTIVE",
      isSystem: false,
      capNhatLuc: "2026-10-09T03:00:00.000Z",
      ownerEmployeeId: null,
      chinhSachRieng: false,
      ruleChuChay: false,
    });
  });
  it("mang đúng người phụ trách + hai cờ dính tiền từ `dinhTien` (không đoán, không mặc định)", () => {
    const nut = nguonChoNutTrangThai({
      ok: true,
      du: nguonView({ ownerEmployee: { id: "emp-1", ten: "An", maNv: "NV1", coTaiKhoan: true }, dinhTien: { chinhSachRieng: true, coDongThuHutRieng: true, ruleChuNguonBatKy: true, ruleChuChay: true } }),
    });
    expect(nut).toMatchObject({ ownerEmployeeId: "emp-1", chinhSachRieng: true, ruleChuChay: true });
  });
  it("mục lỗi / thiếu quyền ⇒ null (không dựng nút từ dữ liệu không có)", () => {
    expect(nguonChoNutTrangThai({ ok: false, loai: "LOI" })).toBeNull();
    expect(nguonChoNutTrangThai({ ok: false, loai: "QUYEN" })).toBeNull();
  });
});
