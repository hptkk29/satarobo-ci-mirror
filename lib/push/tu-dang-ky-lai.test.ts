// @vitest-environment jsdom
/**
 * `lib/push/tu-dang-ky-lai.ts` — TỰ ĐĂNG KÝ LẠI sau khi đăng nhập (Đợt 6, VIỆC 1).
 *
 * ── CA QUAN TRỌNG NHẤT CỦA CẢ MODULE PUSH ────────────────────────────────────────────────
 * `[PUSH-D6-T03]` khẳng định KHÔNG lượt nào gọi `Notification.requestPermission()`. Ràng buộc đó
 * không sửa được sau: gọi xin quyền ngoài một cú bấm là cách chắc chắn để nhân viên bấm "Chặn"
 * theo phản xạ, và trình duyệt KHÔNG hỏi lại — kênh push của máy đó chết vĩnh viễn và code không
 * có đường lấy lại. Ca đó chạy hàm qua MỌI nhánh rồi mới đếm, chứ không chỉ nhánh vui.
 *
 * ⚠️ `storage-gia`: xem `tests/_helpers/storage-gia.ts`. Không cắm storage dùng được thì
 * `daTatTayOMayNay()` luôn trả `true` (nhánh catch) ⇒ mọi ca dưới đây thoát ở cổng 2 và bộ test
 * XANH mà chẳng kiểm gì.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(admin)/admin/settings/_push-actions", () => ({
  dangKyThietBiAction: vi.fn(async () => ({ ok: true })),
}));

import { khoaCuaDangKyCoKhop, tuDangKyLaiPush } from "./tu-dang-ky-lai";
import { khoaVapidSangBytes } from "./client-key";
import { datTatTay } from "./bo-nho-may";
import { taoCapKhoaVapid } from "./vapid";
import { dangKyThietBiAction } from "@/app/(admin)/admin/settings/_push-actions";
import { camCaHaiKho, camStorage, storageNem, traStorage } from "@/tests/_helpers/storage-gia";

/** Khoá THẬT, sinh bằng đúng bộ sinh của Đợt 1 — không gõ tay chuỗi mẫu. */
const KHOA = taoCapKhoaVapid().publicKey;
/** Khoá THẬT KHÁC — "khoá server vừa xoay", ca mà đăng ký cũ phải bị huỷ. */
const KHOA_CU = taoCapKhoaVapid().publicKey;

/** `session.user.id` — mọi cổng trạng thái khoá theo người, không theo origin. */
const NGUOI = "usr_sale_a";

const EP = "https://fcm.googleapis.com/wp/may-cua-nhan-vien-abc123";
const EP2 = "https://updates.push.services.mozilla.com/wp/may-khac-xyz789";

const ghi = vi.mocked(dangKyThietBiAction);

type SubGia = {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  toJSON: () => unknown;
  unsubscribe: ReturnType<typeof vi.fn>;
};

function subGia(endpoint: string, khoa: string | null): SubGia {
  return {
    endpoint,
    options: {
      applicationServerKey: khoa ? (khoaVapidSangBytes(khoa).buffer as ArrayBuffer) : null,
    },
    toJSON: () => ({ endpoint, keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) } }),
    unsubscribe: vi.fn(async () => true),
  };
}

/**
 * Dựng một `ServiceWorkerRegistration` giả + ghi lại THỨ TỰ các lời gọi.
 *
 * Thứ tự là một phần của hợp đồng: `subscribe()` với `applicationServerKey` khác trong khi đang
 * có đăng ký sẽ bị trình duyệt từ chối, nên `unsubscribe` PHẢI đi trước.
 */
function dungReg(
  opts: { subHienTai?: SubGia | null; subMoi?: SubGia; subscribeNem?: boolean } = {},
) {
  const { subHienTai = null, subMoi = subGia(EP, KHOA), subscribeNem = false } = opts;
  const thuTu: string[] = [];
  const getSubscription = vi.fn(async () => {
    thuTu.push("getSubscription");
    return subHienTai;
  });
  const subscribe = vi.fn(async (o: PushSubscriptionOptionsInit) => {
    thuTu.push("subscribe");
    if (subscribeNem) throw new Error("InvalidStateError");
    void o;
    return subMoi;
  });
  if (subHienTai) {
    subHienTai.unsubscribe = vi.fn(async () => {
      thuTu.push("unsubscribe");
      return true;
    });
  }
  const reg = {
    pushManager: { getSubscription, subscribe },
  } as unknown as ServiceWorkerRegistration;
  return { reg, getSubscription, subscribe, thuTu, subHienTai, subMoi };
}

/** Cấp/thu quyền thông báo. `xinQuyen` là spy mà ca T03 đếm. */
const xinQuyen = vi.fn(async () => "granted" as NotificationPermission);

function datQuyen(q: NotificationPermission | "vang-mat") {
  Object.defineProperty(globalThis, "Notification", {
    value:
      q === "vang-mat"
        ? undefined
        : Object.assign(function () {}, { permission: q, requestPermission: xinQuyen }),
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  camCaHaiKho();
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", KHOA);
  ghi.mockClear();
  ghi.mockImplementation(async () => ({ ok: true }));
  xinQuyen.mockClear();
  datQuyen("granted");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  traStorage();
  vi.restoreAllMocks();
});

describe("[PUSH-D6-T03] cổng quyền — chỉ ĐỌC, TUYỆT ĐỐI không xin", () => {
  it("quyền granted ⇒ dựng đăng ký và GHI lên máy chủ (dòng ACTIVE trở lại)", async () => {
    const { reg, subscribe } = dungReg();
    await expect(tuDangKyLaiPush(reg, NGUOI)).resolves.toBe("DA_GHI");
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(ghi).toHaveBeenCalledTimes(1);
  });

  it.each(["default", "denied"] as const)(
    "quyền %s ⇒ KHÔNG gọi gì cả: không đọc đăng ký, không subscribe, không ghi",
    async (q) => {
      datQuyen(q);
      const { reg, getSubscription, subscribe } = dungReg();
      await expect(tuDangKyLaiPush(reg, NGUOI)).resolves.toBe("CHUA_CAP_QUYEN");
      expect(getSubscription).not.toHaveBeenCalled();
      expect(subscribe).not.toHaveBeenCalled();
      expect(ghi).not.toHaveBeenCalled();
    },
  );

  it("KHÔNG lượt nào gọi requestPermission — kể cả các nhánh lỗi", async () => {
    // Đếm SAU KHI đã đi qua mọi nhánh: nhánh vui, ba trạng thái quyền, khoá lệch, khoá không đọc
    // được, người dùng đã tắt, thiếu khoá, và ca subscribe ném. Chỉ kiểm nhánh vui thì một lời
    // gọi `requestPermission` nằm trong nhánh lỗi sẽ lọt.
    const chay = [
      async () => tuDangKyLaiPush(dungReg().reg, NGUOI),
      async () => {
        datQuyen("default");
        return tuDangKyLaiPush(dungReg().reg, NGUOI);
      },
      async () => {
        datQuyen("denied");
        return tuDangKyLaiPush(dungReg().reg, NGUOI);
      },
      async () => {
        datQuyen("granted");
        return tuDangKyLaiPush(dungReg({ subHienTai: subGia(EP, KHOA_CU) }).reg, NGUOI);
      },
      async () => tuDangKyLaiPush(dungReg({ subHienTai: subGia(EP, null) }).reg, NGUOI),
      async () => {
        datTatTay(NGUOI);
        return tuDangKyLaiPush(dungReg().reg, NGUOI);
      },
      async () => {
        camCaHaiKho();
        vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
        return tuDangKyLaiPush(dungReg().reg, NGUOI);
      },
      async () => {
        vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", KHOA);
        return tuDangKyLaiPush(dungReg({ subscribeNem: true }).reg, NGUOI);
      },
    ];
    const ketCuc: string[] = [];
    for (const f of chay) ketCuc.push(await f());

    expect(xinQuyen).not.toHaveBeenCalled();
    // Và mọi lượt đều CÓ đi tới đâu đó — nếu tất cả cùng thoát ở một cổng thì ca trên xanh vô
    // nghĩa (đó chính là điều xảy ra khi quên cắm `storage-gia`).
    expect(new Set(ketCuc).size).toBeGreaterThan(4);
  });

  it("`Notification` vắng mặt (iOS Safari chưa cài) ⇒ KHONG_HO_TRO, không ném", async () => {
    datQuyen("vang-mat");
    const { reg, getSubscription } = dungReg();
    await expect(tuDangKyLaiPush(reg, NGUOI)).resolves.toBe("KHONG_HO_TRO");
    expect(getSubscription).not.toHaveBeenCalled();
  });

  it("registration không có pushManager ⇒ KHONG_HO_TRO, không ném", async () => {
    const reg = {} as unknown as ServiceWorkerRegistration;
    await expect(tuDangKyLaiPush(reg, NGUOI)).resolves.toBe("KHONG_HO_TRO");
  });
});

describe("[PUSH-D6-T04] cổng 'người dùng đã tự tắt trên máy này'", () => {
  it("đã bấm tắt/gỡ trên máy này ⇒ KHÔNG tự dựng lại", async () => {
    // Thiếu cổng này thì nút "Tắt trên máy này" và nút "Gỡ" thành VÔ NGHĨA: chúng chỉ thu hồi
    // dòng DB, nên lượt tải trang kế tiếp dựng lại đúng thứ người dùng vừa tắt.
    datTatTay(NGUOI);
    const { reg, getSubscription, subscribe } = dungReg();
    await expect(tuDangKyLaiPush(reg, NGUOI)).resolves.toBe("NGUOI_DUNG_DA_TAT");
    expect(getSubscription).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(ghi).not.toHaveBeenCalled();
  });

  it("KHÔNG ĐỌC ĐƯỢC localStorage ⇒ cũng không tự dựng lại (fail-closed)", async () => {
    camStorage("localStorage", storageNem());
    const { reg, subscribe } = dungReg();
    await expect(tuDangKyLaiPush(reg, NGUOI)).resolves.toBe("NGUOI_DUNG_DA_TAT");
    expect(subscribe).not.toHaveBeenCalled();
  });

  it.each(["", null, undefined])(
    "KHÔNG BIẾT người dùng là ai (%s) ⇒ không dựng, không ghi (fail-closed)",
    async (ai) => {
      // Đường tự động tuyệt đối không được ghi bằng một danh tính không rõ: mọi cổng trạng thái
      // khoá theo NGƯỜI, nên một `nguoiDung` rỗng sẽ dùng chung khoá với tất cả — đúng cái lỗ
      // máy-dùng-chung mà bản vá này đóng.
      const { reg, subscribe } = dungReg();
      await expect(tuDangKyLaiPush(reg, ai)).resolves.toBe("NGUOI_DUNG_DA_TAT");
      expect(subscribe).not.toHaveBeenCalled();
      expect(ghi).not.toHaveBeenCalled();
    },
  );

  it("⚠️ CỜ THEO NGƯỜI: A tắt tay thì B trên CÙNG máy vẫn được tự đăng ký", async () => {
    // Khoá theo ORIGIN (bản đầu) nghĩa là một người bấm "Tắt" là bịt miệng mọi người còn lại
    // dùng chung trình duyệt đó, im lặng, trong khi màn hình vẫn hứa "thông báo sẽ tới máy này".
    datTatTay(NGUOI);
    await expect(tuDangKyLaiPush(dungReg().reg, NGUOI)).resolves.toBe("NGUOI_DUNG_DA_TAT");
    await expect(tuDangKyLaiPush(dungReg().reg, "usr_sale_b")).resolves.toBe("DA_GHI");
  });
});

describe("[PUSH-D6-T05] cổng khoá VAPID — nơi dễ đẻ lỗi câm vĩnh viễn nhất", () => {
  it("chưa có đăng ký ⇒ subscribe với userVisibleOnly + ĐÚNG khoá hiện tại", async () => {
    const { reg, subscribe } = dungReg({ subHienTai: null });
    await expect(tuDangKyLaiPush(reg, NGUOI)).resolves.toBe("DA_GHI");
    const o = subscribe.mock.calls[0]![0] as {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    };
    // `userVisibleOnly: true` là ràng buộc của cả việc này — mọi push phải hiện một thông báo.
    expect(o.userVisibleOnly).toBe(true);
    expect(Array.from(o.applicationServerKey)).toEqual(Array.from(khoaVapidSangBytes(KHOA)));
  });

  it("đăng ký cũ KHỚP khoá ⇒ TÁI DÙNG: không huỷ, không đăng ký mới, vẫn ghi", async () => {
    const { reg, subscribe, subHienTai } = dungReg({ subHienTai: subGia(EP, KHOA) });
    await expect(tuDangKyLaiPush(reg, NGUOI)).resolves.toBe("DA_GHI");
    expect(subscribe).not.toHaveBeenCalled();
    expect(subHienTai!.unsubscribe).not.toHaveBeenCalled();
    expect(ghi).toHaveBeenCalledTimes(1);
  });

  it("đăng ký cũ LỆCH khoá ⇒ huỷ TRƯỚC rồi mới đăng ký lại (thứ tự là hợp đồng)", async () => {
    // Nếu tái dùng đăng ký ký bằng khoá CŨ: lời gọi ghi hồi sinh dòng DB (dọn `revokedAt`, đặt
    // `failureCount: 0`) trỏ vào endpoint mà server không ký nổi ⇒ engine nhận 403, mà 403 CỐ Ý
    // không gỡ thiết bị. `/settings` báo "đang nhận" và máy đó không bao giờ nhận gì.
    const { reg, thuTu, subHienTai } = dungReg({ subHienTai: subGia(EP, KHOA_CU) });
    await expect(tuDangKyLaiPush(reg, NGUOI)).resolves.toBe("DA_GHI");
    expect(subHienTai!.unsubscribe).toHaveBeenCalledTimes(1);
    expect(thuTu.indexOf("unsubscribe")).toBeLessThan(thuTu.indexOf("subscribe"));
  });

  it("KHÔNG ĐỌC ĐƯỢC khoá của đăng ký cũ ⇒ không làm gì cả (không huỷ, không ghi)", async () => {
    // Safari cũ không cho đọc `options`. Hai đường kia đều tệ hơn: tái dùng mù là lỗi 403 câm;
    // huỷ-rồi-đăng-ký-lại mỗi lượt tải trang là đẻ một endpoint mới + một dòng mồ côi mỗi lần.
    const { reg, subscribe, subHienTai } = dungReg({ subHienTai: subGia(EP, null) });
    await expect(tuDangKyLaiPush(reg, NGUOI)).resolves.toBe("KHOA_KHONG_DOI_CHIEU_DUOC");
    expect(subHienTai!.unsubscribe).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(ghi).not.toHaveBeenCalled();
  });

  it.each(["", "khong-phai-khoa"])(
    "khoá env sai/rỗng (%s) ⇒ THIEU_KHOA, không subscribe",
    async (k) => {
      vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", k);
      const { reg, subscribe } = dungReg();
      await expect(tuDangKyLaiPush(reg, NGUOI)).resolves.toBe("THIEU_KHOA");
      expect(subscribe).not.toHaveBeenCalled();
      expect(ghi).not.toHaveBeenCalled();
    },
  );

  it("`khoaCuaDangKyCoKhop`: cùng độ dài mà khác một byte ⇒ LỆCH", () => {
    // Hai khoá thật LUÔN dài 65 byte, nên so theo độ dài là cách hỏng dễ viết nhất mà không ca
    // nào khác với tới.
    const a = khoaVapidSangBytes(KHOA);
    const b = new Uint8Array(a);
    b[40] = b[40]! ^ 0xff;
    expect(a.length).toBe(b.length);
    expect(khoaCuaDangKyCoKhop({ options: { applicationServerKey: b.buffer } } as never, a)).toBe(
      false,
    );
    expect(khoaCuaDangKyCoKhop({ options: { applicationServerKey: a.buffer } } as never, a)).toBe(
      true,
    );
    expect(khoaCuaDangKyCoKhop({ options: { applicationServerKey: null } } as never, a)).toBeNull();
  });
});

describe("[PUSH-D6-T06] idempotence theo phiên tab, và KHÔNG BAO GIỜ ném", () => {
  it("hai lượt tải trang cùng một endpoint ⇒ chỉ MỘT lượt gọi máy chủ", async () => {
    // Không có cổng này thì mỗi lượt tải trang cứng là một Server Action + hai `revalidatePath`
    // + một `resolveActor`, tức trả phí ghi cho một việc không đổi gì. Repo đã có một sự cố
    // vượt trần egress vì đúng loại "ghi vô điều kiện ở đường nóng".
    await expect(tuDangKyLaiPush(dungReg({ subHienTai: subGia(EP, KHOA) }).reg, NGUOI)).resolves.toBe(
      "DA_GHI",
    );
    await expect(tuDangKyLaiPush(dungReg({ subHienTai: subGia(EP, KHOA) }).reg, NGUOI)).resolves.toBe(
      "DA_DONG_BO",
    );
    expect(ghi).toHaveBeenCalledTimes(1);
  });

  it("⚠️ MỐC THEO NGƯỜI: A đã đồng bộ E thì B trong CÙNG TAB vẫn phải gọi máy chủ", async () => {
    // CA VÁ MỘT LỖ LÀM RÒ DỮ LIỆU. `sessionStorage` sống qua đăng xuất trong cùng tab, nên mốc
    // khoá theo endpoint đơn sẽ chặn đúng lời gọi tạo nên "lưới thứ hai" của Đợt 5 (chuyển chủ
    // khi người mới đăng ký) ⇒ dòng vẫn thuộc A ⇒ mọi lead của A nổ trên màn hình khoá máy B
    // đang cầm, kèm tên phụ huynh, và B không nhận gì cả ngày.
    await expect(tuDangKyLaiPush(dungReg({ subHienTai: subGia(EP, KHOA) }).reg, NGUOI)).resolves.toBe(
      "DA_GHI",
    );
    await expect(
      tuDangKyLaiPush(dungReg({ subHienTai: subGia(EP, KHOA) }).reg, "usr_sale_b"),
    ).resolves.toBe("DA_GHI");
    expect(ghi).toHaveBeenCalledTimes(2);
  });

  it("endpoint ĐỔI (khoá xoay) ⇒ đồng bộ lại, mốc phiên không chặn", async () => {
    await tuDangKyLaiPush(dungReg({ subHienTai: subGia(EP, KHOA) }).reg, NGUOI);
    await expect(tuDangKyLaiPush(dungReg({ subHienTai: subGia(EP2, KHOA) }).reg, NGUOI)).resolves.toBe(
      "DA_GHI",
    );
    expect(ghi).toHaveBeenCalledTimes(2);
  });

  it("máy chủ TỪ CHỐI ⇒ LOI và KHÔNG đặt mốc ⇒ lượt sau thử lại", async () => {
    ghi.mockImplementation(async () => ({ ok: false, error: "Chưa đăng nhập" }));
    await expect(tuDangKyLaiPush(dungReg({ subHienTai: subGia(EP, KHOA) }).reg, NGUOI)).resolves.toBe(
      "LOI",
    );
    ghi.mockImplementation(async () => ({ ok: true }));
    await expect(tuDangKyLaiPush(dungReg({ subHienTai: subGia(EP, KHOA) }).reg, NGUOI)).resolves.toBe(
      "DA_GHI",
    );
    expect(ghi).toHaveBeenCalledTimes(2);
  });

  it("`subscribe` ném ⇒ LOI, không ném ra ngoài", async () => {
    const { reg } = dungReg({ subHienTai: null, subscribeNem: true });
    await expect(tuDangKyLaiPush(reg, NGUOI)).resolves.toBe("LOI");
  });

  it("Server Action ném ⇒ LOI, không ném ra ngoài", async () => {
    ghi.mockImplementation(async () => {
      throw new Error("mạng chập");
    });
    await expect(tuDangKyLaiPush(dungReg({ subHienTai: subGia(EP, KHOA) }).reg, NGUOI)).resolves.toBe(
      "LOI",
    );
  });
});

describe("[PUSH-D6-T07] hình dạng dữ liệu gửi lên máy chủ", () => {
  it("gửi subscription dạng JSON + userAgent thật; KHÔNG gửi userId/origin/vapidKeyId", async () => {
    // Ba thứ đó server tự suy (phiên · header · khoá của chính nó). Client gửi lên là mở đúng lỗ
    // mà `_push-actions.ts` khai ở đầu tệp.
    await tuDangKyLaiPush(dungReg({ subHienTai: subGia(EP, KHOA) }).reg, NGUOI);
    const input = ghi.mock.calls[0]![0] as Record<string, unknown>;
    expect(input.subscription).toMatchObject({ endpoint: EP });
    expect(input.userAgent).toBe(navigator.userAgent);
    expect(Object.keys(input).sort()).toEqual([
      "displayMode",
      "subscription",
      "tuDong",
      "userAgent",
    ]);
  });

  it("⚠️ gửi `tuDong: true` — cổng thứ NĂM nằm ở máy chủ, không ở client", async () => {
    // Cờ này bắt `dangKyThietBiAction` đòi người này ĐÃ TỪNG bật trên origin này, và cấm hồi sinh
    // một dòng bị thu hồi vì lý do KHÁC "đăng xuất". Hai luật đó không gác được ở client (không
    // có danh tính đáng tin; và cái máy cần chặn thì ta không với tới để cắm cờ). Thiếu cờ ⇒ hai
    // lỗ quay lại: tự ghi danh người đăng nhập SAU trên máy dùng chung, và nút "Gỡ từ xa" tự mọc
    // lại trong vòng một lượt tải trang.
    await tuDangKyLaiPush(dungReg({ subHienTai: subGia(EP, KHOA) }).reg, NGUOI);
    expect((ghi.mock.calls[0]![0] as Record<string, unknown>).tuDong).toBe(true);
  });

  it("⚠️ KHÔNG log endpoint / p256dh / auth ở BẤT KỲ nhánh nào", async () => {
    // Điều luật cứng của cả việc. Và nó không phải phòng xa: Sentry browser đang bật với
    // `replaysOnErrorSampleRate: 1.0` (`instrumentation-client.ts`), nên một dòng `console.warn`
    // mang endpoint là đưa một KHẢ NĂNG GỬI ra ngoài. Trước ca này, hai điểm log trên đường nóng
    // hoàn toàn không bị canh — `vi.spyOn(console, "warn")` chỉ làm IM console.
    const P256 = "p".repeat(87);
    const AUTHK = "a".repeat(22);
    ghi.mockImplementation(async () => ({ ok: false, error: "Chưa đăng nhập" }));
    await tuDangKyLaiPush(dungReg({ subHienTai: subGia(EP, KHOA) }).reg, NGUOI);
    ghi.mockImplementation(async () => {
      throw new Error("mạng chập");
    });
    await tuDangKyLaiPush(dungReg({ subHienTai: subGia(EP2, KHOA) }).reg, NGUOI);
    await tuDangKyLaiPush(dungReg({ subHienTai: null, subscribeNem: true }).reg, NGUOI);
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    await tuDangKyLaiPush(dungReg().reg, NGUOI);
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", KHOA);
    await tuDangKyLaiPush(dungReg({ subHienTai: subGia(EP, null) }).reg, NGUOI);

    const daLog = JSON.stringify(vi.mocked(console.warn).mock.calls);
    // Đối chứng dương: có thật là đã log gì đó, không phải ca xanh vì console im.
    expect(vi.mocked(console.warn).mock.calls.length).toBeGreaterThanOrEqual(5);
    for (const bi_mat of [EP, EP2, P256, AUTHK, "may-cua-nhan-vien", "may-khac-xyz789"]) {
      expect(daLog).not.toContain(bi_mat);
    }
  });

  it("hai nhánh thoát CÂM của cổng khoá đều để lại một dòng log", async () => {
    // Ca thật đang chờ sẵn: người vận hành đặt ba biến VAPID trên Vercel rồi KHÔNG deploy lại —
    // `NEXT_PUBLIC_*` nhúng lúc BUILD, nên đường tự động của cả công ty chết mà không một chữ nào
    // ở đâu. Một cổng không để lại vết là một cổng không ai biết đã đóng.
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    await expect(tuDangKyLaiPush(dungReg().reg, NGUOI)).resolves.toBe("THIEU_KHOA");
    expect(vi.mocked(console.warn).mock.calls.length).toBe(1);

    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", KHOA);
    await expect(
      tuDangKyLaiPush(dungReg({ subHienTai: subGia(EP, null) }).reg, NGUOI),
    ).resolves.toBe("KHOA_KHONG_DOI_CHIEU_DUOC");
    expect(vi.mocked(console.warn).mock.calls.length).toBe(2);
  });

  it("displayMode theo matchMedia: standalone khi đã cài, browser khi chưa", async () => {
    const goc = window.matchMedia;
    try {
      window.matchMedia = ((q: string) =>
        ({ matches: q.includes("standalone") }) as unknown as MediaQueryList);
      await tuDangKyLaiPush(dungReg({ subHienTai: subGia(EP, KHOA) }).reg, NGUOI);
      expect((ghi.mock.calls[0]![0] as Record<string, unknown>).displayMode).toBe("standalone");

      ghi.mockClear();
      window.matchMedia = ((q: string) =>
        ({ matches: false, media: q }) as unknown as MediaQueryList);
      await tuDangKyLaiPush(dungReg({ subHienTai: subGia(EP2, KHOA) }).reg, NGUOI);
      expect((ghi.mock.calls[0]![0] as Record<string, unknown>).displayMode).toBe("browser");
    } finally {
      window.matchMedia = goc;
    }
  });
});
