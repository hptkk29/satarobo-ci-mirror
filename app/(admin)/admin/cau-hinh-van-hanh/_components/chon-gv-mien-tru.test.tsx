// @vitest-environment jsdom
/**
 * Bảng chọn giáo viên LUÔN HIỆN khi xếp buổi học thử (`trial.gvMienLocTheoCa`).
 *
 * ── BỘ NÀY CANH GÌ ───────────────────────────────────────────────────────────────────────
 * Không canh "có render ra chữ không" — canh những lời hứa mà màn hình này đưa ra, và tất cả
 * đều là loại hứa suông được (luật 12: affordance nói dối không ném lỗi, không làm đỏ test,
 * console vẫn sạch — chỉ người dùng bấm mới biết):
 *
 *  1. Bày ra TÊN người, không phải mã máy — lý do duy nhất màn này tồn tại thay cho ô JSON.
 *  2. Công tắc phản ánh đúng thứ đang lưu, và lưu đúng thứ người ta vừa chọn.
 *  3. Chỉ-được-xem thì công tắc phải KHOÁ, không chỉ giấu nút Lưu.
 *  4. Cờ lọc đang TẮT thì phải nói ngay là chọn gì cũng chưa đổi điều gì.
 *  5. Mã của người đã nghỉ còn kẹt trong cấu hình thì phải NÓI RA, và "bấm Lưu là dọn xong"
 *     phải đúng sự thật chứ không phải một lời hứa suông.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  // Khai KIỂU THAM SỐ ở đây chứ không để `vi.fn()` trần: không có nó thì `mock.calls[0]` mang
  // kiểu tuple rỗng, và mọi phép khẳng định về đối số phải ép kiểu — tức tự bịt mắt đúng chỗ
  // cần nhìn nhất.
  luu: vi.fn(async (_input: { userIds: string[]; reason: string }) => ({ ok: true as const })),
  loi: vi.fn((_x: string) => undefined),
}));
vi.mock("../actions", () => ({ luuGvMienTruAction: h.luu }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: h.loi } }));

import { ChonGvMienTru, nhanGv, type GvChon } from "./chon-gv-mien-tru";

const GIAO_VIEN: GvChon[] = [
  { id: "cmf3k9x0a0001", ten: "Nguyễn Tuấn Kiệt" },
  { id: "cmf3k9x0a0002", ten: "Trần Văn Toại" },
  { id: "cmf3k9x0a0003", ten: "Lê Thị Lan" },
];

function dung(
  x: {
    giaoVien?: GvChon[];
    dangChon?: string[];
    choSua?: boolean;
    locDangBat?: boolean;
  } = {},
) {
  return render(
    <ChonGvMienTru
      giaoVien={x.giaoVien ?? GIAO_VIEN}
      dangChon={x.dangChon ?? []}
      choSua={x.choSua ?? true}
      locDangBat={x.locDangBat ?? true}
    />,
  );
}

/** Công tắc của một người, tìm theo nhãn tiếp cận (đúng thứ người dùng bàn phím nghe thấy). */
function congTac(ten: string): HTMLElement {
  return screen.getByRole("switch", {
    name: new RegExp(`Luôn hiện khi xếp buổi học thử: ${ten}`),
  });
}

beforeEach(() => {
  h.luu.mockClear().mockResolvedValue({ ok: true });
  h.loi.mockClear();
});

describe("[TRIAL-GV-U01] bày TÊN, không bắt gõ mã máy", () => {
  it("mỗi giáo viên một dòng, in đúng tên", () => {
    dung();
    for (const gv of GIAO_VIEN) expect(screen.getByText(gv.ten!)).toBeTruthy();
    expect(screen.getAllByRole("switch")).toHaveLength(GIAO_VIEN.length);
  });

  it("⚠️ mã người dùng KHÔNG hiện ra cho người có tên", () => {
    // Đây là toàn bộ lý do màn này tồn tại thay cho ô nhập JSON của khung chung. Rơi lại về
    // in mã là quay về đúng thứ không ai gõ đúng được.
    dung();
    expect(document.body.textContent).not.toContain("cmf3k9x0a0001");
  });

  it("tài khoản chưa khai tên vẫn chọn được, và phân biệt được với nhau", () => {
    // "Chưa đặt tên" đứng hai dòng liền nhau là hai dòng không phân biệt nổi — nên ca đó (và
    // chỉ ca đó) mới in thêm mẩu mã cuối.
    const khuyet: GvChon[] = [
      { id: "cmf3k9x0aAAAAA", ten: null },
      { id: "cmf3k9x0aBBBBB", ten: "   " },
    ];
    expect(nhanGv(khuyet[0]!)).not.toBe(nhanGv(khuyet[1]!));
    dung({ giaoVien: khuyet });
    expect(screen.getAllByRole("switch")).toHaveLength(2);
  });

  it("chưa có ai mang vai giáo viên ⇒ nói ra, không để trống trơn", () => {
    // Khối trống trơn trông y hệt lỗi tải, và người dùng sẽ tải lại trang mãi.
    dung({ giaoVien: [] });
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.getByText(/Chưa có tài khoản nào mang vai giáo viên/)).toBeTruthy();
  });
});

describe("[TRIAL-GV-U02] công tắc phản ánh và ghi đúng thứ đang lưu", () => {
  it("người đang được miễn thì công tắc BẬT sẵn", () => {
    dung({ dangChon: ["cmf3k9x0a0002"] });
    expect(congTac("Trần Văn Toại").getAttribute("data-state")).toBe("checked");
    expect(congTac("Nguyễn Tuấn Kiệt").getAttribute("data-state")).toBe("unchecked");
  });

  it("gạt thêm một người rồi lưu ⇒ gửi xuống CẢ danh sách, kèm lý do", () => {
    // Ghi cả danh sách chứ không ghi từng người bật/tắt: với API "bật người X" thì hai người
    // cùng mở màn, mỗi người gạt một công tắc rồi lưu, và cả hai cùng thắng ra một trạng thái
    // chưa ai chọn.
    dung({ dangChon: ["cmf3k9x0a0001"] });
    fireEvent.click(congTac("Trần Văn Toại"));
    fireEvent.change(screen.getByLabelText(/Lý do thay đổi danh sách giáo viên/), {
      target: { value: "Toại phụ trách đào tạo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Lưu 2 người/ }));
    expect(h.luu).toHaveBeenCalledTimes(1);
    expect(h.luu.mock.calls[0]![0].userIds.sort()).toEqual(["cmf3k9x0a0001", "cmf3k9x0a0002"]);
    expect(h.luu.mock.calls[0]![0].reason).toBe("Toại phụ trách đào tạo");
  });

  it("chưa đổi gì thì KHÔNG có khung lưu — nút sáng mà chẳng có gì để lưu là hứa suông", () => {
    dung({ dangChon: ["cmf3k9x0a0001"] });
    expect(screen.queryByRole("button", { name: /Lưu/ })).toBeNull();
  });

  it("bật rồi tắt lại đúng người đó ⇒ khung lưu biến mất (so theo NỘI DUNG)", () => {
    dung({ dangChon: [] });
    fireEvent.click(congTac("Lê Thị Lan"));
    expect(screen.getByRole("button", { name: /Lưu/ })).toBeTruthy();
    fireEvent.click(congTac("Lê Thị Lan"));
    expect(screen.queryByRole("button", { name: /Lưu/ })).toBeNull();
  });

  it("thiếu lý do ⇒ báo lỗi tại chỗ, KHÔNG gọi đường ghi", () => {
    dung();
    fireEvent.click(congTac("Lê Thị Lan"));
    fireEvent.click(screen.getByRole("button", { name: /Lưu/ }));
    expect(h.luu).not.toHaveBeenCalled();
    expect(h.loi).toHaveBeenCalled();
  });
});

describe("[TRIAL-GV-U03] chỉ-được-xem thì KHOÁ công tắc, không chỉ giấu nút Lưu", () => {
  it("công tắc bị khoá", () => {
    // Giấu nút mà để công tắc gạt được là màn hình hứa "bạn sửa được" rồi không lưu gì cả.
    dung({ choSua: false });
    for (const gv of GIAO_VIEN) {
      expect(congTac(gv.ten!).hasAttribute("disabled")).toBe(true);
    }
  });

  it("không có khung lưu", () => {
    dung({ choSua: false, dangChon: ["cmf3k9x0a0001"] });
    expect(screen.queryByRole("button", { name: /Lưu/ })).toBeNull();
  });
});

describe("[TRIAL-GV-U04] nói thật về hai thứ nằm NGOÀI bảng này", () => {
  it("cờ lọc đang TẮT ⇒ nói ngay là chọn gì cũng chưa đổi điều gì", () => {
    dung({ locDangBat: false });
    expect(screen.getByText(/Việc lọc giáo viên theo ca đang TẮT/)).toBeTruthy();
  });

  it("cờ lọc đang BẬT ⇒ không có dòng cảnh báo thừa", () => {
    dung({ locDangBat: true });
    expect(screen.queryByText(/Việc lọc giáo viên theo ca đang TẮT/)).toBeNull();
  });

  it("lưu xong chưa ăn ngay ở mọi máy — con số 5 phút phải nằm trên màn", () => {
    dung();
    fireEvent.click(congTac("Lê Thị Lan"));
    expect(screen.getByText(/5 phút/)).toBeTruthy();
  });
});

describe("[TRIAL-GV-U05] mã của người đã nghỉ còn kẹt trong cấu hình", () => {
  const CO_MAC_KET = { dangChon: ["cmf3k9x0a0001", "u_da_nghi"] };

  it("nói ra số người mắc kẹt thay vì dọn lén", () => {
    dung(CO_MAC_KET);
    expect(screen.getByText(/không còn là giáo viên/)).toBeTruthy();
  });

  it('⚠️ "bấm Lưu là dọn xong" phải ĐÚNG: khung lưu hiện sẵn dù chưa gạt công tắc nào', () => {
    // Nếu `coDoi` chỉ so công tắc thì khung lưu không hiện, người dùng đọc dòng nhắc rồi đi
    // tìm nút Lưu không tồn tại — đúng kiểu lời hứa suông mà luật 12 nói tới.
    dung(CO_MAC_KET);
    expect(screen.getByRole("button", { name: /Lưu 1 người/ })).toBeTruthy();
  });

  it("và lần lưu đó KHÔNG gửi lại mã đã chết — nếu gửi thì đường ghi từ chối", () => {
    dung(CO_MAC_KET);
    fireEvent.change(screen.getByLabelText(/Lý do thay đổi danh sách giáo viên/), {
      target: { value: "dọn người đã nghỉ" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Lưu 1 người/ }));
    expect(h.luu.mock.calls[0]![0].userIds).toEqual(["cmf3k9x0a0001"]);
  });
});
