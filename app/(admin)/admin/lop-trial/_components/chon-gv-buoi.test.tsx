// @vitest-environment jsdom
/**
 * `hauToGv` — hậu tố in trong `<option>` của ô chọn giáo viên.
 *
 * ── VÌ SAO TỆP NÀY RA ĐỜI (17/09/2026) ───────────────────────────────────────────────
 * Có HAI đường sinh nhãn chạy song song: `nhanChoDong` (tầng thuần, dùng cho khối cảnh
 * báo) và `hauToGv` (dùng cho `<option>`). Bản vá gỡ "CHƯA VÀO LƯỚI CA" chỉ chạm đường
 * thứ nhất, nên sau khi merge + deploy prod thì ô chọn VẪN in nguyên chữ đó — chủ dự án
 * phải báo lại đúng một lỗi đã báo.
 *
 * Bộ này khoá lại luật: `<option>` bám theo `nhan` của tầng thuần, KHÔNG tự suy từ `phu`.
 */
import { describe, expect, it, vi } from "vitest";
import type { DongGv } from "@/lib/trial/gv-kha-dung";
import type { CheDoChonGv } from "../_lib/che-do-gv";

// `chon-gv-buoi.tsx` là client component và nó import `../_actions` (Server Action) —
// kéo theo cả `next-auth`, thứ không nạp được ngoài Next. Mock đúng khuôn của
// `add-session-form.test.tsx` cạnh bên; bộ này chỉ cần MỘT hàm thuần trong tệp đó.
vi.mock("../_actions", () => ({ layGvChoBuoiAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { coCongTacHienTatCa, hauToGv } from "./chon-gv-buoi";

function dong(over: Partial<DongGv>): DongGv {
  return { id: "u1", name: "GV", phu: "PHU_TRON", muc: "KHONG", nhan: "", ...over };
}

describe("hauToGv — ô chọn nói ĐÚNG thứ tầng thuần đã quyết định", () => {
  it("TRÙNG LỊCH luôn hiện — cảnh báo buổi dạy không bao giờ bị tắt", () => {
    expect(hauToGv(dong({ muc: "DO", nhan: "TRÙNG LỊCH: Lớp X 18:00–19:30" }))).toBe(
      " · TRÙNG LỊCH",
    );
  });

  // ⭐ CA KHOÁ của bản vá. Đây ĐÚNG hình dạng đang chạy trên prod khi cờ lọc TẮT:
  // tầng thuần trả `nhan: ""` (không nói gì về ca), nên ô chọn phải im theo.
  it("CHUA_VAO_LUOI + nhan rỗng ⇒ KHÔNG hậu tố (lỗi prod 17/09)", () => {
    expect(hauToGv(dong({ phu: "CHUA_VAO_LUOI", nhan: "" }))).toBe("");
  });

  it("KHONG_GIO + nhan rỗng (chưa bật lọc) ⇒ KHÔNG hậu tố", () => {
    expect(hauToGv(dong({ phu: "KHONG_GIO", nhan: "" }))).toBe("");
  });

  it("KHONG_GIO + nhan CÓ chữ (đang lọc thật) ⇒ có hậu tố", () => {
    expect(hauToGv(dong({ phu: "KHONG_GIO", nhan: "ca không nhận thêm buổi" }))).toBe(
      " · CA LINH ĐỘNG",
    );
  });

  it("mọi trạng thái còn lại: nhan rỗng ⇒ hậu tố rỗng", () => {
    const moi: DongGv["phu"][] = [
      "PHU_TRON",
      "KHONG_PHU",
      "NGHI",
      "KHONG_CO_CA",
      "CHUA_VAO_LUOI",
      "CHUA_CO_LUOI",
    ];
    expect(moi.map((p) => hauToGv(dong({ phu: p, nhan: "" })))).toEqual(["", "", "", "", "", ""]);
  });
});

describe("công tắc \"Hiện tất cả giáo viên\" — Sale KHÔNG có (chốt 18/09/2026)", () => {
  // Luật nằm ở một biểu thức trong component, nên khoá nó bằng chính biểu thức đó viết ra
  // ở đây: tầng nào được thấy công tắc. Ba tầng, ba câu trả lời, đọc một lượt.
  //
  // Vì sao Sale không có: chốt hôm trước là "không có người thì sale báo cho đào tạo hoặc
  // quản lý xếp người của cs khác". Một đường thoát mở cho Sale là một đường để quy trình
  // đó không bao giờ chạy — bấm công tắc nhanh hơn nhắn tin.
  // ⚠️ GỌI HÀM THẬT. Bản đầu chép biểu thức vào đây; cấy lỗi vào component ra 0 ĐỎ — test
  // kiểm bản sao của chính nó. Đo lại sau khi export: cấy lỗi ⇒ ĐỎ.
  const coCongTac = (cheDo: CheDoChonGv, batLoc: boolean) =>
    coCongTacHienTatCa({ cheDo, batLoc });

  it("Sale (LOC_THEO_CA) KHÔNG thấy công tắc, dù cờ lọc đang bật", () => {
    expect(coCongTac("LOC_THEO_CA", true)).toBe(false);
  });

  it("Quản lý cơ sở (THEO_CO_SO) CÓ công tắc — họ là người Sale sẽ nhờ", () => {
    expect(coCongTac("THEO_CO_SO", true)).toBe(true);
  });

  it("Đào tạo (TAT_CA) không có — vốn đã không bị lọc, nút sẽ không làm gì", () => {
    expect(coCongTac("TAT_CA", true)).toBe(false);
  });

  it("cờ lọc TẮT ⇒ không tầng nào có công tắc (không dựng nút vô nghĩa)", () => {
    for (const c of ["LOC_THEO_CA", "THEO_CO_SO", "TAT_CA"] as CheDoChonGv[]) {
      expect(coCongTac(c, false), c).toBe(false);
    }
  });
});
