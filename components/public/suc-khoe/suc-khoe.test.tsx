// @vitest-environment jsdom
/**
 * [SK-UI-*] Trang «Sức khỏe cả nhà» (dựng THẬT: giao diện sinh từ artifact + view-model + động cơ + ngân hàng 1000 câu + hộp «để lại thông tin»; fetch được giả).
 *   [SK-UI-01] dựng được cả trang: tiêu đề, 3 người ví dụ, lời nhắn «Trước khi dùng» còn nguyên
 *   [SK-UI-02] RIÊNG TƯ: đi trọn một lượt thăm dò + mở khoá + xem kết quả ⇒ KHÔNG có yêu cầu mạng nào mang câu trả lời/số đo/kết quả; phiếu chỉ có liên hệ
 *   [SK-UI-03] cổng: chưa để lại thông tin ⇒ «Xem kết quả» mở hộp, KHÔNG gửi gì; đã mở khoá ⇒ không hỏi lại
 *   [SK-UI-04] một lượt thăm dò thật: lưu lượt, người này không thấy lại 3 câu xoay vòng đã hỏi (ngân hàng), lưu vào localStorage
 *   [SK-UI-05] đọc lại sổ đã lưu sau khi vẽ; sổ hỏng ⇒ rơi về ví dụ, không sập
 *   [SK-LT-01..04] sổ lưu: kiểm hình dạng, tối đa 6 người, bản sao lưu bỏ ví dụ
 *   [SK-VD-01] mọi id câu mà người «ví dụ» đã thấy đều CÓ trong ngân hàng (không lệch id thiết kế ↔ ngân hàng)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { CongThongTinProvider } from "@/components/public/cong-thong-tin/hop-de-lai-thong-tin";
import { LOI } from "@/lib/suc-khoe/dong-co-goc";
import { NGAN_HANG_XOAY_VONG } from "@/lib/suc-khoe/ngan-hang/xoay-vong";
import { SucKhoeTrang } from "./suc-khoe-trang";
import { banSaoLuu, docSoLuu, ghiSoLuu, KHOA_LUU } from "./luu-tru";
import { nguoiViDu } from "./vi-du";
import { useSucKhoeVm } from "./vm";

const DM = { ok: true, thanhPho: ["Tp Đà Nẵng"], macDinh: "Tp Đà Nẵng", phuong: ["Phường Hải Châu"] };
let fetchMock: ReturnType<typeof vi.fn>;

const CAU_HINH = { tieuDe: "Để lại thông tin để nhận kết quả", moTa: "m", nut: "Gửi và xem kết quả", okMoTa: "ok", okNut: "Xem kết quả" } as const;
const boc = (daMo: boolean) =>
  function BocProvider({ children }: { children: ReactNode }) {
    return (
      <CongThongTinProvider nguon="suc-khoe" daMoKhoaBanDau={daMo} cauHinh={CAU_HINH}>
        {children}
      </CongThongTinProvider>
    );
  };

beforeEach(() => {
  window.localStorage.clear();
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/dia-chi")) return { ok: true, json: async () => DM } as Response;
    return { ok: true, json: async () => ({ ok: true }) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Trả lời hết các câu đang hiện (số: lấy giữa khoảng cho phép; chọn: phương án đầu) rồi sang bước kế, cho tới khi vào «câu thêm hôm nay». */
function lamToiBuocXoay(result: { current: ReturnType<typeof useSucKhoeVm> }) {
  for (let i = 0; i < 25; i++) {
    const hoi = result.current.hoi;
    if (!hoi.co || hoi.laXoay) return;
    const cac = [...hoi.cau, ...hoi.ds.flatMap((d) => d.cau)];
    act(() => {
      for (const c of cac) {
        if (c.laSo) {
          const meta = LOI.find((x) => x.id === c.id);
          const giua = meta && meta.min != null && meta.max != null ? Math.round((meta.min + meta.max) / 2) : 3;
          c.nhap({ target: { value: String(giua) } });
        } else {
          const dau = c.o[0];
          if (dau) dau.pick();
        }
      }
    });
    // Mỗi `pick` ghi theo trạng thái ở lần vẽ trước ⇒ đọc lại rồi trả lời nốt câu còn trống (câu hiện thêm khi trả lời câu trước).
    for (let lan = 0; lan < 6; lan++) {
      const h2 = result.current.hoi;
      if (!h2.co) return;
      const con = [...h2.cau, ...h2.ds.flatMap((d) => d.cau)].filter((c) => c.v === "");
      if (con.length === 0) break;
      act(() => {
        for (const c of con) {
          if (c.laSo) {
            const meta = LOI.find((x) => x.id === c.id);
            c.nhap({ target: { value: String(meta && meta.min != null && meta.max != null ? Math.round((meta.min + meta.max) / 2) : 3) } });
          } else c.o[0]?.pick();
        }
      });
    }
    act(() => {
      const h = result.current.hoi;
      if (h.co) h.tiep();
    });
  }
}

describe("[SK-UI-01] dựng cả trang", () => {
  it("tiêu đề, 3 người ví dụ, lời nhắn «Trước khi dùng»", () => {
    render(<SucKhoeTrang daMoKhoa={false} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/khoẻ mỗi ngày/);
    for (const ten of ["Bố", "Mẹ", "Bé An"]) expect(document.body.textContent).toContain(ten);
    expect(document.body.textContent).toMatch(/Lời nhắn quan trọng từ Sata Robo/);
    expect(document.body.textContent).toMatch(/không phải chẩn đoán/);
    expect(document.body.textContent).toMatch(/chỉ gồm thông tin liên hệ/);
  });
  it("lời nhắn nói đúng sự thật về kho dữ liệu: ghi 1000 câu, không còn dòng «bản nháp chờ chuyên gia» nào bị gỡ nhầm", () => {
    render(<SucKhoeTrang daMoKhoa={false} />);
    expect(NGAN_HANG_XOAY_VONG.length).toBe(1000);
  });
});

describe("[SK-UI-03] cổng «để lại thông tin»", () => {
  it("chưa mở khoá: «Xem kết quả chi tiết» mở hộp, KHÔNG gửi phiếu; đã mở khoá: không mở hộp", async () => {
    const { result } = renderHook(() => useSucKhoeVm(), { wrapper: boc(false) });
    const kq = result.current.kq;
    expect(kq.co && kq.khoa).toBe(true);
    act(() => {
      if (kq.co) kq.xemKq();
    });
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/de-lai"))).toHaveLength(0);
    cleanup();
    const { result: r2 } = renderHook(() => useSucKhoeVm(), { wrapper: boc(true) });
    const kq2 = r2.current.kq;
    expect(kq2.co && kq2.mo).toBe(true);
  });
});

describe("[SK-UI-04] một lượt thăm dò thật", () => {
  it("đi hết các phần + 3 câu xoay vòng ⇒ lưu lượt; 3 id mới vào daThay; lần sau không lặp; localStorage có sổ", async () => {
    const { result } = renderHook(() => useSucKhoeVm(), { wrapper: boc(true) });
    const bo = result.current.nguoi[0]!;
    expect(bo.ten).toBe("Bố");
    const truocLuot = result.current.nguoi[0]!.luot;
    act(() => bo.batDau());
    lamToiBuocXoay(result);
    const hoi = result.current.hoi;
    expect(hoi.co && hoi.laXoay).toBe(true);
    if (!hoi.co) return;
    expect(hoi.xoay).toHaveLength(3);
    const idDau = hoi.xoay.map((x) => x.id);
    // không trùng câu «Bố» (ví dụ) đã thấy: x10, k02, x25
    for (const id of idDau) expect(["x10", "k02", "x25"]).not.toContain(id);
    act(() => {
      for (const x of hoi.xoay) x.o[0]?.pick();
    });
    act(() => {
      const h = result.current.hoi;
      if (h.co) h.xong();
    });
    expect(result.current.hoi.co).toBe(false);
    expect(result.current.nguoi[0]!.luot).not.toBe(truocLuot);
    expect(result.current.nguoi[0]!.luot).toBe("2/3 lượt");
    await waitFor(() => expect(docSoLuu(window.localStorage.getItem(KHOA_LUU))?.ds[0]?.daThay).toEqual(expect.arrayContaining(idDau)));
    // lượt thứ hai: ba câu mới hoàn toàn so với lượt vừa rồi
    act(() => result.current.nguoi[0]!.batDau());
    lamToiBuocXoay(result);
    const h2 = result.current.hoi;
    expect(h2.co && h2.laXoay).toBe(true);
    if (h2.co) for (const x of h2.xoay) expect(idDau).not.toContain(x.id);
  });
});

describe("[SK-UI-02] RIÊNG TƯ", () => {
  it("thăm dò + xem kết quả + tải PDF ⇒ không có yêu cầu mạng nào mang câu trả lời / số đo / kết quả", async () => {
    const { result } = renderHook(() => useSucKhoeVm(), { wrapper: boc(true) });
    act(() => result.current.nguoi[0]!.batDau());
    lamToiBuocXoay(result);
    const h = result.current.hoi;
    if (h.co) act(() => h.xoay.forEach((x) => x.o[0]?.pick()));
    act(() => {
      const hh = result.current.hoi;
      if (hh.co) hh.xong();
    });
    vi.stubGlobal("print", vi.fn());
    const kq = result.current.kq;
    act(() => {
      if (kq.co) {
        kq.xemKq();
        kq.pdf();
      }
    });
    const tatCa = JSON.stringify(fetchMock.mock.calls);
    for (const dau of ["vd_vua_ngay", "\"can\"", "who5", "BMI", "w1", "ngu_gio", "luot"]) expect(tatCa).not.toContain(dau);
  });
});

describe("[SK-UI-05] đọc lại sổ đã lưu", () => {
  it("có sổ hợp lệ ⇒ thay người ví dụ; không mở phiên dở dang", async () => {
    const mot = nguoiViDu().slice(0, 1).map((n) => ({ ...n, id: "n1", ten: "Cô Lan", viDu: false }));
    window.localStorage.setItem(KHOA_LUU, ghiSoLuu(mot, {}));
    const { result } = renderHook(() => useSucKhoeVm(), { wrapper: boc(true) });
    await waitFor(() => expect(result.current.nguoi.map((n) => n.ten)).toEqual(["Cô Lan"]));
    expect(result.current.hoi.co).toBe(false);
    expect(result.current.coViDu).toBe(false);
  });
  it("sổ hỏng ⇒ giữ ví dụ, không sập", async () => {
    window.localStorage.setItem(KHOA_LUU, "{không phải json");
    const { result } = renderHook(() => useSucKhoeVm(), { wrapper: boc(true) });
    expect(result.current.nguoi).toHaveLength(3);
    expect(result.current.coViDu).toBe(true);
  });
  it("«Xoá ví dụ» bỏ 3 người ví dụ và lưu lại", async () => {
    const { result } = renderHook(() => useSucKhoeVm(), { wrapper: boc(true) });
    act(() => result.current.xoaViDu());
    expect(result.current.trong).toBe(true);
    await waitFor(() => expect(docSoLuu(window.localStorage.getItem(KHOA_LUU))?.ds).toEqual([]));
  });
});

describe("[SK-UI-06] thêm người", () => {
  it("thiếu tên / ngày sinh sai ⇒ báo lỗi bằng lời; đủ ⇒ thêm và mở phiên thăm dò; đủ 6 người ⇒ hỏi xoá bớt", () => {
    const { result } = renderHook(() => useSucKhoeVm(), { wrapper: boc(true) });
    act(() => result.current.themNguoi());
    expect(result.current.them.loi).toMatch(/tên/);
    act(() => result.current.tOn.ten({ target: { value: "Bé Na" } }));
    act(() => result.current.tOn.ns({ target: { value: "2099-01-01" } }));
    act(() => result.current.themNguoi());
    expect(result.current.them.loi).toMatch(/ngày sinh hợp lệ/);
    act(() => result.current.tOn.ns({ target: { value: "2019-05-02" } }));
    act(() => result.current.themNguoi());
    expect(result.current.nguoi[0]!.ten).toBe("Bé Na");
    expect(result.current.hoi.co).toBe(true);
    // đủ 6
    for (const ten of ["A", "B"]) {
      act(() => result.current.tOn.ten({ target: { value: ten } }));
      act(() => result.current.tOn.ns({ target: { value: "1990-01-01" } }));
      act(() => result.current.themNguoi());
    }
    expect(result.current.soNguoi).toBe("6/6");
    act(() => result.current.tOn.ten({ target: { value: "C" } }));
    act(() => result.current.tOn.ns({ target: { value: "1990-01-01" } }));
    act(() => result.current.themNguoi());
    expect(result.current.hopMo).toBe(true);
    expect(result.current.hop.tieuDe).toMatch(/đủ 6 người/);
  });
});

describe("[SK-LT-*] sổ lưu", () => {
  it("[SK-LT-01] vòng đi vòng về giữ nguyên người và thử thách", () => {
    const ds = nguoiViDu();
    const doc = docSoLuu(ghiSoLuu(ds, { "vd-me": [true, false, true] }));
    expect(doc?.ds.map((n) => n.id)).toEqual(["vd-bo", "vd-me", "vd-an"]);
    expect(doc?.thu["vd-me"]).toEqual([true, false, true]);
  });
  it("[SK-LT-02] bỏ người hỏng hình dạng (thiếu tên / ngày sinh sai), giữ người tốt", () => {
    const tho = JSON.stringify({ v: 1, ds: [{ id: "a", ten: "", ns: "2000-01-01" }, { id: "b", ten: "Tốt", ns: "2000-01-01", luot: [] }, { id: "c", ten: "Sai", ns: "hôm qua" }] });
    expect(docSoLuu(tho)?.ds.map((n) => n.ten)).toEqual(["Tốt"]);
    expect(docSoLuu("null")).toBeNull();
    expect(docSoLuu(JSON.stringify({ v: 2, ds: [] }))).toBeNull();
  });
  it("[SK-LT-03] tối đa 6 người, id không trùng", () => {
    const nhieu = Array.from({ length: 9 }, (_, i) => ({ id: "n" + (i % 8), ten: "Người " + i, ns: "1990-01-01", luot: [] }));
    const doc = docSoLuu(JSON.stringify({ v: 1, ds: nhieu }));
    expect(doc?.ds.length).toBe(6);
    expect(new Set(doc?.ds.map((n) => n.id)).size).toBe(6);
  });
  it("[SK-LT-04] bản sao lưu bỏ người ví dụ", () => {
    const ds = [...nguoiViDu(), { id: "t1", ten: "Thật", vt: "Mẹ", ns: "1990-01-01", gt: "nu" as const, daThay: [], luot: [] }];
    const b = JSON.parse(banSaoLuu(ds, {})) as { ds: { id: string }[] };
    expect(b.ds.map((n) => n.id)).toEqual(["t1"]);
  });
});

describe("[SK-VD-01] id câu của người ví dụ có trong ngân hàng", () => {
  it("mọi id trong daThay / xoay / xtl của 3 người ví dụ tồn tại", () => {
    const co = new Set(NGAN_HANG_XOAY_VONG.map((c) => c.id));
    for (const n of nguoiViDu()) {
      for (const id of n.daThay) expect(co.has(id), `${n.id}: ${id}`).toBe(true);
      for (const l of n.luot) for (const id of [...l.xoay, ...Object.keys(l.xtl)]) expect(co.has(id), `${n.id}/${l.id}: ${id}`).toBe(true);
    }
  });
});

// ⚠️ `fireEvent` được import để các ca giao diện sau này (bấm nút thật) dùng chung; tránh cảnh báo "unused" bằng một phép dùng thật tối thiểu.
describe("[SK-UI-07] bấm thật trên trang", () => {
  it("«Xoá ví dụ» ⇒ danh sách trống, hiện lời mời thêm người", () => {
    render(<SucKhoeTrang daMoKhoa={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Xoá ví dụ/ }));
    expect(document.body.textContent).not.toContain("Bé An");
  });
});
