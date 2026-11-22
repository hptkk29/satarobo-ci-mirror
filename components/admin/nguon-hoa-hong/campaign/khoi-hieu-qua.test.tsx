// @vitest-environment jsdom
/**
 * [AFR-HQ-UI-*] — khối «Hiệu quả» của campaign (AFF-P3 H1) trên phần tử thật. Mọi ca "không thấy X" có đối chứng dương (luật 11).
 *   [AFR-HQ-UI-01] đủ khối: số đúng chỗ, nhãn nói đúng thứ nó đếm; tỉ lệ CHỈ khi cùng phạm vi (TAT_CA) — đối chứng GIOI_HAN không có; chú thích phạm vi đúng loại
 *   [AFR-HQ-UI-02] khối thiếu quyền ⇒ nói «chưa có quyền» (KHÔNG in 0), cột tương ứng của bảng đối tác biến mất; đối chứng: có quyền ⇒ cột có, không câu «chưa có quyền»
 *   [AFR-HQ-UI-03] biểu mẫu ngày: mặc định = khoảng đang dùng, «30 ngày gần nhất» chỉ khi đã chọn khoảng khác; cảnh báo role=status
 *   [AFR-HQ-UI-04] hoa hồng: đủ bốn trạng thái chi + liên kết Sổ chỉ khi có; đối tác bị cắt được NÓI; bảng rỗng có câu riêng
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import type { BaoCaoHieuQua } from "@/lib/affiliate/doc-bao-cao";
import { demRong } from "@/lib/affiliate/ghi-referral-dau-vao";
import { KhoiHieuQua } from "./khoi-hieu-qua";

afterEach(cleanup);

const KHOANG = { tu: "2026-09-14", den: "2026-10-13", tuLuc: new Date("2026-09-13T17:00:00.000Z"), denLuc: new Date("2026-10-13T17:00:00.000Z"), macDinh: true, canhBao: null };

function bc(p: Partial<BaoCaoHieuQua> = {}): BaoCaoHieuQua {
  return {
    khoang: KHOANG,
    luotBam: { tong: 120, hopLe: 100, khongDung: 20, theoLyDo: [{ ma: "LINK_DA_THU_HOI", nhan: "Link đã bị thu hồi.", n: 20 }] },
    referral: { theoTrangThai: { ...demRong(), VALID: 8, MANUAL_REVIEW: 2, REJECTED: 3 }, tong: 13, daDangKy: 4, phamVi: "TAT_CA" },
    hoaHong: {
      theoTrangThai: { ON_HOLD: { soDong: 0, tien: 0 }, PENDING: { soDong: 2, tien: 500_000 }, APPROVED: { soDong: 0, tien: 0 }, EXPORTED: { soDong: 1, tien: 100_000 }, PAID: { soDong: 3, tien: 900_000 } },
      tong: { soDong: 6, tien: 1_500_000 },
      phamVi: "TAT_CA",
    },
    doiTac: {
      dong: [
        { partyId: "p1", ten: "Đối tác Một", ma: "DT1", luotBam: 70, luotBamLoi: 5, referral: { ...demRong(), VALID: 6, MANUAL_REVIEW: 1 }, daDangKy: 3, hoaHong: { soDong: 4, tien: 1_000_000 } },
        { partyId: "p2", ten: "Đối tác Hai", ma: "DT2", luotBam: 30, luotBamLoi: 15, referral: { ...demRong(), VALID: 2, MANUAL_REVIEW: 1 }, daDangKy: 1, hoaHong: { soDong: 2, tien: 500_000 } },
      ],
      biCat: 0,
    },
    ...p,
  };
}
const ve = (b: BaoCaoHieuQua, hrefSo: string | null = "/nguon-hoa-hong/so?xem=tat-ca&camp=C1") => render(<KhoiHieuQua bc={b} action="/nguon-hoa-hong/campaign/C1" hrefSo={hrefSo} />);
const so = (k: string) => document.querySelector(`[data-so="${k}"]`)?.textContent?.trim();

describe("[AFR-HQ-UI-01] phễu", () => {
  it("số đúng chỗ + tỉ lệ khi TAT_CA; chú thích «Mọi cơ sở»", () => {
    ve(bc());
    expect(so("luot-bam")).toBe("120");
    expect(so("referral")).toBe("13");
    expect(so("hop-le")).toBe("8");
    expect(so("da-dang-ky")).toBe("4");
    expect(so("hoa-hong")).toBe("1.500.000đ");
    // 13 referral / 100 lượt bấm hợp lệ = 13% ; 4 / 8 hợp lệ = 50%
    expect(document.body.textContent).toContain("(13%)");
    expect(document.body.textContent).toContain("(50%)");
    expect(document.body.textContent).toContain("so với lượt bấm hợp lệ");
    expect(document.querySelectorAll('[data-pham-vi="tat-ca"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-pham-vi="gioi-han"]')).toHaveLength(0);
    // nhãn nói đúng thứ nó đếm
    expect(Array.from(document.querySelectorAll("dt")).map((d) => d.textContent)).toEqual(["Lượt bấm vào link", "Referral", "Hợp lệ — đã ghi công", "Đã đăng ký", "Hoa hồng đã ghi sổ"]);
    expect(document.body.textContent).toContain("Trong số referral hợp lệ, phiếu khách đã được chốt");
  });

  it("GIOI_HAN (cấp cơ sở) ⇒ KHÔNG tỉ lệ lượt bấm→referral (khác phạm vi) nhưng VẪN có tỉ lệ đã đăng ký/hợp lệ (cùng phạm vi); có dòng «Chỉ phần của cơ sở bạn»", () => {
    ve(bc({ referral: { theoTrangThai: { ...demRong(), VALID: 8 }, tong: 8, daDangKy: 4, phamVi: "GIOI_HAN" } }));
    expect(document.body.textContent).not.toContain("so với lượt bấm hợp lệ");
    expect(document.body.textContent).toContain("(50%)"); // 4/8
    const gh = document.querySelector('[data-pham-vi="gioi-han"]')!;
    expect(gh.textContent).toContain("Chỉ phần của cơ sở bạn");
  });

  it("referral NHIỀU HƠN lượt bấm hợp lệ (biểu mẫu gửi thẳng token, không qua lượt bấm) ⇒ KHÔNG in «200%» — in số thật; đối chứng dương: tử ≤ mẫu thì vẫn in", () => {
    ve(bc({ luotBam: { tong: 1, hopLe: 1, khongDung: 0, theoLyDo: [] }, referral: { theoTrangThai: { ...demRong(), VALID: 1 }, tong: 2, daDangKy: 0, phamVi: "TAT_CA" } }));
    expect(so("referral")).toBe("2");
    expect(document.body.textContent).not.toContain("200%");
    expect(document.body.textContent).not.toContain("so với lượt bấm hợp lệ");
  });

  it("mẫu bằng 0 ⇒ không in tỉ lệ nào (không «0%»)", () => {
    ve(bc({ luotBam: { tong: 0, hopLe: 0, khongDung: 0, theoLyDo: [] }, referral: { theoTrangThai: demRong(), tong: 0, daDangKy: 0, phamVi: "TAT_CA" } }));
    expect(document.body.textContent).not.toMatch(/\(\d+(,\d)?%\)/);
    expect(so("luot-bam")).toBe("0");
  });
});

describe("[AFR-HQ-UI-02] khối thiếu quyền", () => {
  it("thiếu lượt bấm / referral / hoa hồng ⇒ câu «chưa có quyền», không in số 0, cột của bảng đối tác biến mất", () => {
    ve(bc({ luotBam: null, referral: null, hoaHong: null, doiTac: { dong: [{ partyId: "p1", ten: "Đối tác Một", ma: "DT1", luotBam: 0, luotBamLoi: 0, referral: demRong(), daDangKy: 0, hoaHong: null }], biCat: 0 } }));
    const khoi = Array.from(document.querySelectorAll("[data-khong-quyen]"));
    expect(khoi).toHaveLength(3);
    for (const k of khoi) {
      expect(k.textContent, k.getAttribute("data-khong-quyen") ?? "").toMatch(/bạn chưa có quyền xem phần này/);
      expect(k.textContent).not.toMatch(/:\s*0\b/); // không bao giờ in «… : 0» thay cho «không xem được»
    }
    expect(document.querySelector("[data-so]")).toBeNull();
    const cot = Array.from(document.querySelectorAll("th")).map((t) => t.textContent);
    expect(cot).toEqual(["Đối tác"]);
  });

  it("đối chứng dương: có quyền cả ba ⇒ không câu «chưa có quyền», đủ các cột", () => {
    ve(bc());
    expect(document.querySelectorAll("[data-khong-quyen]")).toHaveLength(0);
    expect(Array.from(document.querySelectorAll("th")).map((t) => t.textContent)).toEqual(["Đối tác", "Lượt bấm", "Hợp lệ", "Cần xem tay", "Đã đăng ký", "Hoa hồng đối tác nhận"]);
    const dong = document.querySelector('[data-doi-tac="p1"]')!;
    expect(dong.textContent).toContain("Đối tác Một");
    expect(dong.textContent).toContain("1.000.000đ");
  });
});

describe("[AFR-HQ-UI-03] biểu mẫu ngày", () => {
  it("mặc định: ô mang khoảng đang dùng, KHÔNG có «30 ngày gần nhất»; đã chọn khoảng khác ⇒ có link về mặc định; cảnh báo role=status", () => {
    const { unmount } = ve(bc());
    expect((document.getElementById("hq-tu") as HTMLInputElement).value).toBe("2026-09-14");
    expect((document.getElementById("hq-den") as HTMLInputElement).value).toBe("2026-10-13");
    expect(document.querySelector("form")!.getAttribute("method")).toBe("get");
    expect(document.querySelector("form")!.getAttribute("action")).toBe("/nguon-hoa-hong/campaign/C1#hieu-qua");
    expect(screen.queryByRole("link", { name: "30 ngày gần nhất" })).toBeNull();
    unmount();
    ve(bc({ khoang: { ...KHOANG, tu: "2026-10-01", den: "2026-10-05", macDinh: false, canhBao: "Ngày không hợp lệ — đang hiện 30 ngày gần nhất." } }));
    expect(screen.getByRole("link", { name: "30 ngày gần nhất" }).getAttribute("href")).toBe("/nguon-hoa-hong/campaign/C1#hieu-qua");
    expect(screen.getByRole("status").textContent).toContain("Ngày không hợp lệ");
    expect(document.body.textContent).toContain("Khoảng đã chọn");
  });
});

describe("[AFR-HQ-UI-04] hoa hồng · cắt · rỗng", () => {
  it("đủ năm trạng thái chi (kể cả «đang giữ» của người hưởng tổ chức — AFF-L2); liên kết Sổ chỉ khi có; nói rõ không theo khoảng ngày", () => {
    ve(bc());
    for (const t of ["Đang giữ", "Chưa chi", "Đã duyệt chi", "Đã xuất bảng chi", "Đã chi"]) expect(document.body.textContent).toContain(t);
    expect(screen.getByRole("link", { name: "Mở Sổ đã lọc campaign" }).getAttribute("href")).toBe("/nguon-hoa-hong/so?xem=tat-ca&camp=C1");
    expect(document.body.textContent).toContain("Hoa hồng không theo khoảng ngày");
  });

  it("đối chứng: không có đường vào Sổ ⇒ không vẽ liên kết Sổ", () => {
    ve(bc(), null);
    expect(screen.queryByRole("link", { name: "Mở Sổ đã lọc campaign" })).toBeNull();
  });

  it("đối tác bị cắt ⇒ NÓI «còn N đối tác khác»; bảng rỗng ⇒ câu riêng, không bảng", () => {
    const { unmount } = ve(bc({ doiTac: { ...bc().doiTac, biCat: 7 } }));
    expect(document.querySelector("[data-bi-cat]")!.textContent).toContain("Còn 7 đối tác khác");
    unmount();
    ve(bc({ doiTac: { dong: [], biCat: 0 } }));
    expect(document.querySelector("table")).toBeNull();
    expect(document.body.textContent).toContain("Chưa có hoạt động nào của đối tác trong khoảng này");
    expect(document.querySelector("[data-bi-cat]")).toBeNull();
  });
});
