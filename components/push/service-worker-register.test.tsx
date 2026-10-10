// @vitest-environment jsdom
/**
 * `<ServiceWorkerRegister/>` — dây nối giữa việc cài worker và đường TỰ ĐĂNG KÝ LẠI (Đợt 6).
 *
 * Bộ này canh DÂY NỐI, không canh logic bên trong `tuDangKyLaiPush` (đã có
 * `lib/push/tu-dang-ky-lai.test.ts`). Bốn thứ dễ hỏng câm và đều không có triệu chứng ở giao diện:
 *
 *  1. **KHÔNG BAO GIỜ XIN QUYỀN.** `[PUSH-D6-T12]` dưới đây. Lăng kính Đợt 6 chỉ ra rằng cổng
 *     duy nhất canh điều luật này nằm ở tệp test của MODULE KHÁC, nên thêm
 *     `Notification.requestPermission()` vào CHÍNH component này thì cả bộ vẫn xanh — mà đây đúng
 *     là chỗ Đợt 6 vừa mở đường. Nên bộ này dựng `Notification` thật và đếm ở MỌI ca.
 *  2. **Phải chờ `navigator.serviceWorker.ready`, không dùng registration mà `register()` trả
 *     về.** Theo spec Push API, `pushManager.subscribe()` trên registration còn `installing` ném
 *     `InvalidStateError` — tức đúng LƯỢT ĐẦU của một máy mới (lượt duy nhất thật sự cần) sẽ
 *     hỏng, còn mọi lượt sau lại chạy, nên bug này không tái hiện được khi đi thử.
 *  3. **Phải móc vào chuỗi của `register()`,** chứ không nằm ở một `useEffect` riêng: việc cài
 *     worker bị hoãn tới sự kiện `load`, nên một effect độc lập chạy trước và không thấy
 *     registration nào.
 *  4. **`register()` hỏng thì KHÔNG gọi tiếp** và không ném ra ngoài — đây là mã chạy lúc tải
 *     trang cho một tính năng cộng thêm.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

vi.mock("@/lib/push/tu-dang-ky-lai", () => ({
  tuDangKyLaiPush: vi.fn(async () => "DA_GHI"),
}));

import { ServiceWorkerRegister } from "./service-worker-register";
import { tuDangKyLaiPush } from "@/lib/push/tu-dang-ky-lai";

const tuDangKy = vi.mocked(tuDangKyLaiPush);
const NGUOI = "usr_sale_a";

/** Hai đối tượng KHÁC NHAU: bản `register()` trả về, và bản `ready` trả về. */
const REG_TU_REGISTER = { nhan: "tu-register" } as unknown as ServiceWorkerRegistration;
const REG_DA_SAN_SANG = { nhan: "da-san-sang" } as unknown as ServiceWorkerRegistration;

/**
 * Spy quyền thông báo. Nó phải TỒN TẠI ở mọi ca: jsdom không có `Notification`, nên nếu không
 * dựng thì một lời gọi `requestPermission` trong component sẽ bị rào `typeof` của chính kẻ vi
 * phạm che đi, và ca đếm dưới đây xanh một cách vô nghĩa.
 */
const xinQuyen = vi.fn(async () => "granted" as NotificationPermission);

let register: ReturnType<typeof vi.fn>;
let gocNavigator: PropertyDescriptor | undefined;
let gocReadyState: PropertyDescriptor | undefined;
let gocNotification: PropertyDescriptor | undefined;

function dungNavigator(
  opts: { coServiceWorker?: boolean; registerNem?: boolean; ready?: Promise<unknown> } = {},
) {
  const { coServiceWorker = true, registerNem = false, ready } = opts;
  register = vi.fn(async () => {
    if (registerNem) throw new Error("SecurityError: /sw.js 404");
    return REG_TU_REGISTER;
  });
  const gt = coServiceWorker
    ? { serviceWorker: { register, ready: ready ?? Promise.resolve(REG_DA_SAN_SANG) } }
    : {};
  Object.defineProperty(window, "navigator", { value: gt, configurable: true, writable: true });
}

function datReadyState(v: DocumentReadyState) {
  Object.defineProperty(document, "readyState", { value: v, configurable: true });
}

beforeEach(() => {
  gocNavigator = Object.getOwnPropertyDescriptor(window, "navigator");
  gocReadyState = Object.getOwnPropertyDescriptor(document, "readyState");
  gocNotification = Object.getOwnPropertyDescriptor(globalThis, "Notification");
  tuDangKy.mockClear();
  tuDangKy.mockImplementation(async () => "DA_GHI");
  xinQuyen.mockClear();
  // `permission: "default"` là trạng thái NGUY HIỂM NHẤT: đó là lúc trình duyệt còn cho hỏi, nên
  // một lời gọi `requestPermission` ở đây sẽ thật sự bật hộp thoại cho người dùng.
  Object.defineProperty(globalThis, "Notification", {
    value: Object.assign(function () {}, { permission: "default", requestPermission: xinQuyen }),
    configurable: true,
    writable: true,
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  dungNavigator();
  datReadyState("complete");
});

afterEach(() => {
  // Trả ĐỐI XỨNG: `document.readyState` vốn KHÔNG có descriptor riêng (đã đo — nó nằm trên
  // prototype), nên chỉ `if (goc)` là để lại một own property "complete" rò sang tệp test khác
  // của cùng tiến trình.
  for (const [chu, goc, tren] of [
    ["navigator", gocNavigator, window],
    ["readyState", gocReadyState, document],
    ["Notification", gocNotification, globalThis],
  ] as const) {
    if (goc) Object.defineProperty(tren, chu, goc);
    else delete (tren as unknown as Record<string, unknown>)[chu];
  }
  vi.restoreAllMocks();
});

describe("[PUSH-D6-T08] cài worker rồi mới tự đăng ký lại", () => {
  it("cài xong ⇒ gọi `tuDangKyLaiPush` với registration ĐÃ SẴN SÀNG + đúng người", async () => {
    // Ca này là thứ duy nhất chặn được lỗi `InvalidStateError` ở lượt tải ĐẦU của một máy mới.
    await act(async () => {
      render(<ServiceWorkerRegister nguoiDung={NGUOI} />);
    });
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(tuDangKy).toHaveBeenCalledTimes(1);
    expect(tuDangKy).toHaveBeenCalledWith(REG_DA_SAN_SANG, NGUOI);
  });

  it("`register()` hỏng ⇒ KHÔNG gọi tiếp, và không ném ra ngoài", async () => {
    dungNavigator({ registerNem: true });
    await act(async () => {
      render(<ServiceWorkerRegister nguoiDung={NGUOI} />);
    });
    expect(tuDangKy).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("trình duyệt không có serviceWorker ⇒ im lặng bỏ qua, không gọi gì", async () => {
    dungNavigator({ coServiceWorker: false });
    await act(async () => {
      render(<ServiceWorkerRegister nguoiDung={NGUOI} />);
    });
    expect(tuDangKy).not.toHaveBeenCalled();
  });

  it("trang chưa tải xong ⇒ CHỜ sự kiện `load` mới cài (không tranh băng thông lượt đầu)", async () => {
    datReadyState("loading");
    await act(async () => {
      render(<ServiceWorkerRegister nguoiDung={NGUOI} />);
    });
    expect(register).not.toHaveBeenCalled();
    await act(async () => {
      window.dispatchEvent(new Event("load"));
    });
    expect(tuDangKy).toHaveBeenCalledWith(REG_DA_SAN_SANG, NGUOI);
  });

  it("rời trang trước khi `load` nổ ⇒ không cài, không tự đăng ký", async () => {
    datReadyState("loading");
    let unmount = () => {};
    await act(async () => {
      unmount = render(<ServiceWorkerRegister nguoiDung={NGUOI} />).unmount;
    });
    await act(async () => {
      unmount();
      window.dispatchEvent(new Event("load"));
    });
    expect(register).not.toHaveBeenCalled();
    expect(tuDangKy).not.toHaveBeenCalled();
  });

  it("rời trang GIỮA `register()` và `ready` ⇒ KHÔNG gọi tự đăng ký nữa", async () => {
    // Ca duy nhất chạm cổng `if (huy) return;` NẰM TRONG chuỗi Promise. Ca trên chỉ chứng minh
    // `removeEventListener` chạy — nó unmount TRƯỚC khi `load` nổ nên chuỗi chưa bao giờ bắt đầu.
    // Ở đây `ready` do test giữ, nên cửa sổ "đang cài, người dùng bấm sang trang khác" mở thật.
    let moRa!: (r: ServiceWorkerRegistration) => void;
    dungNavigator({
      ready: new Promise<ServiceWorkerRegistration>((r) => {
        moRa = r;
      }),
    });
    let unmount = () => {};
    await act(async () => {
      unmount = render(<ServiceWorkerRegister nguoiDung={NGUOI} />).unmount;
    });
    expect(register).toHaveBeenCalledTimes(1);
    await act(async () => {
      unmount();
    });
    await act(async () => {
      moRa(REG_DA_SAN_SANG);
    });
    expect(tuDangKy).not.toHaveBeenCalled();
  });
});

describe("[PUSH-D6-T12] ⚠️ ĐƯỜNG TỰ ĐỘNG KHÔNG BAO GIỜ XIN QUYỀN", () => {
  it("không lượt nào — kể cả nhánh lỗi — gọi `Notification.requestPermission`", async () => {
    // Điều luật KHÔNG SỬA ĐƯỢC SAU: xin quyền ngoài một cú bấm là cách chắc chắn để nhân viên
    // bấm "Chặn" theo phản xạ, và trình duyệt KHÔNG hỏi lại ⇒ kênh push của máy đó chết vĩnh
    // viễn, code không có đường lấy lại.
    for (const dung of [
      () => dungNavigator(),
      () => dungNavigator({ registerNem: true }),
      () => dungNavigator({ coServiceWorker: false }),
    ]) {
      dung();
      await act(async () => {
        render(<ServiceWorkerRegister nguoiDung={NGUOI} />);
      });
    }
    datReadyState("loading");
    dungNavigator();
    await act(async () => {
      render(<ServiceWorkerRegister nguoiDung={NGUOI} />);
    });
    await act(async () => {
      window.dispatchEvent(new Event("load"));
    });

    expect(xinQuyen).not.toHaveBeenCalled();
    // Đối chứng dương: spy CÓ sẵn và gọi được — nếu không, ca trên xanh vì `Notification` vắng
    // mặt chứ không vì component ngoan.
    expect(typeof Notification.requestPermission).toBe("function");
    await Notification.requestPermission();
    expect(xinQuyen).toHaveBeenCalledTimes(1);
  });

  it("cổng NGUỒN: ba tệp của đường tự động không được chứa `requestPermission`", async () => {
    // Cổng hành vi ở trên chỉ thấy được những nhánh mà ca test chạy tới. Cổng nguồn này thấy MỌI
    // nhánh, kể cả một lời gọi nằm trong nhánh chưa ai test. Cố ý KHÔNG quét
    // `components/push/bat-thong-bao.tsx` — nó là đường BẤM TAY, nơi duy nhất được phép xin quyền
    // (`rg requestPermission` toàn repo trừ docs/test ⇒ đúng một lời gọi, ở đó).
    const { readFileSync } = await import("node:fs");
    const pham: string[] = [];
    for (const f of [
      "components/push/service-worker-register.tsx",
      "lib/push/tu-dang-ky-lai.ts",
      "lib/push/bo-nho-may.ts",
    ]) {
      const src = readFileSync(f, "utf8");
      // Bỏ chú thích trước khi quét: ba tệp này GIẢI THÍCH điều luật bằng chính tên hàm, nên quét
      // thô là đỏ giả — và một cổng đỏ giả sẽ bị người sau nới ra cho qua.
      const ma = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((d) => !d.trim().startsWith("//"))
        .join("\n");
      if (ma.includes("requestPermission")) pham.push(f);
    }
    expect(pham).toEqual([]);
  });
});
