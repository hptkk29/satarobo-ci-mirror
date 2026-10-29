/**
 * lib/cham-cong/xin-vi-tri.test.ts — canh đúng thứ đã hỏng ngày 16/09/2026: MỖI nguyên nhân
 * phải ra MỘT lý do riêng, không gộp thành "không lấy được vị trí".
 *
 * Không cần trình duyệt thật: `xinViTri` chỉ chạm ba thứ của `window`/`navigator`, nên dựng
 * giả ba thứ đó là chạy được. Ca test vì thế kiểm ĐÚNG luật phân biệt, không kiểm GPS.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { xinViTri, moTaLyDo, type LyDoKhongCoViTri } from "./xin-vi-tri";

type Ket = { coords: { latitude: number; longitude: number; accuracy: number } };

/**
 * Dựng `window` + `navigator` giả.
 *
 * `getCurrentPosition` nhận một hàng đợi kết quả: lượt gọi thứ n lấy phần tử thứ n. Nhờ vậy
 * kiểm được vế "lượt 1 hỏng thì lượt 2 hạ độ chính xác cứu được" — thứ mà một kết quả cố
 * định không kiểm được.
 */
function dungGia(opts: {
  secure?: boolean;
  coGeolocation?: boolean;
  quyen?: PermissionState | "nem";
  hangDoi: Array<Ket | { code: number }>;
}) {
  const goi: PositionOptions[] = [];
  let i = 0;
  const nav = {
    geolocation: opts.coGeolocation === false ? undefined : {
      getCurrentPosition: (ok: (p: unknown) => void, loi: (e: unknown) => void, o?: PositionOptions) => {
        goi.push(o ?? {});
        const r = opts.hangDoi[i++];
        // Trả BẤT ĐỒNG BỘ, đúng như trình duyệt thật — trả đồng bộ thì `Promise.race`
        // với lưới an toàn không bao giờ được thử đúng.
        setTimeout(() => ("coords" in (r as Ket) ? ok(r) : loi(r)), 0);
      },
    },
    permissions:
      opts.quyen === undefined
        ? undefined
        : {
            query: async () => {
              if (opts.quyen === "nem") throw new Error("không đọc được");
              return { state: opts.quyen };
            },
          },
  };
  vi.stubGlobal("window", { isSecureContext: opts.secure !== false });
  vi.stubGlobal("navigator", nav);
  return { goi };
}

const TOA_DO: Ket = { coords: { latitude: 16.05, longitude: 108.22, accuracy: 12 } };

afterEach(() => vi.unstubAllGlobals());

describe("xinViTri — mỗi nguyên nhân MỘT lý do riêng", () => {
  it("lấy được thì trả toạ độ + độ chính xác", async () => {
    dungGia({ quyen: "granted", hangDoi: [TOA_DO] });
    const r = await xinViTri();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.latitude).toBeCloseTo(16.05, 4);
    expect(r.accuracyMeters).toBe(12);
  });

  // ⭐ Đây là ca của chính sự cố: *"không có thông báo hỏi lấy vị trí"*.
  it("TRANG BỊ CHẶN — biết trước, KHÔNG gọi getCurrentPosition, và nói ra cách mở lại", async () => {
    const { goi } = dungGia({ quyen: "denied", hangDoi: [TOA_DO] });
    const r = await xinViTri();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.lyDo).toBe("TRANG_BI_CHAN");
    // Không gọi: gọi vào cũng chỉ rơi vào callback lỗi mà không hiện hộp thoại nào.
    expect(goi).toHaveLength(0);
    // Câu sửa phải nhắc ổ khoá, và phải nói rõ bật GPS trong Cài đặt máy KHÔNG cứu được —
    // đó đúng là thứ người dùng đã làm rồi mà vẫn hỏng.
    expect(r.cachSua).toMatch(/ổ khoá/i);
    expect(r.cachSua).toMatch(/Cài đặt máy KHÔNG/);
  });

  it("KHÔNG HTTPS — bắt TRƯỚC khi gọi, vì ca này cũng không hiện hộp thoại nào", async () => {
    const { goi } = dungGia({ secure: false, quyen: "granted", hangDoi: [TOA_DO] });
    const r = await xinViTri();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.lyDo).toBe("KHONG_HTTPS");
    expect(goi).toHaveLength(0);
    expect(r.cachSua).toMatch(/192\.168/); // nêu đúng hình dạng địa chỉ hay dính
  });

  it("VỪA TỪ CHỐI (mã 1) khác hẳn 'bị chặn từ trước', và KHÔNG hỏi lại lượt hai", async () => {
    const { goi } = dungGia({ quyen: "prompt", hangDoi: [{ code: 1 }, TOA_DO] });
    const r = await xinViTri();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.lyDo).toBe("VUA_TU_CHOI");
    // Chỉ một lượt: hỏi lại ngay sau khi người ta vừa bấm "Không cho phép" là làm phiền.
    expect(goi).toHaveLength(1);
  });

  it("KHÔNG CÓ TÍN HIỆU (mã 2) ⇒ hướng dẫn bật GPS / ra chỗ thoáng", async () => {
    const r = await (dungGia({ quyen: "prompt", hangDoi: [{ code: 2 }, { code: 2 }] }), xinViTri());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.lyDo).toBe("KHONG_CO_TIN_HIEU");
    expect(r.cachSua).toMatch(/GPS/);
  });

  it("GPS quá hạn thì HẠ ĐỘ CHÍNH XÁC và cứu được — trong nhà đây là ca thường gặp", async () => {
    const { goi } = dungGia({ quyen: "prompt", hangDoi: [{ code: 3 }, TOA_DO] });
    const r = await xinViTri();
    expect(r.ok).toBe(true);
    expect(goi).toHaveLength(2);
    // Lượt 1 đòi GPS thật, lượt 2 chấp nhận định vị mạng. Ghim cả hai: đảo thứ tự là mất
    // độ chính xác ở ngoài trời, bỏ lượt 2 là mất hẳn khả năng chấm trong nhà.
    expect(goi[0]!.enableHighAccuracy).toBe(true);
    expect(goi[1]!.enableHighAccuracy).toBe(false);
  });

  it("KHÔNG đọc được trạng thái quyền thì VẪN GỌI, không tự chặn", async () => {
    // `navigator.permissions` không có ở mọi trình duyệt. Không biết ⇒ cứ hỏi, đừng đoán xấu.
    const { goi } = dungGia({ quyen: "nem", hangDoi: [TOA_DO] });
    const r = await xinViTri();
    expect(r.ok).toBe(true);
    expect(goi).toHaveLength(1);
  });

  it("trình duyệt không có geolocation ⇒ lý do riêng, không lẫn với bị chặn", async () => {
    const r = await (dungGia({ coGeolocation: false, hangDoi: [] }), xinViTri());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.lyDo).toBe("TRINH_DUYET_KHONG_HO_TRO");
  });
});

describe("moTaLyDo — mọi lý do đều phải có câu chữ, không lý do nào rơi ra trống", () => {
  const TAT_CA: LyDoKhongCoViTri[] = [
    "KHONG_HTTPS",
    "TRINH_DUYET_KHONG_HO_TRO",
    "TRANG_BI_CHAN",
    "VUA_TU_CHOI",
    "KHONG_CO_TIN_HIEU",
    "QUA_HAN",
  ];

  it("mỗi lý do có câu lỗi riêng, không trùng nhau", () => {
    const loi = TAT_CA.map((l) => moTaLyDo(l).loi);
    expect(loi.every((x) => x.length > 10)).toBe(true);
    // Trùng câu chữ = quay về đúng cái bug đang vá: nhiều nguyên nhân, một thông báo.
    expect(new Set(loi).size).toBe(TAT_CA.length);
  });

  it("bốn lý do người dùng TỰ SỬA ĐƯỢC đều phải có `cachSua`", () => {
    for (const l of ["KHONG_HTTPS", "TRANG_BI_CHAN", "VUA_TU_CHOI", "KHONG_CO_TIN_HIEU"] as const) {
      expect(moTaLyDo(l).cachSua, l).toBeTruthy();
    }
  });
});
