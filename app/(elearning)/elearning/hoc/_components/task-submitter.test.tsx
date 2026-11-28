/**
 * [TS-UI-*] Màn nộp bài tập — vẽ ĐÚNG theo trạng thái lượt (chờ chấm · trả về · đạt · chưa đạt), không lộ điểm lượt chưa thành kết quả.
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("sonner", () => ({ toast: { error: () => undefined, success: () => undefined } }));
const h = vi.hoisted(() => ({ nhap: vi.fn(), nop: vi.fn() }));
vi.mock("../_actions", () => ({ nopBaiTapAction: h.nop, nhapBaiTapAction: h.nhap }));

import type { NenNopBai } from "@/lib/elearning/task-view";
import { TaskSubmitter } from "./task-submitter";

beforeEach(() => {
  h.nop.mockReset().mockResolvedValue({ ok: true, data: { submissionId: "s1" } });
  h.nhap.mockReset().mockResolvedValue({ ok: true, data: { submissionId: "nhap1", attemptNo: 1 } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TIEU_CHI = [{ label: "Đủ nội dung", description: null, levels: [{ points: 0, label: "Thiếu" }, { points: 4, label: "Đủ" }] }];
const nen = (ganNhat: NenNopBai["ganNhat"], nopDuoc = false, nhap: NenNopBai["nhap"] = null): NenNopBai => ({
  tenKhung: "Khung thử",
  passPoints: 8,
  totalPoints: 12,
  tieuChi: TIEU_CHI,
  ganNhat,
  nhap,
  nopDuoc,
});
const luot = (o: Partial<NonNullable<NenNopBai["ganNhat"]>>): NonNullable<NenNopBai["ganNhat"]> => ({
  submissionId: "s1",
  attemptNo: 1,
  status: "SUBMITTED",
  submittedAt: new Date("2026-11-14T03:22:00.000Z"),
  dueGradeAt: new Date("2026-11-19T03:22:00.000Z"),
  score: null,
  passed: null,
  feedback: null,
  gradedAt: null,
  nguoiCham: null,
  tep: [],
  diemTieuChi: [],
  ...o,
});
const ve = (n: NenNopBai) => render(<TaskSubmitter enrollmentId="e1" lessonId="l1" nen={n} />);

describe("[TS-UI-01] chờ chấm", () => {
  it("tiến trình 3 bước, có hạn chấm, KHÔNG có điểm và KHÔNG có tên người chấm", () => {
    ve(nen(luot({})));
    const tt = screen.getByRole("list", { name: "Tiến trình bài nộp" });
    expect(within(tt).getByText("Đang chờ chấm")).toBeTruthy();
    expect(within(tt).getByText("Hạn chấm 19/11/2026")).toBeTruthy();
    expect(screen.queryByText(/Người chấm:/)).toBeNull();
    expect(screen.queryByText(/^(Đạt|Chưa đạt) \d/)).toBeNull();
  });
});

describe("[TS-UI-02] đạt", () => {
  it("'Đạt 10/12', thẻ từng tiêu chí '4/4', chữ ký người chấm dưới nhận xét", () => {
    ve(
      nen(
        luot({
          status: "GRADED",
          score: 10,
          passed: true,
          gradedAt: new Date("2026-11-16T08:00:00.000Z"),
          nguoiCham: "Ngô Thảo Vy",
          feedback: "Làm tốt.",
          diemTieuChi: [{ label: "Đủ nội dung", muc: "Đủ", points: 4, toiDa: 4, note: "Rõ ràng" }],
        }),
      ),
    );
    expect(screen.getByText("Đạt 10/12")).toBeTruthy();
    const the = screen.getByRole("list", { name: "Điểm từng tiêu chí" });
    expect(within(the).getByText("4/4")).toBeTruthy();
    expect(within(the).getByText("Rõ ràng")).toBeTruthy();
    expect(screen.getByText(/— Ngô Thảo Vy/)).toBeTruthy();
    expect(screen.getByText("Bài đã đạt. Không cần nộp lại.")).toBeTruthy();
  });
});

describe("[TS-UI-03] trả về để sửa", () => {
  it("KHÔNG in điểm tổng / đạt-chưa đạt; nhãn bước 3 đúng; cho nộp lại", () => {
    ve(nen(luot({ status: "NEEDS_REVISION", score: null, passed: null, gradedAt: new Date("2026-11-16T08:00:00.000Z"), nguoiCham: "Ngô Thảo Vy", feedback: "Sửa phần 2." }), true));
    expect(screen.queryByText(/^(Đạt|Chưa đạt) \d/)).toBeNull();
    expect(screen.getByText("Đã chấm — trả về để sửa")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nộp lại" })).toBeTruthy();
  });
  it("không đọc được tên người chấm ⇒ không in 'null' / dấu gạch dở", () => {
    const { container } = ve(nen(luot({ status: "NEEDS_REVISION", gradedAt: new Date("2026-11-16T08:00:00.000Z"), nguoiCham: null, feedback: "Sửa." }), true));
    expect(container.textContent).not.toContain("null");
    expect(screen.queryByText(/^— /)).toBeNull(); // chữ ký chỉ có khi biết tên
  });
});

describe("[TS-UI-04] chưa đạt", () => {
  it("'Chưa đạt 4/12' và cho nộp lại", () => {
    ve(nen(luot({ status: "GRADED", score: 4, passed: false, gradedAt: new Date("2026-11-16T08:00:00.000Z") }), true));
    expect(screen.getByText("Chưa đạt 4/12")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nộp lại" })).toBeTruthy();
  });
});

describe("[TS-UI-05] nộp bằng TỆP (đính tệp trước khi nộp)", () => {
  const TEP = { key: "k1", name: "bai-day-thu.mp4", mime: "video/mp4", size: 5 * 1024 * 1024 };
  it("🔴 chưa chữ, chưa tệp ⇒ nút Nộp bài KHOÁ; có tệp trong nháp (chưa chữ) ⇒ nút MỞ và liệt kê tệp sẽ nộp", () => {
    const { unmount } = ve(nen(null, true));
    expect((screen.getByRole("button", { name: "Nộp bài" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("list", { name: "Tệp sẽ nộp" })).toBeNull();
    unmount();
    ve(nen(null, true, { submissionId: "nhap1", tep: [TEP] }));
    expect((screen.getByRole("button", { name: "Nộp bài" }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(screen.getByRole("list", { name: "Tệp sẽ nộp" })).getByText(/bai-day-thu\.mp4/)).toBeTruthy();
  });

  it("nộp với chữ RỖNG nhưng có tệp ⇒ gọi action với contentText rỗng (chữ là ghi chú không bắt buộc)", async () => {
    ve(nen(null, true, { submissionId: "nhap1", tep: [TEP] }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Nộp bài" }));
    });
    await waitFor(() => expect(h.nop).toHaveBeenCalledWith({ enrollmentId: "e1", lessonId: "l1", contentText: "" }));
  });

  it("🔴 chọn tệp khi CHƯA có nháp ⇒ mở nháp rồi tải LÊN ĐÚNG lượt nháp (ký → PUT → xong, đều mang submissionId của nháp)", async () => {
    const goi: { url: string; body?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: unknown; method?: string }) => {
        goi.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
        if (init?.method === "PUT") return { ok: true, json: async () => ({}) };
        const buoc = typeof init?.body === "string" ? (JSON.parse(init.body) as { buoc: string }).buoc : "";
        return { ok: true, json: async () => (buoc === "ky" ? { ok: true, data: { url: "https://kho/put", khoa: "k-moi" } } : { ok: true, data: {} }) };
      }),
    );
    ve(nen(null, true));
    const o = screen.getByLabelText("Đính tệp để nộp bằng tệp") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(o, { target: { files: [new File(["x"], "ghi-am.pdf", { type: "application/pdf" })] } });
    });
    await waitFor(() => expect(goi.filter((g) => g.body).length).toBe(2));
    expect(h.nhap).toHaveBeenCalledTimes(1);
    for (const g of goi.filter((x) => x.body)) expect(JSON.parse(g.body!).submissionId).toBe("nhap1");
  });

  it("🔴 NỘP LẠI sau 'trả về' (có lượt cũ, chưa có nháp) ⇒ tệp mới đi vào NHÁP MỚI, KHÔNG vào lượt cũ (route chỉ nhận SUBMITTED/DRAFT)", async () => {
    const goi: { body?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: { body?: unknown; method?: string }) => {
        goi.push({ body: typeof init?.body === "string" ? init.body : undefined });
        if (init?.method === "PUT") return { ok: true, json: async () => ({}) };
        const buoc = typeof init?.body === "string" ? (JSON.parse(init.body) as { buoc: string }).buoc : "";
        return { ok: true, json: async () => (buoc === "ky" ? { ok: true, data: { url: "https://kho/put", khoa: "k" } } : { ok: true, data: {} }) };
      }),
    );
    ve(nen(luot({ submissionId: "cu1", status: "NEEDS_REVISION", gradedAt: new Date("2026-11-16T08:00:00.000Z") }), true, null));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Đính tệp để nộp bằng tệp"), { target: { files: [new File(["x"], "a.pdf", { type: "application/pdf" })] } });
    });
    await waitFor(() => expect(goi.filter((g) => g.body).length).toBe(2));
    expect(h.nhap).toHaveBeenCalledTimes(1);
    for (const g of goi.filter((x) => x.body)) expect(JSON.parse(g.body!).submissionId).toBe("nhap1");
  });

  it("đã có nháp ⇒ KHÔNG mở thêm nháp (tải vào nháp đang có)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: { body?: unknown; method?: string }) => {
        if (init?.method === "PUT") return { ok: true, json: async () => ({}) };
        const buoc = typeof init?.body === "string" ? (JSON.parse(init.body) as { buoc: string }).buoc : "";
        return { ok: true, json: async () => (buoc === "ky" ? { ok: true, data: { url: "https://kho/put", khoa: "k" } } : { ok: true, data: {} }) };
      }),
    );
    ve(nen(null, true, { submissionId: "nhap9", tep: [] }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Đính tệp để nộp bằng tệp"), { target: { files: [new File(["x"], "a.pdf", { type: "application/pdf" })] } });
    });
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(h.nhap).not.toHaveBeenCalled();
  });
});
