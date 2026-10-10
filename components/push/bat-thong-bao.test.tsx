// @vitest-environment jsdom
/**
 * `<BatThongBao/>` — dây nối nửa CLIENT của Web Push. Bộ này ra đời ở Đợt 5 vì lăng kính chỉ ra
 * component này **chưa có một tệp test nào**, trong khi nó giữ đúng ba thứ mà Đợt 5 vừa đổi:
 *
 *  1. So "máy này" bằng **BĂM** chứ không bằng endpoint (server thôi gửi endpoint xuống HTML).
 *     Cấy lỗi `const bam = ep` (so endpoint trần với băm) thì `daDangKy` vĩnh viễn `false` và
 *     không bao giờ có nhãn "máy này" ⇒ người dùng bấm "Bật thông báo" lại, và mỗi cú bấm đẻ
 *     một dòng `ACTIVE` mồ côi. `client-key.test.ts` KHÔNG bắt được — nó chỉ khoá hai hàm, không
 *     khoá chỗ GỌI.
 *  2. Nhãn cắt (`nhan`) hiện ra giao diện — nó là thứ duy nhất phân biệt hai trình duyệt trông
 *     giống hệt nhau qua `tenMay` (vd hai máy Chrome/Windows).
 *  3. Không rò endpoint đầy đủ ra DOM.
 *
 * Đợt 6 thêm `[PUSH-D6-T09]`: ba nút của màn này phải CẮM/XOÁ cờ "đã tắt tay trên máy này"
 * (`lib/push/bo-nho-may.ts`). Không có dây đó thì đường tự đăng ký lại của Đợt 6 dựng lại đúng
 * thứ người dùng vừa bấm để tắt, và hai nút "Tắt"/"Gỡ" trở thành vô nghĩa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(admin)/admin/settings/_push-actions", () => ({
  dangKyThietBiAction: vi.fn(async () => ({ ok: true })),
  huyThietBiAction: vi.fn(async () => ({ ok: true })),
  huyThietBiTheoEndpointAction: vi.fn(async () => ({ ok: true, soDong: 1 })),
}));
// Mock kho trạng thái trình duyệt: ca T09 kiểm CHỖ GỌI, còn hành vi của chính kho thì
// `lib/push/bo-nho-may.test.ts` khoá riêng (kèm lý do phải tự dựng storage).
vi.mock("@/lib/push/bo-nho-may", () => ({
  daTatTayOMayNay: vi.fn(() => false),
  datTatTay: vi.fn(),
  xoaTatTay: vi.fn(),
  daDongBoTrongPhien: vi.fn(() => false),
  datDaDongBo: vi.fn(),
}));

import { BatThongBao, type ThietBiView } from "./bat-thong-bao";
import { bamEndpoint } from "@/lib/push/ket-qua";
import { nhanEndpoint } from "@/lib/push/ket-qua";
import { datDaDongBo, datTatTay, xoaTatTay } from "@/lib/push/bo-nho-may";
import { huyThietBiTheoEndpointAction } from "@/app/(admin)/admin/settings/_push-actions";
import { taoCapKhoaVapid } from "@/lib/push/vapid";

/** `session.user.id` — cờ/mốc ở trình duyệt khoá theo NGƯỜI, không theo origin. */
const NGUOI = "usr_sale_a";
const EP_MAY_NAY = "https://fcm.googleapis.com/wp/dien-thoai-dang-cam-XyZ987";
const EP_MAY_KHAC = "https://updates.push.services.mozilla.com/wp/may-ban-o-co-so";
/** Khoá THẬT, sinh bằng đúng bộ sinh của Đợt 1 — không gõ tay một chuỗi mẫu. */
const KHOA = taoCapKhoaVapid().publicKey;

function thietBi(endpoint: string, ghiDe: Partial<ThietBiView> = {}): ThietBiView {
  return {
    id: `sub_${endpoint.slice(-4)}`,
    bam: bamEndpoint(endpoint),
    nhan: nhanEndpoint(endpoint),
    deviceLabel: null,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari",
    origin: "https://admin.satarobo.vn",
    displayMode: "standalone",
    lastSuccessAt: null,
    createdAt: "2026-09-01T08:00:00.000Z",
    ...ghiDe,
  };
}

/** Bộ đăng ký giả mà cả `doBoiCanh`, `bat()` và `tatMayNay()` dùng được. */
function dungDangKy(endpointHienTai: string | null) {
  const sub = endpointHienTai
    ? {
        endpoint: endpointHienTai,
        unsubscribe: vi.fn(async () => true),
        toJSON: () => ({
          endpoint: endpointHienTai,
          keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) },
        }),
      }
    : null;
  const subMoi = {
    endpoint: EP_MAY_NAY,
    unsubscribe: vi.fn(async () => true),
    toJSON: () => ({ endpoint: EP_MAY_NAY, keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) } }),
  };
  const pushManager = {
    getSubscription: vi.fn(async () => sub),
    subscribe: vi.fn(async () => subMoi),
  };
  return { sub, subMoi, pushManager, reg: { pushManager } };
}

let dangKy: ReturnType<typeof dungDangKy>;

/** Dựng môi trường trình duyệt ĐỦ để component đi hết `doBoiCanh()` và cả ba nút. */
function dungTrinhDuyet(opts: { endpointHienTai?: string | null; quyen?: NotificationPermission } = {}) {
  const { endpointHienTai = EP_MAY_NAY, quyen = "granted" } = opts;
  dangKy = dungDangKy(endpointHienTai);
  Object.defineProperty(window, "navigator", {
    value: {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari",
      maxTouchPoints: 5,
      serviceWorker: {
        getRegistration: vi.fn(async () => dangKy.reg),
        register: vi.fn(async () => dangKy.reg),
        ready: Promise.resolve(dangKy.reg),
      },
    },
    configurable: true,
    writable: true,
  });
  // `PushManager` phải tồn tại trên `window`, nếu không component đi nhánh "không hỗ trợ".
  Object.defineProperty(window, "PushManager", { value: function () {}, configurable: true });
  Object.defineProperty(window, "Notification", {
    value: Object.assign(function () {}, {
      permission: quyen,
      requestPermission: vi.fn(async () => "granted" as NotificationPermission),
    }),
    configurable: true,
    writable: true,
  });
  window.matchMedia = ((q: string) =>
    ({
      matches: q.includes("standalone"),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }) as unknown as MediaQueryList);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  // Khoá công khai phải hợp lệ, không thì `bat()` đi nhánh "chưa cấu hình khoá". Đọc được ở đây
  // là nhờ Đợt 6 dời lời đọc env vào TRONG `bat()` — ở module scope thì `stubEnv` vô tác dụng.
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", KHOA);
  vi.mocked(huyThietBiTheoEndpointAction).mockImplementation(async () => ({ ok: true, soDong: 1 }));
  dungTrinhDuyet();
});

describe("[PUSH-D5-T15] đánh dấu 'máy này' bằng BĂM, không bằng endpoint", () => {
  it("máy đang cầm được gắn nhãn 'máy này'; máy khác thì không", async () => {
    render(<BatThongBao thietBi={[thietBi(EP_MAY_NAY), thietBi(EP_MAY_KHAC)]} nguoiDung={NGUOI} />);
    // Băm chạy qua `crypto.subtle` (async) nên nhãn xuất hiện sau một nhịp.
    expect(await screen.findByText("máy này")).toBeTruthy();
    expect(screen.getAllByText("máy này")).toHaveLength(1);
  });

  it("trình duyệt CHƯA có đăng ký ⇒ không máy nào được gắn nhãn", async () => {
    dungTrinhDuyet({ endpointHienTai: null });
    render(<BatThongBao thietBi={[thietBi(EP_MAY_NAY)]} nguoiDung={NGUOI} />);
    // Chờ đúng mốc hiệu ứng đã chạy xong: tiêu đề đổi sang trạng thái "chưa bật". Không chờ thì
    // `queryByText` dưới đây xanh một cách vô nghĩa (nhãn chưa kịp vẽ).
    expect(await screen.findByText("Bật thông báo trên máy này")).toBeTruthy();
    expect(screen.queryByText("máy này")).toBeNull();
  });

  it("băm của máy đang cầm KHÔNG khớp dòng nào ⇒ coi như CHƯA đăng ký", async () => {
    // Fail sang "chưa đăng ký" là đúng chiều: mời bật lại một lần là vô hại, còn báo "đang
    // nhận" khi không chắc là nói sai với người dùng.
    render(<BatThongBao thietBi={[thietBi(EP_MAY_KHAC)]} nguoiDung={NGUOI} />);
    expect(await screen.findByText(/Bật thông báo trên máy này/)).toBeTruthy();
    expect(screen.queryByText("máy này")).toBeNull();
  });
});

describe("[PUSH-D5-T16] không rò endpoint ra DOM, và nhãn cắt PHẢI hiện", () => {
  it("DOM không chứa endpoint đầy đủ của bất kỳ máy nào", async () => {
    const { container } = render(
      <BatThongBao thietBi={[thietBi(EP_MAY_NAY), thietBi(EP_MAY_KHAC)]} nguoiDung={NGUOI} />,
    );
    await screen.findByText("máy này");
    expect(container.innerHTML).not.toContain(EP_MAY_NAY);
    expect(container.innerHTML).not.toContain(EP_MAY_KHAC);
    expect(container.innerHTML).not.toContain("dien-thoai-dang-cam");
  });

  it("nhãn cắt của TỪNG máy hiện ra — thứ duy nhất phân biệt hai máy trông giống nhau", async () => {
    // Hai dòng cùng `userAgent` và cùng origin ⇒ `tenMay()` ra cùng một chuỗi. Không có nhãn
    // cắt thì người dùng không biết bấm "Gỡ" đúng máy nào.
    render(<BatThongBao thietBi={[thietBi(EP_MAY_NAY), thietBi(EP_MAY_KHAC)]} nguoiDung={NGUOI} />);
    await screen.findByText("máy này");
    expect(screen.getByText(nhanEndpoint(EP_MAY_NAY))).toBeTruthy();
    expect(screen.getByText(nhanEndpoint(EP_MAY_KHAC))).toBeTruthy();
  });
});

describe("[PUSH-D6-T09] ba nút phải cắm/xoá cờ 'đã tắt tay trên máy này'", () => {
  it("'Tắt trên máy này' ⇒ CẮM cờ (không cắm thì tải lại trang là nó bật lại)", async () => {
    render(<BatThongBao thietBi={[thietBi(EP_MAY_NAY)]} nguoiDung={NGUOI} />);
    await screen.findByText("máy này");
    fireEvent.click(screen.getByRole("button", { name: /Tắt trên máy này/ }));
    await waitFor(() => expect(datTatTay).toHaveBeenCalledExactlyOnceWith(NGUOI));
    expect(dangKy.sub!.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("máy chủ TỪ CHỐI lệnh tắt ⇒ KHÔNG cắm cờ và KHÔNG huỷ đăng ký", async () => {
    // Cắm cờ ở đây là nói sai: dòng vẫn ACTIVE trên máy chủ, nên máy này vẫn nhận thông báo —
    // mà cờ lại chặn đường tự đăng ký lại sửa nó.
    vi.mocked(huyThietBiTheoEndpointAction).mockImplementation(async () => ({
      ok: false,
      error: "Chưa đăng nhập",
    }));
    render(<BatThongBao thietBi={[thietBi(EP_MAY_NAY)]} nguoiDung={NGUOI} />);
    await screen.findByText("máy này");
    fireEvent.click(screen.getByRole("button", { name: /Tắt trên máy này/ }));
    await screen.findByText("Chưa đăng nhập");
    expect(datTatTay).not.toHaveBeenCalled();
    expect(dangKy.sub!.unsubscribe).not.toHaveBeenCalled();
  });

  it("'Gỡ' đúng dòng CỦA MÁY NÀY ⇒ CẮM cờ", async () => {
    // Nút "Gỡ" chỉ thu hồi DÒNG, không `unsubscribe()`. Không cắm cờ thì lượt tải kế dựng lại.
    render(<BatThongBao thietBi={[thietBi(EP_MAY_NAY)]} nguoiDung={NGUOI} />);
    await screen.findByText("máy này");
    fireEvent.click(screen.getByRole("button", { name: "Gỡ" }));
    await waitFor(() => expect(datTatTay).toHaveBeenCalledExactlyOnceWith(NGUOI));
  });

  it("'Gỡ' dòng của MÁY KHÁC ⇒ KHÔNG cắm cờ (đừng khoá máy đang ngồi)", async () => {
    render(<BatThongBao thietBi={[thietBi(EP_MAY_NAY), thietBi(EP_MAY_KHAC)]} nguoiDung={NGUOI} />);
    await screen.findByText("máy này");
    const nut = screen.getAllByRole("button", { name: "Gỡ" });
    // Dòng thứ hai là máy khác (thứ tự render theo prop).
    fireEvent.click(nut[1]!);
    await screen.findByText("Đã gỡ thiết bị.");
    expect(datTatTay).not.toHaveBeenCalled();
  });

  it("'Bật thông báo' ⇒ XOÁ cờ (nếu không: bật hôm nay, mai đăng nhập lại là im)", async () => {
    dungTrinhDuyet({ endpointHienTai: null });
    render(<BatThongBao thietBi={[]} nguoiDung={NGUOI} />);
    await screen.findByText("Bật thông báo trên máy này");
    fireEvent.click(screen.getByRole("button", { name: "Bật thông báo" }));
    await waitFor(() => expect(xoaTatTay).toHaveBeenCalledExactlyOnceWith(NGUOI));
    expect(datTatTay).not.toHaveBeenCalled();
  });

  it("'Bật thông báo' cũng ĐẶT mốc đã-đồng-bộ — hai đường dùng chung một khái niệm", async () => {
    // Không đặt ở đây thì lượt tải trang ngay sau cú bấm lại gọi Server Action một lần nữa cho
    // đúng cái vừa ghi xong: thêm một `revalidatePath` hai đường + một `resolveActor` (≈9 câu DB)
    // cho một việc không đổi gì. Repo đã có một sự cố vượt trần egress vì đúng loại đó.
    dungTrinhDuyet({ endpointHienTai: null });
    render(<BatThongBao thietBi={[]} nguoiDung={NGUOI} />);
    await screen.findByText("Bật thông báo trên máy này");
    fireEvent.click(screen.getByRole("button", { name: "Bật thông báo" }));
    await waitFor(() => expect(datDaDongBo).toHaveBeenCalledTimes(1));
    const [ai, bam] = vi.mocked(datDaDongBo).mock.calls[0]!;
    expect(ai).toBe(NGUOI);
    // Băm thật của endpoint vừa đăng ký, KHÔNG phải endpoint trần: mốc nằm trong sessionStorage,
    // và endpoint là một KHẢ NĂNG GỬI — không để nó nguyên ở bất kỳ đâu.
    expect(bam).toBe(bamEndpoint(EP_MAY_NAY));
    expect(bam).not.toContain("fcm.googleapis.com");
  });
});
