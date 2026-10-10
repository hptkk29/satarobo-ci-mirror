// @vitest-environment node
/**
 * `GET /dang-xuat` — lối thoát cho phiên đã chết, nay kèm thu hồi đăng ký push (US-14b Đợt 5).
 *
 * Bất biến pin ở đây:
 *  • ⚠️ `?reason=` KHÔNG PHẢI BẰNG CHỨNG. Bản đầu của Đợt 5 tin nó và lăng kính tìm ra: cookie
 *    phiên khai `sameSite: "lax"`, nên một ĐIỀU HƯỚNG TOP-LEVEL (link trong tin nhắn) tới
 *    `/dang-xuat?reason=session-disabled` mang cookie đi theo ⇒ nạn nhân mất push trên MỌI máy
 *    dù tài khoản còn sống. Không cần kẻ tấn công cũng chạm được: route `force-dynamic`, nên
 *    sau khi bị đá ra rồi đăng nhập lại, bấm Back hai nhịp là gọi lại GET này với cookie MỚI.
 *  • ⚠️ QUYẾT ĐỊNH "tài khoản đã chết" nằm TRỌN trong `thuHoiNeuTaiKhoanChet` — route KHÔNG tự
 *    suy. Bản trước dùng `checkSessionLiveness`, và đó là một lỗ thứ hai: hàm đó trả CÙNG nhãn
 *    cho "bị xoá" và cho "`tokenVersion` lệch", mà bump `tokenVersion` là thao tác thường ngày
 *    (đổi vai, cấp quyền — 9 nơi) ⇒ cấp thêm một quyền cho một Sale là gỡ sạch push của họ.
 *  • `auth()` phải đọc TRƯỚC `signOut()`. Sau `signOut` cookie đã dọn, không còn cách nào biết
 *    vừa thu hồi cho ai — và lỗi đó sẽ IM LẶNG.
 *  • Cổng chạy cho MỌI lượt ghé, không chỉ khi có `reason`: nút đăng xuất của site Sale
 *    (`components/sale/sale-nav.tsx`) trỏ `/dang-xuat` KHÔNG kèm reason.
 *  • `reason` lạ vẫn phải bị lọc khỏi URL đích (danh sách trắng có từ trước, đừng làm hỏng).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  const thuTu: string[] = [];
  return {
    thuTu,
    auth: vi.fn(async () => null as { user?: { id?: string } } | null),
    signOut: vi.fn(async (_o: { redirect: boolean }) => {}),
    thuHoi: vi.fn(async (_p: { userId: string }) => ({ chet: false, soDong: 0 })),
  };
});

vi.mock("@/lib/auth", () => ({ auth: h.auth, signOut: h.signOut }));
vi.mock("@/lib/push/thu-hoi", () => ({ thuHoiNeuTaiKhoanChet: h.thuHoi }));

import { GET } from "./route";

function req(qs = ""): NextRequest {
  return new NextRequest(`https://admin.satarobo.vn/dang-xuat${qs}`);
}

/**
 * Đặt lại implementation. KHÔNG dùng `mockResolvedValue`: nó ĐÈ implementation, làm nhật ký
 * thứ tự (`thuTu`) rỗng và mọi khẳng định về thứ tự thành `-1 < -1`.
 */
function datLai(opts: { phien?: { user?: { id?: string } } | null; chet?: boolean } = {}) {
  const phien = opts.phien === undefined ? { user: { id: "usr_a" } } : opts.phien;
  const chet = opts.chet ?? false;
  h.thuTu.length = 0;
  h.auth.mockClear().mockImplementation(async () => {
    h.thuTu.push("auth");
    return phien;
  });
  h.signOut.mockClear().mockImplementation(async () => {
    h.thuTu.push("signOut");
  });
  h.thuHoi.mockClear().mockImplementation(async () => {
    h.thuTu.push("thuHoi");
    return { chet, soDong: chet ? 2 : 0 };
  });
}

beforeEach(() => datLai());

describe("[PUSH-D5-T02] mọi lượt đăng xuất đều HỎI, và chỉ hỏi bằng userId của PHIÊN", () => {
  it("gọi cổng thu hồi với userId từ phiên, TRƯỚC signOut", async () => {
    datLai({ chet: true });
    const res = await GET(req("?reason=session-disabled"));
    expect(h.thuHoi).toHaveBeenCalledTimes(1);
    expect(h.thuHoi.mock.calls[0]?.[0]).toEqual({ userId: "usr_a" });
    // Vẫn phải làm đúng việc cũ: dọn cookie rồi 303 về /login kèm lý do (để form hiện thông báo).
    expect(h.signOut).toHaveBeenCalledWith({ redirect: false });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("reason=session-disabled");
  });

  it("KHÔNG có reason cũng VẪN hỏi (đóng đường nút của site Sale)", async () => {
    // `components/sale/sale-nav.tsx` là `<a href="/dang-xuat">` không kèm reason. Nếu cổng chỉ
    // chạy khi có reason thì đường đó không nửa nào thu hồi.
    datLai({ chet: true });
    await GET(req());
    expect(h.thuHoi).toHaveBeenCalledTimes(1);
  });

  it("ĐỌC PHIÊN + HỎI TRƯỚC KHI signOut — đảo thứ tự là thu hồi cho `undefined`, im lặng", async () => {
    datLai({ chet: true });
    await GET(req("?reason=session-disabled"));
    expect(h.thuTu.indexOf("auth")).toBeGreaterThanOrEqual(0);
    expect(h.thuTu.indexOf("auth")).toBeLessThan(h.thuTu.indexOf("signOut"));
    expect(h.thuTu.indexOf("thuHoi")).toBeLessThan(h.thuTu.indexOf("signOut"));
  });
});

describe("[PUSH-D5-T03] route KHÔNG tự suy 'tài khoản đã chết'", () => {
  it("⚠️ URL khai reason=session-disabled mà cổng nói CÒN SỐNG ⇒ route không làm gì thêm", async () => {
    // `reason` là tham số URL, ai cũng đặt được, và cookie `sameSite: "lax"` mang theo trong
    // điều hướng top-level. Route KHÔNG được suy gì từ nó — quyết định nằm trọn ở cổng.
    datLai({ chet: false });
    const res = await GET(req("?reason=session-disabled"));
    expect(h.thuHoi).toHaveBeenCalledTimes(1); // vẫn HỎI
    expect(res.status).toBe(303); // vẫn đăng xuất bình thường
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });

  it("route KHÔNG truyền `reason` xuống cổng — truyền là để URL quyết định lần nữa", async () => {
    // Ca này khoá đúng hình dạng đã sửa: bản đầu truyền `lyDo: reason as LyDoThuHoiPush`.
    datLai({ chet: true });
    await GET(req("?reason=session-invalidated"));
    expect(Object.keys(h.thuHoi.mock.calls[0]?.[0] ?? {})).toEqual(["userId"]);
  });

  it("reason LẠ ⇒ không lọt vào URL đích, và vẫn đăng xuất", async () => {
    datLai({ chet: true });
    const res = await GET(req("?reason=" + encodeURIComponent("https://evil.example/x")));
    expect(res.headers.get("location")).not.toContain("evil.example");
    expect(res.headers.get("location")).not.toContain("reason=");
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });
});

describe("[PUSH-D5-T03b] hỏng ở đâu cũng KHÔNG được giam người dùng", () => {
  it("phiên đã mất hẳn (auth trả null) ⇒ không hỏi cổng, vẫn dọn cookie và điều hướng", async () => {
    datLai({ phien: null });
    const res = await GET(req("?reason=session-disabled"));
    expect(h.thuHoi).not.toHaveBeenCalled();
    expect(h.signOut).toHaveBeenCalled();
    expect(res.status).toBe(303);
  });

  it("cổng thu hồi NÉM ⇒ vẫn đăng xuất và vẫn điều hướng", async () => {
    // `thuHoiNeuTaiKhoanChet` cam kết không ném, nhưng route không được phụ thuộc lời cam kết
    // đó: nó tồn tại để CỨU người khỏi vòng lặp `ERR_TOO_MANY_REDIRECTS`, và một lỗi lọt ra
    // ngoài sẽ giam họ lại trong đúng cái vòng lặp đó.
    datLai();
    h.thuHoi.mockImplementation(async () => {
      throw new Error("pooler chập");
    });
    const res = await GET(req("?reason=session-disabled"));
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(303);
  });
});
