// @vitest-environment jsdom
/**
 * Bảng chọn loại thông báo được đẩy Web Push.
 *
 * ── BỘ NÀY CANH GÌ ───────────────────────────────────────────────────────────────────────
 * Không canh "có render ra chữ không" — canh bốn lời hứa mà màn hình này đưa ra, và cả bốn
 * đều là loại hứa suông được (luật 12: affordance nói dối không ném lỗi, không làm đỏ test,
 * console vẫn sạch — chỉ người dùng bấm mới biết):
 *
 *  1. Danh sách bày ra là danh sách CÓ THẬT, dựng từ catalog chứ không chép tay.
 *  2. Công tắc phản ánh đúng trạng thái đang lưu, và lưu đúng thứ người ta vừa chọn.
 *  3. Chỉ-được-xem thì công tắc phải KHOÁ, không chỉ giấu nút Lưu.
 *  4. Kênh chưa chạy (công tắc tổng tắt / khoá VAPID hỏng) thì phải nói ngay, không để người
 *     ta bấm xong rồi ngồi chờ một thông báo không bao giờ tới.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  // Khai KIỂU THAM SỐ ở đây chứ không để `vi.fn()` trần: không có nó thì `mock.calls[0]`
  // mang kiểu tuple rỗng, và mọi phép khẳng định về đối số phải ép kiểu — tức là tự bịt
  // mắt đúng chỗ cần nhìn nhất.
  luu: vi.fn(async (_input: { tienTo: string[]; reason: string }) => ({ ok: true })),
}));
vi.mock("../actions", () => ({ luuLoaiDuocDayAction: h.luu }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { catalogEntries } from "@/lib/notifications/catalog";
import { PENDING_SYNC_TYPES } from "@/lib/notifications/pending-sync";
import { ChonLoaiThongBao } from "./chon-loai-thong-bao";

const DANH_MUC = catalogEntries();

function dung(
  x: {
    dangBat?: string[];
    choSua?: boolean;
    canhBao?: { cau: string; choSua: string }[];
  } = {},
) {
  return render(
    <ChonLoaiThongBao
      danhMuc={DANH_MUC}
      dangBat={x.dangBat ?? ["lead.moi:"]}
      choSua={x.choSua ?? true}
      canhBao={x.canhBao ?? []}
    />,
  );
}

/** Công tắc của một loại, tìm theo nhãn tiếp cận (đúng thứ người dùng bằng bàn phím nghe thấy). */
function congTac(label: string): HTMLElement {
  return screen.getByRole("switch", { name: new RegExp(`Đẩy Web Push cho: ${label}`) });
}

const NHAN_LEAD_MOI = DANH_MUC.find((e) => e.prefix === "lead.moi:")!.label;
const NHAN_SLA = DANH_MUC.find((e) => e.prefix === "sla:")!.label;

beforeEach(() => {
  h.luu.mockClear().mockResolvedValue({ ok: true });
});

describe("[PUSH-D7-T23] bảng bày đúng danh mục thật", () => {
  it("mỗi loại ĐẨY ĐƯỢC có đúng MỘT công tắc", () => {
    dung();
    expect(screen.getAllByRole("switch")).toHaveLength(DANH_MUC.length);
    expect(DANH_MUC.length).toBeGreaterThan(25); // guard cho chính phép đếm trên
  });

  it("⚠️ KHÔNG bày loại sinh từ vòng quét việc tồn — chúng không bao giờ đẩy được", () => {
    // `lib/staff-notifications.ts` ghi thẳng `db.staffNotification.upsert`, không đi qua
    // `notifyStaff` — mà đó là điểm móc DUY NHẤT của Web Push. Ranh giới ấy là cố ý (xem khối
    // chú thích ở `lib/notifications/notify.ts`: cửa dưới dành cho cron quét ~1.800 vi phạm
    // mỗi lượt và đi cửa đó CHÍNH VÌ không muốn rung máy).
    //
    // Bày chúng ra là mời người ta bật một công tắc không nối vào đâu. Chủ dự án đã bật thật
    // hai trong số đó (`class_no_teacher:`, `timesheet_adjust:`) ngày 13/09 rồi ngồi chờ.
    const co = new Set(DANH_MUC.map((e) => e.prefix));
    for (const t of PENDING_SYNC_TYPES) {
      expect(co.has(`${t}:`), `${t}: không được bày ra bảng đẩy`).toBe(false);
    }
    expect(co.has("class_no_teacher:")).toBe(false);
    expect(co.has("timesheet_adjust:")).toBe(false);
  });

  it("VẪN bày loại sinh từ sự kiện có cùng họ tên", () => {
    // Cặp đôi với ca trên — không có nó thì một bản vá "lọc thừa tay" (vd lọc mọi khoá chứa
    // \"parent_request\") vẫn xanh, trong khi đã cắt nhầm loại đẩy được.
    const co = new Set(DANH_MUC.map((e) => e.prefix));
    expect(co.has("parent_request.created:")).toBe(true);
    expect(co.has("lead.moi:")).toBe(true);
    expect(co.has("trial-session.assigned:")).toBe(true);
  });

  it("ba loại sửa/dời/huỷ buổi trải nghiệm đã có mặt", () => {
    // Đúng ba thao tác chủ dự án thử ngày 13/09 mà không bật được vì chưa có trong danh mục.
    const co = new Set(DANH_MUC.map((e) => e.prefix));
    for (const t of [
      "trial-session.updated:",
      "trial-session.moved-out:",
      "trial-session.cancelled:",
    ]) {
      expect(co.has(t), t).toBe(true);
    }
  });

  it("mã kỹ thuật TẮT SẴN — 51 dòng mã là 51 dòng nhiễu với người vận hành", () => {
    // Chủ dự án chốt 13/09: người dùng trang này không đọc được `lead.moi:`, nên nó không được
    // chiếm chỗ mặc định.
    dung();
    expect(screen.queryByText("lead.moi:")).toBeNull();
  });

  it("bật công tắc mã kỹ thuật ⇒ hiện đủ mã của mọi loại", () => {
    // Giấu đi KHÔNG được thành xoá mất: khi có người báo "tôi không nhận được thông báo X" thì
    // chuỗi này là thứ duy nhất tra được trong sổ gửi (`WebPushOutbox.dedupeKey`).
    dung();
    fireEvent.click(screen.getByLabelText(/Hiện mã kỹ thuật/));
    expect(screen.getByText("lead.moi:")).toBeTruthy();
    expect(screen.getByText("sla:")).toBeTruthy();
  });
});

describe("[PUSH-D7-T24] công tắc nói đúng trạng thái đang lưu", () => {
  it("loại đang bật ⇒ bật; loại không ⇒ tắt", () => {
    dung({ dangBat: ["lead.moi:"] });
    expect(congTac(NHAN_LEAD_MOI).getAttribute("aria-checked")).toBe("true");
    expect(congTac(NHAN_SLA).getAttribute("aria-checked")).toBe("false");
  });

  it("danh sách lưu RỖNG ⇒ mọi công tắc tắt và nói thẳng 'không loại nào được đẩy'", () => {
    // Rỗng phải trông khác hẳn "chưa cấu hình". Nếu màn hình im lặng thì người dùng đọc thành
    // "mặc định chắc là bật hết" — đúng hiểu nhầm mà cả module này sinh ra để tránh.
    dung({ dangBat: [] });
    expect(screen.getAllByRole("switch").every((s) => s.getAttribute("aria-checked") === "false")).toBe(
      true,
    );
    expect(screen.getByText(/Không loại nào được đẩy/)).toBeTruthy();
  });
});

describe("[PUSH-D7-T25] lưu đúng thứ vừa chọn", () => {
  it("chưa đổi gì ⇒ CHƯA có khung lưu", () => {
    // Đổi hợp đồng có chủ đích 13/09: khung lưu từng ghim ở đáy màn vĩnh viễn — ba dòng giao
    // diện che nội dung suốt lúc người ta chỉ đang đọc, kèm một nút mờ sẵn là lời hứa suông
    // thường trực. Nay nó hiện đúng lúc có việc để lưu.
    dung();
    expect(screen.queryByRole("button", { name: /^Lưu/ })).toBeNull();
    expect(screen.queryByLabelText(/Lý do thay đổi/)).toBeNull();
  });

  it("bật thêm một loại ⇒ khung lưu hiện ra, và lưu gửi CẢ danh sách mới", () => {
    dung({ dangBat: ["lead.moi:"] });
    fireEvent.click(congTac(NHAN_SLA));

    const nut = screen.getByRole("button", { name: /^Lưu/ });

    fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), { target: { value: "BGĐ duyệt" } });
    fireEvent.click(nut);

    expect(h.luu).toHaveBeenCalledTimes(1);
    const g = h.luu.mock.calls[0]![0];
    expect([...g.tienTo].sort()).toEqual(["lead.moi:", "sla:"]);
    expect(g.reason).toBe("BGĐ duyệt");
  });

  it("bật rồi tắt lại đúng mục đó ⇒ coi như KHÔNG đổi, khung lưu biến mất", () => {
    // So theo NỘI DUNG chứ không theo "đã từng chạm". Nếu chỉ đếm số lần bấm thì người dùng
    // thử rồi hoàn tác vẫn bị đòi nhập lý do cho một thay đổi không tồn tại.
    dung({ dangBat: ["lead.moi:"] });
    fireEvent.click(congTac(NHAN_SLA));
    expect(screen.getByRole("button", { name: /^Lưu/ })).toBeTruthy();
    fireEvent.click(congTac(NHAN_SLA));
    expect(screen.queryByRole("button", { name: /^Lưu/ })).toBeNull();
  });

  it("thiếu lý do ⇒ KHÔNG gọi action", async () => {
    // Lý do là bắt buộc ở tầng `setGlobalSetting`. Chặn sớm ở đây để người dùng thấy lỗi ngay
    // thay vì đi một vòng máy chủ rồi nhận một thông báo lỗi chung chung.
    dung({ dangBat: [] });
    fireEvent.click(congTac(NHAN_SLA));
    fireEvent.click(screen.getByRole("button", { name: /^Lưu/ }));
    expect(h.luu).not.toHaveBeenCalled();
  });

  it("bỏ chọn HẾT vẫn lưu được — 'tắt hết' là một lựa chọn, không phải lỗi", () => {
    dung({ dangBat: ["lead.moi:"] });
    fireEvent.click(congTac(NHAN_LEAD_MOI));
    fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), { target: { value: "tạm dừng kênh" } });
    fireEvent.click(screen.getByRole("button", { name: /^Lưu/ }));
    expect(h.luu.mock.calls[0]![0].tienTo).toEqual([]);
  });
});

describe("[PUSH-D7-T26] chỉ-được-xem thì KHOÁ công tắc, không chỉ giấu nút", () => {
  it("choSua = false ⇒ mọi công tắc disabled và không có nút Lưu", () => {
    // Giấu nút mà để công tắc bấm được là affordance nói dối: người xem bấm, thấy nó nhúc
    // nhích, tưởng đã đổi được cấu hình — rồi tải lại trang thì mọi thứ như cũ.
    dung({ choSua: false });
    expect(screen.getAllByRole("switch").every((s) => s.hasAttribute("disabled"))).toBe(true);
    expect(screen.queryByRole("button", { name: /^Lưu/ })).toBeNull();
  });
});

describe("[PUSH-D7-T27] cảnh báo kênh chưa chạy", () => {
  it("có cảnh báo ⇒ hiện, kèm chỗ đi sửa", () => {
    dung({
      canhBao: [
        { cau: "Công tắc tổng Web Push đang TẮT", choSua: "Bật ở Cấu hình vận hành." },
        { cau: "Khoá VAPID chưa dùng được", choSua: "Sửa biến môi trường rồi deploy lại." },
      ],
    });
    expect(screen.getByText(/Công tắc tổng Web Push đang TẮT/)).toBeTruthy();
    expect(screen.getByText(/Bật ở Cấu hình vận hành/)).toBeTruthy();
    expect(screen.getByText(/Sửa biến môi trường rồi deploy lại/)).toBeTruthy();
  });

  it("không cảnh báo ⇒ KHÔNG bịa ra dòng nào", () => {
    dung({ canhBao: [] });
    expect(screen.queryByText(/chưa ai nhận được/)).toBeNull();
  });

  it("cảnh báo KHÔNG chặn thao tác — vẫn chọn và lưu trước được", () => {
    // Chuẩn bị cấu hình trước rồi mới bật công tắc tổng là trình tự đúng, không phải sai sót.
    dung({
      dangBat: [],
      canhBao: [{ cau: "Công tắc tổng Web Push đang TẮT", choSua: "Bật ở Cấu hình vận hành." }],
    });
    fireEvent.click(congTac(NHAN_SLA));
    fireEvent.change(screen.getByLabelText(/Lý do thay đổi/), { target: { value: "chuẩn bị" } });
    fireEvent.click(screen.getByRole("button", { name: /^Lưu/ }));
    expect(h.luu).toHaveBeenCalledTimes(1);
  });
});

describe("[PUSH-D7-T28] đếm theo nhóm phải khớp với công tắc trong chính nhóm đó", () => {
  it("tiêu đề nhóm in đúng 'k/n bật'", () => {
    // Con số này là thứ người ta liếc để biết tình hình mà không đọc 51 dòng. Suy ra từ một
    // nguồn khác với công tắc là đúng công thức đẻ ra lệch — nên ca này so hai bên với nhau.
    dung({ dangBat: ["lead.moi:"] });
    for (const nhom of new Set(DANH_MUC.map((e) => e.groupLabel))) {
      const tieuDe = screen.getByRole("heading", { name: new RegExp(`^${nhom}`) });
      const khoi = tieuDe.parentElement!;
      const batThat = within(khoi)
        .getAllByRole("switch")
        .filter((s) => s.getAttribute("aria-checked") === "true").length;
      expect(tieuDe.textContent, nhom).toContain(`${batThat}/`);
    }
  });
});
