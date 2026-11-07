// Service worker `public/sw.js` — test CHÍNH FILE THẬT, không chép lại logic.
//
// Vì sao làm kiểu này: `sw.js` là script trình duyệt, không qua bundler nên không `import` được.
// Cách thường thấy là chép logic sang một module rồi test bản chép — nhưng khi đó thứ chạy trên
// máy nhân viên và thứ được test là hai file khác nhau, và chúng sẽ lệch nhau đúng lúc không ai
// nhìn. Ở đây test đọc file thật rồi chạy nó trong một `self` giả, nên mọi khẳng định dưới đây
// nói về đúng những byte sẽ được phục vụ.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const ORIGIN = "https://admin.satarobo.vn";

type Listener = (event: unknown) => void;

/** Nạp `public/sw.js` vào một môi trường service worker giả. */
function napSw() {
  const src = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");

  const listeners: Record<string, Listener> = {};
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => ({}));
  const claim = vi.fn(async () => undefined);
  const skipWaiting = vi.fn();
  let danhSachTab: unknown[] = [];

  const selfGia = {
    addEventListener: (loai: string, fn: Listener) => {
      listeners[loai] = fn;
    },
    registration: { showNotification },
    clients: {
      matchAll: vi.fn(async () => danhSachTab),
      openWindow,
      claim,
    },
    location: { origin: ORIGIN },
    skipWaiting,
  };

  vm.runInContext(src, vm.createContext({ self: selfGia, console }));

  return {
    listeners,
    showNotification,
    openWindow,
    claim,
    skipWaiting,
    datTab: (ds: unknown[]) => {
      danhSachTab = ds;
    },
  };
}

/** Sự kiện `push` giả. `data` = undefined nghĩa là push KHÔNG kèm payload. */
function suKienPush(data?: { json: () => unknown }) {
  const cho: Promise<unknown>[] = [];
  return {
    event: { data, waitUntil: (p: Promise<unknown>) => cho.push(p) },
    xong: () => Promise.all(cho),
  };
}

function suKienBam(url?: string) {
  const cho: Promise<unknown>[] = [];
  const close = vi.fn();
  return {
    close,
    event: {
      notification: { close, data: url === undefined ? undefined : { url } },
      waitUntil: (p: Promise<unknown>) => cho.push(p),
    },
    xong: () => Promise.all(cho),
  };
}

describe("[PUSH-SW-T01] mọi push đều PHẢI hiện thông báo", () => {
  it("payload đầy đủ → hiện đúng tiêu đề, nội dung, đường dẫn, tag", async () => {
    const sw = napSw();
    const p = suKienPush({
      json: () => ({
        title: "Bạn có lead mới",
        body: 'Lead "Chị Lan" vừa được chia cho bạn.',
        url: "/leads/abc",
        tag: "lead.moi",
      }),
    });
    sw.listeners.push?.(p.event);
    await p.xong();

    expect(sw.showNotification).toHaveBeenCalledTimes(1);
    const [title, opts] = sw.showNotification.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(title).toBe("Bạn có lead mới");
    expect(opts.body).toBe('Lead "Chị Lan" vừa được chia cho bạn.');
    expect(opts.tag).toBe("lead.moi");
    expect(opts.data).toEqual({ url: "/leads/abc" });
  });

  it("push KHÔNG kèm payload → VẪN hiện thông báo mặc định", async () => {
    // Luật cứng của đợt này: không có push im lặng (userVisibleOnly). Trình duyệt phạt việc
    // nhận push mà không hiện gì — Chrome tự chèn "This site has been updated in the
    // background", và sau vài lần thì thu hồi quyền. Tức một payload rỗng có thể giết cả kênh.
    const sw = napSw();
    const p = suKienPush(undefined);
    sw.listeners.push?.(p.event);
    await p.xong();

    expect(sw.showNotification).toHaveBeenCalledTimes(1);
    const [title] = sw.showNotification.mock.calls[0] as unknown as [string];
    expect(title).toBe("Sata Robo");
  });

  it("payload là JSON HỎNG → vẫn hiện, không ném", async () => {
    const sw = napSw();
    const p = suKienPush({
      json: () => {
        throw new Error("Unexpected token");
      },
    });
    expect(() => sw.listeners.push?.(p.event)).not.toThrow();
    await p.xong();
    expect(sw.showNotification).toHaveBeenCalledTimes(1);
  });

  it("payload đúng JSON nhưng SAI KIỂU (mảng / số / null) → rơi về mặc định", async () => {
    for (const rac of [[1, 2, 3], 42, null, "chuỗi trần"]) {
      const sw = napSw();
      const p = suKienPush({ json: () => rac });
      sw.listeners.push?.(p.event);
      await p.xong();
      const [title, opts] = sw.showNotification.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
      ];
      expect(title).toBe("Sata Robo");
      expect(opts.data).toEqual({ url: "/" });
    }
  });

  it("trường rỗng cũng rơi về mặc định, không hiện tiêu đề trống", async () => {
    const sw = napSw();
    const p = suKienPush({ json: () => ({ title: "", body: "", url: "" }) });
    sw.listeners.push?.(p.event);
    await p.xong();
    const [title, opts] = sw.showNotification.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(title).toBe("Sata Robo");
    expect(opts.body).toBe("Bạn có thông báo mới.");
  });

  it("hai loại thông báo khác nhau mang tag khác nhau — không đè lên nhau", async () => {
    // `lead.moi` và `lead.nhap_lai` là hai việc khác nhau. Gộp chung một tag là cái sau
    // nuốt mất cái trước ngay trên màn hình khoá.
    const sw = napSw();
    for (const tag of ["lead.moi", "lead.nhap_lai"]) {
      const p = suKienPush({ json: () => ({ title: "x", tag }) });
      sw.listeners.push?.(p.event);
      await p.xong();
    }
    const tags = sw.showNotification.mock.calls.map(
      (c) => (c as unknown as [string, Record<string, unknown>])[1].tag,
    );
    expect(tags).toEqual(["lead.moi", "lead.nhap_lai"]);
  });
});

describe("[PUSH-SW-T02] bấm vào thông báo", () => {
  it("có tab cùng origin đang mở → focus tab đó, KHÔNG mở cửa sổ mới", async () => {
    const focus = vi.fn(async () => ({}));
    const navigate = vi.fn(async () => ({}));
    const sw = napSw();
    sw.datTab([{ url: `${ORIGIN}/dashboard`, focus, navigate }]);

    const b = suKienBam("/leads/abc");
    sw.listeners.notificationclick?.(b.event);
    await b.xong();

    expect(focus).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/leads/abc");
    expect(sw.openWindow).not.toHaveBeenCalled();
  });

  it("không có tab nào → mở cửa sổ mới đúng deep link", async () => {
    const sw = napSw();
    sw.datTab([]);
    const b = suKienBam("/leads/abc");
    sw.listeners.notificationclick?.(b.event);
    await b.xong();
    expect(sw.openWindow).toHaveBeenCalledWith("/leads/abc");
  });

  it("chỉ có tab của origin KHÁC → mở cửa sổ mới, không cướp tab người ta", async () => {
    const focus = vi.fn(async () => ({}));
    const sw = napSw();
    sw.datTab([{ url: "https://vi-du.khac/abc", focus }]);
    const b = suKienBam("/leads/abc");
    sw.listeners.notificationclick?.(b.event);
    await b.xong();
    expect(focus).not.toHaveBeenCalled();
    expect(sw.openWindow).toHaveBeenCalledWith("/leads/abc");
  });

  it("tab không hỗ trợ navigate → vẫn focus, không ném", async () => {
    const focus = vi.fn(async () => ({}));
    const sw = napSw();
    sw.datTab([{ url: `${ORIGIN}/x`, focus }]);
    const b = suKienBam("/leads/abc");
    expect(() => sw.listeners.notificationclick?.(b.event)).not.toThrow();
    await b.xong();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("navigate ném lỗi → nuốt, vẫn focus", async () => {
    const focus = vi.fn(async () => ({}));
    const navigate = vi.fn(() => {
      throw new Error("không cho điều hướng");
    });
    const sw = napSw();
    sw.datTab([{ url: `${ORIGIN}/x`, focus, navigate }]);
    const b = suKienBam("/leads/abc");
    sw.listeners.notificationclick?.(b.event);
    await b.xong();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("thông báo thiếu data.url → vẫn mở được trang chủ, không ném", async () => {
    const sw = napSw();
    sw.datTab([]);
    const b = suKienBam(undefined);
    sw.listeners.notificationclick?.(b.event);
    await b.xong();
    expect(sw.openWindow).toHaveBeenCalledWith("/");
  });

  it("luôn đóng thông báo sau khi bấm", async () => {
    const sw = napSw();
    sw.datTab([]);
    const b = suKienBam("/leads/abc");
    sw.listeners.notificationclick?.(b.event);
    await b.xong();
    expect(b.close).toHaveBeenCalledTimes(1);
  });
});

describe("[PUSH-SW-T03] vòng đời worker", () => {
  it("install gọi skipWaiting, activate gọi clients.claim", async () => {
    const sw = napSw();
    sw.listeners.install?.({});
    expect(sw.skipWaiting).toHaveBeenCalledTimes(1);

    const cho: Promise<unknown>[] = [];
    sw.listeners.activate?.({ waitUntil: (p: Promise<unknown>) => cho.push(p) });
    await Promise.all(cho);
    expect(sw.claim).toHaveBeenCalledTimes(1);
  });

  it("KHÔNG đăng ký handler fetch — worker này không cache gì", () => {
    // Thêm cache vào service worker là nhận nguyên một lớp lỗi mới (phục vụ bản cũ sau deploy)
    // để đổi lấy thứ không ai yêu cầu. Test này khoá phạm vi đó lại.
    const sw = napSw();
    expect(sw.listeners.fetch).toBeUndefined();
  });
});
