// @vitest-environment jsdom
/**
 * Khối "Buổi học & điểm danh" — phần Ô GIÁO VIÊN của cửa SỬA BUỔI (chốt 17/09/2026).
 *
 * ── BỘ NÀY CANH GÌ ───────────────────────────────────────────────────────────────────
 * Hook `useGvChoBuoi` sống ở `AttendanceBoard`, KHÔNG ở `SuaBuoiForm` — cố ý, để lượt nạp
 * treo vào đúng cú bấm "Sửa buổi học" thay vì phải dùng `useEffect`. Cái giá của lựa chọn
 * đó: `ds` **sống sót qua mọi lần đóng/mở form và qua mọi lần đổi buổi**. Bấm sửa một buổi
 * KHÁC thì `tai()` bắn đi, nhưng cho tới khi server trả lời — vài trăm ms tới hơn một giây
 * — màn hình vẫn đang vẽ kết quả của buổi CŨ: note ĐỎ `role="alert"` với khung giờ của
 * buổi khác, ngay cạnh một ô ngày ghi ngày mới.
 *
 * Lớp lỗi này không ném, không đỏ test nào, console sạch (luật 12) — và nó KHÔNG bắt được
 * ở `add-session-form.test.tsx` vì cửa "Thêm buổi" chỉ có MỘT ngữ cảnh.
 *
 * ⚠️ Vì sao test ở ĐÂY chứ không test hook bằng một component nháp (luật 9): chỗ hỏng là
 * DÂY NỐI — ai gọi `xoa()`, gọi ở đâu, gọi trước hay sau `tai()`. Một harness gõ tay
 * `xoa()` sẽ kiểm cái cổng chứ không kiểm hệ thống, và ba cửa đóng/mở thật (chip buổi ·
 * nút "Sửa buổi học" · `onXong`) sẽ không có gì canh.
 *
 * ── CẤY LẠI LỖI (luật 15) — đã chạy THẬT, số đo chứ không phải dự đoán ────────────────
 *   · bỏ `nguonGv.xoa()` ở nút "Sửa buổi học" (chỗ DUY NHẤT)  → **3 ĐỎ / 7**
 *   · để `xoa()` chạy SAU `tai()` thay vì trước               → **5 ĐỎ / 7**
 *
 * Số đo thứ hai là lý do thứ tự được viết ra thành lời trong mã: một bản vá "có gọi xoá"
 * mà gọi sai chỗ thì hỏng y như không gọi, và nó đọc qua thì rất giống bản đúng.
 *
 * ⚠️ Một phép đo NỮA, giải thích vì sao `xoa()` chỉ nằm ở MỘT chỗ: bản đầu gọi nó ở cả ba
 * cửa (chip đổi buổi · nút bật/tắt · `onXong`). Gỡ nó khỏi chip → **0 ĐỎ / 7**, gỡ khỏi
 * `onXong` → **0 ĐỎ / 7** — vì bấm chip hay bấm Đóng đều làm khối sửa BIẾN MẤT, và khi
 * khối đóng thì không gì đọc `ds`; mọi đường MỞ LẠI đều đi qua nút bật/tắt. Hai dòng kia
 * là dòng chết, và dòng chết thì trôi lệch mà không ai biết.
 *
 * Ngày trong bộ này là hằng TUYỆT ĐỐI, không hàm nào đọc đồng hồ thật (luật 19).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DongGv } from "@/lib/trial/gv-kha-dung";
import type { EnrollmentRow, SessionRow } from "../_lib/types";

type KetQua =
  | { ok: true; ds: DongGv[]; lyDoRong: string | null }
  | { ok: false; error: string };

const h = vi.hoisted(() => ({
  layGv: vi.fn(
    async (_input: {
      trialClassId: string;
      date: string;
      startTime: string;
      endTime: string;
      excludeSessionId?: string | null;
      hienTatCa: boolean;
    }): Promise<unknown> => ({ ok: true, ds: [], lyDoRong: null }),
  ),
  diemDanh: vi.fn(async (_i: unknown) => ({ ok: true as const })),
  hoanTat: vi.fn(async (_i: unknown) => ({ ok: true as const })),
  suaBuoi: vi.fn(async (_i: unknown) => ({ ok: true as const })),
  huyBuoi: vi.fn(async (_i: unknown) => ({ ok: true as const })),
  refresh: vi.fn(),
  loi: vi.fn((_x: string) => undefined),
  thanhCong: vi.fn((_x: string) => undefined),
}));

vi.mock("../_actions", () => ({
  layGvChoBuoiAction: h.layGv,
  markLopTrialAttendanceAction: h.diemDanh,
  completeLopTrialSessionAction: h.hoanTat,
  updateLopTrialSessionAction: h.suaBuoi,
  cancelLopTrialSessionAction: h.huyBuoi,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: h.thanhCong, error: h.loi } }));

import { AttendanceBoard } from "./attendance-board";

// ── Fixture: HAI buổi, CÙNG một giáo viên ────────────────────────────────────────────
//
// ⚠️ "Cùng một giáo viên" là điều kiện làm lộ lỗi, không phải chi tiết cho tiện. Nếu buổi
// 2 gán người KHÁC thì `SuaBuoiForm` (có `key={session.id}`) dựng lại với `teacherId` khác,
// `dongDangChon` trả `null`, và note đỏ tự biến mất — ca test sẽ XANH kể cả khi chưa vá.
// Một lớp trải nghiệm thường do đúng một người đứng, nên đây cũng là hình dạng THẬT.
const GV_CHUNG = "gv-kiet";
const TEACHERS = [
  { id: GV_CHUNG, name: "Nguyễn Tuấn Kiệt" },
  { id: "gv-lan", name: "Lê Thị Lan" },
];

function buoi(over: Partial<SessionRow> & { id: string; seq: number }): SessionRow {
  return {
    date: "2026-09-19T00:00:00.000Z",
    startTime: "18:00",
    endTime: "19:30",
    status: "SCHEDULED",
    teacherId: GV_CHUNG,
    roomId: null,
    // 23/09 — case CŨ (chưa biết ai mở). Giữ `null` ở fixture là CÓ CHỦ ĐÍCH: đây là
    // hình dạng của phần lớn dữ liệu thật ngay sau khi lên, và là nhánh mà cổng quyền
    // đẩy lên Quản lý. Fixture tròn trịa ("ai cũng có người tạo") sẽ không bao giờ
    // chạm tới nhánh đó.
    createdById: null,
    nguoiTao: null,
    quyenSua: { duoc: true },
    quyenXoa: { duoc: true },
    quyenDoiGio: { duoc: true },
    quyenDiemDanh: { duoc: true },
    attendance: {},
    danhGia: {},
    // 29/09 — giáo viên không vắng (bảng điểm danh không đọc trường này).
    gvVang: null,
    ...over,
  };
}

const BUOI_1 = buoi({ id: "ts1", seq: 1 });
const BUOI_2 = buoi({ id: "ts2", seq: 2, date: "2026-09-26T00:00:00.000Z" });

function dong(p: Partial<DongGv> & { id: string; name: string }): DongGv {
  return { phu: "PHU_TRON", muc: "KHONG", nhan: "", ...p };
}

/** Kết quả có note ĐỎ cho giáo viên đang gán — thứ KHÔNG được dính sang buổi khác. */
const DS_TRUNG_LICH: KetQua = {
  ok: true,
  ds: [
    dong({
      id: GV_CHUNG,
      name: "Nguyễn Tuấn Kiệt",
      muc: "DO",
      nhan: "TRÙNG LỊCH: Lớp Sata 4 A 18:00–19:30",
    }),
  ],
  lyDoRong: null,
};

function dung(over: { sessions?: SessionRow[]; teachers?: { id: string; name: string }[] } = {}) {
  return render(
    <AttendanceBoard
      // Fixture là lớp slot CŨ (không khung) — đúng hình dạng dữ liệu đang chạy trên prod.
      lopTheoKhung={false}
      ngayLop={null}
      khungLop={null}
      trialClassId="lop-1"
      sessions={over.sessions ?? [BUOI_1, BUOI_2]}
      enrollments={[] as EnrollmentRow[]}
      canMark={false}
      canManage
      teachers={over.teachers ?? TEACHERS}
      rooms={[]}
      cheDoChonGv="LOC_THEO_CA"
      locGvTheoCa
      soGvMienLoc={0}
    />,
  );
}

/** Chip chọn buổi thứ `seq`. */
function chipBuoi(seq: number): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^Buổi ${seq} ·`) });
}

/**
 * Nút bật/tắt khối sửa, ở HÀNG TIÊU ĐỀ của buổi đang chọn.
 *
 * ⚠️ `getAllByRole(...)[0]` chứ không `getByRole`: khi khối sửa đang mở thì có ĐÚNG HAI nút
 * tên "Đóng" — nút bật/tắt ở hàng tiêu đề và nút "Đóng" trong chính khối sửa (`onXong`).
 * Chúng là hai cửa THẬT, cả hai đều phải quên kết quả cũ, nên gộp chúng lại bằng một bộ
 * chọn lỏng lẻo là tự bịt mắt. Thứ tự DOM: hàng tiêu đề đứng trước khối sửa.
 */
function nutSua(): HTMLElement {
  return screen.getAllByRole("button", { name: /^(Sửa buổi học|Đóng)$/ })[0]!;
}

/** Nút "Đóng" BÊN TRONG khối sửa — cửa `onXong`, khác nút bật/tắt ở trên. */
function nutDongTrongForm(): HTMLElement {
  const ds = screen.getAllByRole("button", { name: /^Đóng$/ });
  return ds[ds.length - 1]!;
}

/** Mở khối sửa của buổi đang chọn và CHỜ lượt hỏi đầu tiên đi qua `useTransition`. */
async function moSuaBuoi(soLuot: number) {
  fireEvent.click(nutSua());
  await waitFor(() => expect(h.layGv).toHaveBeenCalledTimes(soLuot));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.layGv.mockResolvedValue({ ok: true, ds: [], lyDoRong: null } satisfies KetQua);
});

describe("AttendanceBoard — đổi ngữ cảnh thì QUÊN kết quả lọc cũ", () => {
  it("mở khối sửa ⇒ hỏi server ngay, kèm buổi đang sửa để không tự báo trùng với chính mình", async () => {
    dung();
    await moSuaBuoi(1);
    expect(h.layGv.mock.calls[0][0]).toEqual({
      trialClassId: "lop-1",
      date: "2026-09-19",
      startTime: "18:00",
      endTime: "19:30",
      excludeSessionId: "ts1",
      hienTatCa: false,
    });
  });

  // Đổi buổi bằng chip ⇒ khối sửa ĐÓNG, nên note đỏ rời màn hình cùng nó.
  //
  // ⚠️ Ca này canh phép ĐÓNG, KHÔNG canh phép xoá — nói rõ để không ai đọc nhầm nó thành
  // "chip có xoá `ds`". Chip không xoá (và cố ý không xoá, xem `attendance-board.tsx`).
  // Nó vẫn đáng giữ: người dùng thường đổi buổi bằng chip, và nếu khối sửa KHÔNG đóng thì
  // toàn bộ lớp lỗi này quay lại ngay ở cửa hay dùng nhất.
  it("đổi sang buổi khác ⇒ note ĐỎ của buổi trước rời màn hình ngay, không đợi server", async () => {
    h.layGv.mockResolvedValue(DS_TRUNG_LICH);
    dung();
    await moSuaBuoi(1);
    expect(screen.getByRole("alert").textContent).toContain("TRÙNG LỊCH");

    fireEvent.click(chipBuoi(2));
    // KHÔNG `await` gì ở đây là CỐ Ý: phép xoá phải xảy ra ngay trong lượt xử lý sự kiện,
    // không phải "sẽ đúng sau khi server trả lời".
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // ⭐ CA KHOÁ (2): mở form buổi KHÁC trong lúc lượt hỏi còn đang bay.
  it("mở sửa buổi KHÁC ⇒ trong lúc chờ server KHÔNG được vẽ lại note đỏ của buổi cũ", async () => {
    h.layGv.mockResolvedValue(DS_TRUNG_LICH);
    dung();
    await moSuaBuoi(1);
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.click(chipBuoi(2));
    // Lượt hỏi của buổi 2 KHÔNG BAO GIỜ trả lời — đúng khoảng thời gian mà bug sống.
    h.layGv.mockImplementationOnce(() => new Promise(() => {}));
    fireEvent.click(nutSua());
    await waitFor(() => expect(h.layGv).toHaveBeenCalledTimes(2));

    expect(screen.queryByRole("alert")).toBeNull();
    // Và ô ngày phải là ngày của buổi MỚI — để ca này đỏ đúng chỗ nếu ai đó đổi luôn cả
    // việc chọn buổi.
    expect((screen.getByLabelText("Ngày") as HTMLInputElement).value).toBe("2026-09-26");
    // Lượt hỏi thứ hai phải loại ĐÚNG buổi 2 khỏi phép so trùng.
    expect(h.layGv.mock.calls[1][0]).toMatchObject({
      date: "2026-09-26",
      excludeSessionId: "ts2",
    });
  });

  // ⭐ CA KHOÁ (3): đóng rồi mở lại CÙNG buổi.
  it("đóng khối sửa rồi mở lại (nút bật/tắt) ⇒ không hiện lại kết quả cũ trong lúc chờ", async () => {
    h.layGv.mockResolvedValue(DS_TRUNG_LICH);
    dung();
    await moSuaBuoi(1);
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.click(nutSua()); // Đóng
    h.layGv.mockImplementationOnce(() => new Promise(() => {}));
    fireEvent.click(nutSua()); // Mở lại
    await waitFor(() => expect(h.layGv).toHaveBeenCalledTimes(2));

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("đóng bằng nút 'Đóng' TRONG khối sửa rồi mở lại ⇒ cũng sạch", async () => {
    // Cửa `onXong` (nút "Đóng" · sau khi Lưu · sau khi Huỷ buổi) — đường đóng thứ hai, và
    // người dùng dùng nó nhiều ngang nút bật/tắt. Nó KHÔNG tự xoá; thứ giữ cho ca này xanh
    // là lượt MỞ LẠI, đúng như thiết kế một-cơ-chế.
    h.layGv.mockResolvedValue(DS_TRUNG_LICH);
    dung();
    await moSuaBuoi(1);
    fireEvent.click(nutDongTrongForm());

    h.layGv.mockImplementationOnce(() => new Promise(() => {}));
    fireEvent.click(nutSua());
    await waitFor(() => expect(h.layGv).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lý do 'đang hiện tất cả' của buổi cũ cũng phải biến mất khi đổi buổi", async () => {
    // Không chỉ note đỏ: `lyDoRong` là câu giải thích cho MỘT lượt lọc cụ thể, để lại là
    // nó giải thích cho một danh sách không còn tồn tại.
    h.layGv.mockResolvedValue({
      ok: true,
      ds: [dong({ id: GV_CHUNG, name: "Nguyễn Tuấn Kiệt" })],
      lyDoRong: "Chưa sinh lưới ca tháng này nên chưa lọc được theo ca.",
    } satisfies KetQua);
    dung();
    await moSuaBuoi(1);
    expect(screen.getByText(/Chưa sinh lưới ca tháng này/)).toBeTruthy();

    fireEvent.click(chipBuoi(2));
    expect(screen.queryByText(/Chưa sinh lưới ca tháng này/)).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════
// VÁ [6] — TÀI KHOẢN ĐÃ XOÁ MỀM: cửa THẬT của cảnh "không có trong danh sách đầy đủ"
//
// `getAssignableTeachers` đặt `deletedAt: null` ở TẦNG NGOÀI của `where`, nên Prisma AND
// nó với cả nhánh cứu hộ `includeIds` — tài khoản đã xoá mềm KHÔNG có trong `teachers` mà
// trang truyền xuống, và cũng không bao giờ có trong `ds` (khối bằng chứng ở
// `_lib/gv-hop-le.ts`). Dán " · NGOÀI DANH SÁCH LỌC" cho họ là đổ lỗi cho một bộ lọc chưa
// hề xét tới họ.
//
// Đây là đường THẬT (luật 9): `SuaBuoiForm` khởi tạo `teacherId` từ `session.teacherId`.
// ═════════════════════════════════════════════════════════════════════════════════════

describe("buổi cũ đang gán một tài khoản đã xoá mềm", () => {
  const DA_XOA = "gv-da-nghi";
  const BUOI_GV_CU = buoi({ id: "ts9", seq: 1, teacherId: DA_XOA });

  it("dùng chữ TRUNG TÍNH, không đổ lỗi cho bộ lọc — và GIỮ nguyên id đang gán", async () => {
    h.layGv.mockResolvedValue({
      ok: true,
      ds: [dong({ id: "gv-lan", name: "Lê Thị Lan" })],
      lyDoRong: null,
    } satisfies KetQua);
    // `teachers` KHÔNG chứa `DA_XOA` — đúng thứ trang truyền xuống cho tài khoản đã xoá mềm.
    dung({ sessions: [BUOI_GV_CU], teachers: TEACHERS });
    await moSuaBuoi(1);

    await screen.findByText(/KHÔNG CÒN TRONG DANH SÁCH CHỌN/);
    expect(screen.queryByText(/NGOÀI DANH SÁCH LỌC/)).toBeNull();
    // Mất `value` ở đây là ghi đè một giáo viên người dùng chưa từng chọn — mất dữ liệu CÂM.
    expect((screen.getByLabelText("Giáo viên") as HTMLSelectElement).value).toBe(DA_XOA);
  });
});
