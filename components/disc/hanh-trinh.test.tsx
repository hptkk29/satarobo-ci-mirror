// @vitest-environment jsdom
/**
 * [DISC-UI-*] Hành trình DISC: các luật hiển thị/điều phối. KHÔNG dùng engine, câu hỏi hay điểm thật —
 * mọi dữ liệu dưới đây là BỊA, đặt nhãn "giả". Không mạng, không DB, không đồng hồ thật (namNay, bayGio tiêm vào).
 * Động cơ chạy ở SERVER (D1): bộ đề đến từ `layBoDe` giả, máy khách không chấm — chỉ gửi câu trả lời thô.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BoDeDisc } from "@/lib/disc/engine";
import type { PhanHoiLuu } from "@/lib/disc/luu";
import { KHOA_LOCAL_MA_NHAN } from "@/lib/disc/nhan-ma-local";
import { HanhTrinhDisc, KhongCoNguonNgauNhienError, sinhKhoaMacDinh } from "./hanh-trinh";
import { KHOA_BAN_NHAP, KHOA_BAN_NHAP_CU_V1, ghiBanNhap, type KhoLuuTru } from "./ban-nhap";
import type { GoiBoDe, GoiDiaChi, GoiLuu } from "./api-client";

/**
 * localStorage giả CÓ THẬT trong bộ nhớ: Node mới có `localStorage` thử nghiệm làm hỏng bản của jsdom
 * ("--localstorage-file was not provided"), nên ghi/đọc qua `window.localStorage` im lặng thất bại.
 */
function datLocalStorageGia() {
  const map = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k), clear: () => map.clear() },
  });
}
function datSessionStorageGia() {
  const map = new Map<string, string>();
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k), clear: () => map.clear() },
  });
}
beforeEach(() => {
  datLocalStorageGia();
  datSessionStorageGia();
});
afterEach(cleanup);

const NAM_NAY = 2026;
const BO_GIA = { PH: "GIA-PH", HS: "GIA-HS" };
const MOC = 1_800_000_000_000; // mốc giả cố định

const boGia = (ma: string, nhoHo: boolean): BoDeDisc => ({
  ma,
  phienBan: "gia-1",
  doiTuong: "TH",
  nguoiLonTraLoiHo: nhoHo,
  cauHoi: [
    { id: `${ma}-1`, noiDung: "Câu giả số một" },
    { id: `${ma}-2`, noiDung: "Câu giả số hai" },
  ],
});

/** Máy chủ GIẢ: trả bộ đề theo vai. Không có động cơ, không có điểm. */
const layBoDeGia = (): GoiBoDe =>
  vi.fn<GoiBoDe>(async (y) => ({
    ok: true,
    boDe: y.vai === "PH" ? boGia("GIA-PH", false) : boGia("GIA-HS", y.bacHoc === "MN" || y.bacHoc === "1" || y.bacHoc === "2"),
  }));

const khoGia = (dau: Record<string, string> = {}): KhoLuuTru & { map: Map<string, string> } => {
  const map = new Map(Object.entries(dau));
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};

const khoNem: KhoLuuTru = {
  getItem: () => {
    throw new Error("bị chặn");
  },
  setItem: () => {
    throw new Error("bị chặn");
  },
  removeItem: () => {
    throw new Error("bị chặn");
  },
};

const thanhCong = (email: string | null = null): PhanHoiLuu => ({
  ok: true,
  submissionId: "sub-gia-1",
  tokenTai: "token-gia",
  maNhan: "ABCDEFGHJK",
  thongBao: { chinh: "Câu chính giả — đã lưu an toàn.", email },
});

/** Danh mục địa chỉ GIẢ (không gọi mạng): bước «Lưu» bắt buộc chọn phường/xã (05/11/2026). */
const DANH_MUC_GIA = { thanhPho: ["Tp Đà Nẵng", "Huế"], macDinh: "Tp Đà Nẵng", phuong: ["Phường An Hải", "Phường Hải Châu"] };
const layDiaChiGia = (): GoiDiaChi => vi.fn<GoiDiaChi>(async () => ({ ok: true, danhMuc: DANH_MUC_GIA }));

function dung(opts: { goiApi?: GoiLuu; kho?: KhoLuuTru | null; layBoDe?: GoiBoDe; sinhKhoa?: () => string; layDiaChi?: GoiDiaChi } = {}) {
  const goiApi = opts.goiApi ?? vi.fn<GoiLuu>(async () => thanhCong());
  const layBoDe = opts.layBoDe ?? layBoDeGia();
  const view = render(
    <HanhTrinhDisc
      layBoDe={layBoDe}
      goiApi={goiApi}
      layDiaChi={opts.layDiaChi ?? layDiaChiGia()}
      namNay={NAM_NAY}
      kho={opts.kho === undefined ? khoGia() : opts.kho}
      sinhKhoa={opts.sinhKhoa ?? (() => "khoa-gia-0123456789abcdef")}
      bayGio={() => MOC}
    />,
  );
  return { goiApi, layBoDe, ...view };
}

const nhap = (nhan: string | RegExp, v: string) => fireEvent.change(screen.getByLabelText(nhan), { target: { value: v } });

function dienHoSo(o: { hsNam?: string; lop?: string } = {}) {
  fireEvent.click(screen.getByLabelText("Mẹ"));
  nhap("Họ và tên", "Mẹ Giả Một");
  nhap("Năm sinh", "1988");
  nhap("Tên của bé", "Bé Giả Hai");
  nhap("Năm sinh của bé", o.hsNam ?? "2017");
  nhap("Lớp / bậc học hiện tại", o.lop ?? "3");
}

/** Sau "Làm tiếp" nháp không còn tên: gõ lại hai họ tên rồi bấm Tiếp tục. */
function gioLaiTen() {
  nhap("Họ và tên", "Mẹ Giả Một");
  nhap("Tên của bé", "Bé Giả Hai");
}

function lamBai() {
  fireEvent.click(screen.getByLabelText(/Rất đúng/));
  fireEvent.click(screen.getByTestId("disc-cau-tiep"));
  fireEvent.click(screen.getByLabelText(/Rất đúng/));
  fireEvent.click(screen.getByTestId("disc-cau-xong"));
}

/** Bấm "Tiếp tục" ở hồ sơ và đợi bộ đề về từ máy chủ giả. */
async function tiepHoSo() {
  fireEvent.click(screen.getByTestId("disc-ho-so-tiep"));
  await screen.findByTestId("disc-lam-bai");
}

async function diDenFormLuu(o: Parameters<typeof dienHoSo>[0] = {}) {
  dienHoSo(o);
  await tiepHoSo();
  lamBai(); // bài ba/mẹ
  lamBai(); // bài của bé
  await screen.findByRole("option", { name: "Phường Hải Châu" }); // danh mục địa chỉ đã tải xong
}

function dienFormLuu(o: { sdt?: string; email?: string; xuLy?: boolean; tiepThi?: boolean; phuong?: string | null } = {}) {
  nhap(/Số điện thoại/, o.sdt ?? "0905123456");
  // Phường/xã BẮT BUỘC: mặc định chọn «Phường Hải Châu»; truyền null để KHÔNG chọn (ca kiểm bắt buộc).
  if (o.phuong !== null) nhap("Phường / xã (bắt buộc)", o.phuong ?? "Phường Hải Châu");
  if (o.email !== undefined) nhap(/Email/, o.email);
  if (o.xuLy !== false) fireEvent.click(screen.getByLabelText(/Bắt buộc:/));
  if (o.tiepThi) fireEvent.click(screen.getByLabelText(/Tuỳ chọn:/));
}

describe("[DISC-UI-01] hồ sơ: thiếu thì KHÔNG cho tiếp", () => {
  it("bấm Tiếp tục khi trống ⇒ ở lại bước hồ sơ, báo lỗi, chưa vào bài", () => {
    dung();
    fireEvent.click(screen.getByTestId("disc-ho-so-tiep"));
    expect(screen.getByTestId("disc-ho-so")).toBeTruthy();
    expect(screen.queryByTestId("disc-lam-bai")).toBeNull();
    expect(screen.getByTestId("disc-ho-so-loi-tong")).toBeTruthy();
    expect(screen.getByText(/chọn bạn là bố, mẹ hay người giám hộ/i)).toBeTruthy();
    expect(screen.getByText(/chọn lớp\/bậc học của con/i)).toBeTruthy();
  });
  it("thiếu RIÊNG phía bé cũng không cho tiếp", () => {
    dung();
    fireEvent.click(screen.getByLabelText("Bố"));
    nhap("Họ và tên", "Bố Giả");
    nhap("Năm sinh", "1985");
    fireEvent.click(screen.getByTestId("disc-ho-so-tiep"));
    expect(screen.queryByTestId("disc-lam-bai")).toBeNull();
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });
  it("năm sinh không phải 4 chữ số ⇒ nói rõ, không tiếp", () => {
    dung();
    dienHoSo({ hsNam: "17" });
    fireEvent.click(screen.getByTestId("disc-ho-so-tiep"));
    expect(screen.getByText(/gồm 4 chữ số/i)).toBeTruthy();
    expect(screen.queryByTestId("disc-lam-bai")).toBeNull();
  });
  it("hồ sơ đủ ⇒ vào bài ba/mẹ", async () => {
    dung();
    dienHoSo();
    await tiepHoSo();
    expect(screen.getByTestId("disc-lam-bai")).toBeTruthy();
    expect(screen.getByText("Câu giả số một")).toBeTruthy();
  });
});

describe("[DISC-UI-02] cảnh báo năm sinh lệch lớp + hộp giải thích bé nhỏ", () => {
  it("NAM_SINH_LECH_LOP: hiện cảnh báo, chặn tới khi tích xác nhận", async () => {
    dung();
    dienHoSo({ hsNam: "2017", lop: "6" });
    expect(screen.getByTestId("disc-canh-bao-lech")).toBeTruthy();
    fireEvent.click(screen.getByTestId("disc-ho-so-tiep"));
    expect(screen.queryByTestId("disc-lam-bai")).toBeNull();
    fireEvent.click(screen.getByLabelText(/Tôi xác nhận năm sinh và lớp/));
    await tiepHoSo();
    expect(screen.getByTestId("disc-lam-bai")).toBeTruthy();
  });
  it("[LNH-UI] gõ năm sinh ⇒ tự điền lớp theo năm học (01/2027 vẫn năm học 2026–27: sinh 2017 ⇒ lớp 4), sửa tay được", () => {
    dung(); // bayGio = MOC ≈ 15/01/2027
    nhap("Năm sinh của bé", "2017");
    const chon = screen.getByLabelText("Lớp / bậc học hiện tại") as HTMLSelectElement;
    expect(chon.value).toBe("4");
    expect(screen.getByText(/năm học 2026–2027/)).toBeTruthy();
    nhap("Năm sinh của bé", "201"); // chưa đủ 4 số ⇒ giữ nguyên
    expect(chon.value).toBe("4");
    nhap("Lớp / bậc học hiện tại", "5"); // học vượt lớp ⇒ sửa tay được
    expect(chon.value).toBe("5");
  });
  it("khớp năm sinh – lớp ⇒ không có cảnh báo", () => {
    dung();
    dienHoSo();
    expect(screen.queryByTestId("disc-canh-bao-lech")).toBeNull();
  });
  it("sửa lớp sau khi đã tích xác nhận ⇒ phải xác nhận lại", () => {
    dung();
    dienHoSo({ hsNam: "2017", lop: "6" });
    fireEvent.click(screen.getByLabelText(/Tôi xác nhận năm sinh và lớp/));
    nhap("Lớp / bậc học hiện tại", "7"); // vẫn lệch ⇒ hộp còn, nhưng ô xác nhận đã bị bỏ tích
    const hop = screen.getByTestId("disc-canh-bao-lech");
    expect((within(hop).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });
  it("bé mầm non/lớp 1–2 ⇒ hộp 'người lớn trả lời hộ'; lớp lớn thì không", () => {
    dung();
    dienHoSo({ hsNam: "2022", lop: "MN" });
    expect(screen.getByTestId("disc-hop-be-nho").textContent).toMatch(/trả lời hộ/);
    nhap("Năm sinh của bé", "2015");
    nhap("Lớp / bậc học hiện tại", "5");
    expect(screen.queryByTestId("disc-hop-be-nho")).toBeNull();
  });
  it("màn làm bài của bé nhỏ nói rõ 'ba/mẹ trả lời hộ'", async () => {
    dung();
    dienHoSo({ hsNam: "2020", lop: "1" });
    await tiepHoSo();
    lamBai();
    expect(screen.getByTestId("disc-nguoi-lon-tra-loi-ho")).toBeTruthy();
  });
});

describe("[DISC-UI-03] server chưa có động cơ ⇒ 'đang hoàn thiện', KHÔNG dựng bài giả", () => {
  it("503 ENGINE_CHUA_SAN_SANG từ /api/disc/bo-de ⇒ màn 'đang hoàn thiện', không có bài", async () => {
    const layBoDe = vi.fn<GoiBoDe>(async () => ({ ok: false, loi: "ENGINE_CHUA_SAN_SANG" }));
    dung({ layBoDe });
    dienHoSo();
    fireEvent.click(screen.getByTestId("disc-ho-so-tiep"));
    expect(await screen.findByTestId("disc-dang-hoan-thien")).toBeTruthy();
    expect(screen.queryByTestId("disc-ho-so")).toBeNull();
    expect(screen.queryByTestId("disc-lam-bai")).toBeNull();
    expect(screen.queryByText("Câu giả số một")).toBeNull();
  });
  it("404 (cờ tắt) cũng không dựng bài", async () => {
    dung({ layBoDe: vi.fn<GoiBoDe>(async () => ({ ok: false, loi: "KHONG_MO" })) });
    dienHoSo();
    fireEvent.click(screen.getByTestId("disc-ho-so-tiep"));
    expect(await screen.findByTestId("disc-dang-hoan-thien")).toBeTruthy();
    expect(screen.queryByTestId("disc-lam-bai")).toBeNull();
  });
  it("máy chủ không chọn được bộ đề theo tuổi (400) ⇒ ở lại hồ sơ, nói lý do, giữ dữ liệu", async () => {
    dung({ layBoDe: vi.fn<GoiBoDe>(async () => ({ ok: false, loi: "KHONG_HOP_LE" })) });
    dienHoSo();
    fireEvent.click(screen.getByTestId("disc-ho-so-tiep"));
    expect(await screen.findByText(/Chưa chọn được bộ câu hỏi/)).toBeTruthy();
    expect(screen.queryByTestId("disc-lam-bai")).toBeNull();
    expect((screen.getByLabelText("Tên của bé") as HTMLInputElement).value).toBe("Bé Giả Hai");
  });
  it("mất mạng / 5xx / bị giới hạn ⇒ ở lại hồ sơ, nói đúng lý do, KHÔNG dựng bài, giữ dữ liệu", async () => {
    for (const [loi, mau] of [
      ["MANG", /Chưa kết nối được/],
      ["LOI_MAY_CHU", /lỗi phía chúng tôi/],
      ["QUA_NHIEU_LAN", /quá nhiều lần/],
    ] as const) {
      const { unmount } = dung({ layBoDe: vi.fn<GoiBoDe>(async () => ({ ok: false, loi })) });
      dienHoSo();
      fireEvent.click(screen.getByTestId("disc-ho-so-tiep"));
      expect(await screen.findByText(mau)).toBeTruthy();
      expect(screen.queryByTestId("disc-lam-bai")).toBeNull();
      expect(screen.queryByTestId("disc-dang-hoan-thien")).toBeNull();
      expect((screen.getByLabelText("Họ và tên") as HTMLInputElement).value).toBe("Mẹ Giả Một");
      unmount();
    }
  });
  it("layBoDe ném lỗi ⇒ coi như mất mạng, vẫn ở lại hồ sơ", async () => {
    dung({
      layBoDe: vi.fn<GoiBoDe>(async () => {
        throw new Error("boom");
      }),
    });
    dienHoSo();
    fireEvent.click(screen.getByTestId("disc-ho-so-tiep"));
    expect(await screen.findByText(/Chưa kết nối được/)).toBeTruthy();
    expect(screen.queryByTestId("disc-lam-bai")).toBeNull();
  });
  it("một trong hai bộ đề lỗi ⇒ không dựng bài nửa vời", async () => {
    const layBoDe = vi.fn<GoiBoDe>(async (y) => (y.vai === "PH" ? { ok: true, boDe: boGia("GIA-PH", false) } : { ok: false, loi: "MANG" }));
    dung({ layBoDe });
    dienHoSo();
    fireEvent.click(screen.getByTestId("disc-ho-so-tiep"));
    expect(await screen.findByText(/Chưa kết nối được/)).toBeTruthy();
    expect(screen.queryByTestId("disc-lam-bai")).toBeNull();
  });
  it("hỏi đúng hợp đồng: PH chỉ gửi namSinh; HS gửi bacHoc + namSinh; KHÔNG gửi tên", async () => {
    const { layBoDe } = dung();
    dienHoSo({ hsNam: "2017", lop: "3" });
    await tiepHoSo();
    const goi = (layBoDe as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(goi).toContainEqual({ vai: "PH", namSinh: 1988 });
    expect(goi).toContainEqual({ vai: "HS", bacHoc: "3", namSinh: 2017 });
    expect(JSON.stringify(goi)).not.toMatch(/Giả/);
  });
  it("đang tải bộ đề ⇒ nút khoá + báo 'Đang tải câu hỏi'; bấm lặp không gửi thêm", async () => {
    let xong!: () => void;
    const cho = new Promise<void>((res) => (xong = res));
    const layBoDe = vi.fn<GoiBoDe>(async (y) => {
      await cho;
      return { ok: true, boDe: boGia(y.vai === "PH" ? "GIA-PH" : "GIA-HS", false) };
    });
    dung({ layBoDe });
    dienHoSo();
    fireEvent.click(screen.getByTestId("disc-ho-so-tiep"));
    await waitFor(() => expect(screen.getByTestId("disc-ho-so-tiep").textContent).toMatch(/Đang tải câu hỏi/));
    expect((screen.getByTestId("disc-ho-so-tiep") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByTestId("disc-ho-so"));
    expect(layBoDe).toHaveBeenCalledTimes(2); // PH + HS, đúng một lượt
    xong();
    await screen.findByTestId("disc-lam-bai");
  });
  it("'Xoá dữ liệu' trong lúc đang chờ bộ đề ⇒ phản hồi muộn của lượt cũ bị bỏ", async () => {
    let xong!: () => void;
    const cho = new Promise<void>((res) => (xong = res));
    const layBoDe = vi.fn<GoiBoDe>(async (y) => {
      await cho;
      return { ok: true, boDe: boGia(y.vai === "PH" ? "GIA-PH" : "GIA-HS", false) };
    });
    dung({ layBoDe });
    dienHoSo();
    fireEvent.click(screen.getByTestId("disc-ho-so-tiep"));
    await waitFor(() => expect(layBoDe).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("disc-xoa-tren-may"));
    xong();
    await waitFor(() => expect(screen.getByTestId("disc-ho-so")).toBeTruthy());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("disc-lam-bai")).toBeNull();
    expect((screen.getByLabelText("Họ và tên") as HTMLInputElement).value).toBe("");
  });
  it("khôi phục nháp mà server chưa có động cơ ⇒ 'đang hoàn thiện'", async () => {
    const kho = khoGia();
    ghiBanNhap(kho, { buoc: "phuHuynh", idempotencyKey: "khoa-cu-0123456789abcdef", hoSo: { phuHuynh: { hoTen: "Mẹ Giả Một", vaiTro: "ME", namSinh: "1988" }, hocSinh: { hoTen: "Bé Giả Hai", namSinh: "2017", bacHoc: "3" }, xacNhanLech: false }, bo: BO_GIA, traLoi: { PH: {}, HS: {} }, cau: { PH: 0, HS: 0 } }, MOC);  // gitleaks:allow
    dung({ kho, layBoDe: vi.fn<GoiBoDe>(async () => ({ ok: false, loi: "ENGINE_CHUA_SAN_SANG" })) });
    fireEvent.click(screen.getByTestId("disc-ban-nhap-tiep"));
    gioLaiTen();
    fireEvent.click(screen.getByTestId("disc-ho-so-tiep"));
    expect(await screen.findByTestId("disc-dang-hoan-thien")).toBeTruthy();
    expect(screen.queryByTestId("disc-lam-bai")).toBeNull();
  });
  it("khôi phục nháp mà mạng đứt ⇒ về bước hồ sơ, nói lý do, không dựng bài", async () => {
    const kho = khoGia();
    ghiBanNhap(kho, { buoc: "phuHuynh", idempotencyKey: "khoa-cu-0123456789abcdef", hoSo: { phuHuynh: { hoTen: "Mẹ Giả Một", vaiTro: "ME", namSinh: "1988" }, hocSinh: { hoTen: "Bé Giả Hai", namSinh: "2017", bacHoc: "3" }, xacNhanLech: false }, bo: BO_GIA, traLoi: { PH: {}, HS: {} }, cau: { PH: 0, HS: 0 } }, MOC);  // gitleaks:allow
    dung({ kho, layBoDe: vi.fn<GoiBoDe>(async () => ({ ok: false, loi: "MANG" })) });
    fireEvent.click(screen.getByTestId("disc-ban-nhap-tiep"));
    expect((screen.getByLabelText("Họ và tên") as HTMLInputElement).value).toBe(""); // tên KHÔNG được khôi phục
    expect((screen.getByLabelText("Năm sinh") as HTMLInputElement).value).toBe("1988");
    gioLaiTen();
    fireEvent.click(screen.getByTestId("disc-ho-so-tiep"));
    expect(await screen.findByText(/Chưa kết nối được/)).toBeTruthy();
    expect(screen.queryByTestId("disc-lam-bai")).toBeNull();
    expect((screen.getByLabelText("Họ và tên") as HTMLInputElement).value).toBe("Mẹ Giả Một");
  });
});

describe("[DISC-UI-04] thanh tiến độ và điều hướng câu", () => {
  it("tiến độ tăng theo số câu đã trả lời", async () => {
    dung();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    dienHoSo();
    await tiepHoSo();
    const a = Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));
    fireEvent.click(screen.getByLabelText(/Rất đúng/));
    const b = Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));
    expect(b).toBeGreaterThan(a);
  });
  it("chưa chọn đáp án thì 'Câu tiếp' bị khoá; câu cuối thiếu câu trước thì không hoàn thành được", async () => {
    dung();
    dienHoSo();
    await tiepHoSo();
    expect((screen.getByTestId("disc-cau-tiep") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Rất đúng/));
    fireEvent.click(screen.getByTestId("disc-cau-tiep"));
    expect((screen.getByTestId("disc-cau-xong") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("[DISC-UI-05] form Lưu", () => {
  it("không hỏi lại tên/năm sinh; hai ô đồng ý KHÔNG tích sẵn; SĐT bắt buộc", async () => {
    dung();
    await diDenFormLuu();
    expect(screen.getByTestId("disc-hoan-thanh")).toBeTruthy();
    expect(screen.queryByLabelText("Họ và tên")).toBeNull();
    expect(screen.queryByLabelText(/Năm sinh/)).toBeNull();
    expect((screen.getByLabelText(/Bắt buộc:/) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText(/Tuỳ chọn:/) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId("disc-tom-tat").textContent).toMatch(/Mẹ Giả Một/);
    expect(screen.getByTestId("disc-luu-gui").textContent).toBe("Lưu và xuất kết quả");
  });
  it("thiếu SĐT / thiếu đồng ý xử lý ⇒ không gọi API", async () => {
    const { goiApi } = dung();
    await diDenFormLuu();
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    expect(goiApi).not.toHaveBeenCalled();
    expect(screen.getByText(/nhập số điện thoại/i)).toBeTruthy();
    expect(screen.getByText(/đồng ý để chúng tôi xử lý hồ sơ/i)).toBeTruthy();
    nhap(/Số điện thoại/, "0905123456");
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    expect(goiApi).not.toHaveBeenCalled();
  });
  it("SĐT sai định dạng và email sai ⇒ chặn tại chỗ", async () => {
    const { goiApi } = dung();
    await diDenFormLuu();
    dienFormLuu({ sdt: "12345", email: "khong-phai-email" });
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    expect(goiApi).not.toHaveBeenCalled();
    expect(screen.getByText(/Số điện thoại chưa đúng/)).toBeTruthy();
    expect(screen.getByText(/Email chưa đúng định dạng/)).toBeTruthy();
  });
  it("[DISC-UI-DC-01] chưa chọn phường/xã ⇒ chặn tại chỗ, nói rõ, không gọi API; chọn rồi mới lưu được", async () => {
    const { goiApi } = dung();
    await diDenFormLuu();
    dienFormLuu({ phuong: null });
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    expect(goiApi).not.toHaveBeenCalled();
    expect(screen.getByText(/chọn phường\/xã nơi nhà bạn ở/i)).toBeTruthy();
    nhap("Phường / xã (bắt buộc)", "Phường An Hải");
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    await waitFor(() => expect(goiApi).toHaveBeenCalledTimes(1));
    expect((goiApi as ReturnType<typeof vi.fn>).mock.calls[0][0].diaChi.phuong).toBe("Phường An Hải");
  });
  it("[DISC-UI-DC-02] thành phố chọn sẵn Tp Đà Nẵng; đổi thành phố ⇒ tải phường mới và BỎ phường đã chọn (không gửi phường của thành phố cũ)", async () => {
    const layDiaChi = vi.fn<GoiDiaChi>(async (tp) =>
      tp === "Huế"
        ? { ok: true, danhMuc: { ...DANH_MUC_GIA, phuong: ["Phường Thuận Hóa"] } }
        : { ok: true, danhMuc: DANH_MUC_GIA },
    );
    const { goiApi } = dung({ layDiaChi });
    await diDenFormLuu();
    expect((screen.getByLabelText("Thành phố / tỉnh") as HTMLSelectElement).value).toBe("Tp Đà Nẵng");
    nhap("Phường / xã (bắt buộc)", "Phường Hải Châu");
    nhap("Thành phố / tỉnh", "Huế");
    await screen.findByRole("option", { name: "Phường Thuận Hóa" });
    expect((screen.getByLabelText("Phường / xã (bắt buộc)") as HTMLSelectElement).value).toBe("");
    expect(screen.queryByRole("option", { name: "Phường Hải Châu" })).toBeNull();
    // Chưa chọn lại phường của thành phố mới ⇒ phải bị chặn (không được lặng lẽ gửi phường cũ của Đà Nẵng).
    dienFormLuu({ phuong: null });
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    expect(goiApi).not.toHaveBeenCalled();
    expect(screen.getByText(/chọn phường\/xã nơi nhà bạn ở/i)).toBeTruthy();
    nhap("Phường / xã (bắt buộc)", "Phường Thuận Hóa"); // các ô khác đã điền ở trên (không gọi lại dienFormLuu: nó bật/tắt ô đồng ý)
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    await waitFor(() => expect(goiApi).toHaveBeenCalledTimes(1));
    expect((goiApi as ReturnType<typeof vi.fn>).mock.calls[0][0].diaChi).toMatchObject({ thanhPho: "Huế", phuong: "Phường Thuận Hóa" });
  });
  it("[DISC-UI-DC-03] số nhà (tuỳ chọn) được cắt rìa; cơ sở gần nhà chọn tay đi vào body", async () => {
    const { goiApi } = dung();
    await diDenFormLuu();
    dienFormLuu();
    nhap(/Số nhà, đường/, "  12 Lê Duẩn  ");
    nhap(/Cơ sở nào gần nhà bạn/, "CS2");
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    await waitFor(() => expect(goiApi).toHaveBeenCalledTimes(1));
    expect((goiApi as ReturnType<typeof vi.fn>).mock.calls[0][0].diaChi).toEqual({ thanhPho: "Tp Đà Nẵng", phuong: "Phường Hải Châu", soNha: "12 Lê Duẩn", coSoGanNha: "CS2" });
  });
  it("[DISC-UI-DC-04] không tải được danh mục ⇒ báo lỗi + nút Thử lại; bấm Thử lại thì tải được và lưu được", async () => {
    let lan = 0;
    const layDiaChi = vi.fn<GoiDiaChi>(async () => (++lan === 1 ? { ok: false, loi: "MANG" } : { ok: true, danhMuc: DANH_MUC_GIA }));
    const { goiApi } = dung({ layDiaChi });
    dienHoSo();
    await tiepHoSo();
    lamBai();
    lamBai();
    expect(await screen.findByText(/Chưa tải được danh sách phường\/xã/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await screen.findByRole("option", { name: "Phường Hải Châu" });
    dienFormLuu();
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    await waitFor(() => expect(goiApi).toHaveBeenCalledTimes(1));
  });
  it("gửi đúng body: tiếp thị mặc định false, email trống ⇒ null, đồng ý xử lý true", async () => {
    const { goiApi } = dung();
    await diDenFormLuu();
    dienFormLuu();
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    await waitFor(() => expect(goiApi).toHaveBeenCalledTimes(1));
    const body = (goiApi as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.dongY).toEqual({ xuLyHoSo: true, tiepThi: false });
    // Địa chỉ nơi ở: thành phố mặc định Tp Đà Nẵng, phường đã chọn, số nhà trống ⇒ null, chưa chọn cơ sở ⇒ null.
    expect(body.diaChi).toEqual({ thanhPho: "Tp Đà Nẵng", phuong: "Phường Hải Châu", soNha: null, coSoGanNha: null });
    expect(body.email).toBeNull();
    expect(body.soDienThoai).toBe("0905123456");
    expect(body.idempotencyKey).toBe("khoa-gia-0123456789abcdef");
    // D1: gửi CÂU TRẢ LỜI THÔ, KHÔNG có điểm/phiên bản động cơ ở máy khách (server tự chấm).
    expect(body.bai).toEqual({
      phuHuynh: { maBoDe: "GIA-PH", traLoi: { "GIA-PH-1": 5, "GIA-PH-2": 5 } },
      hocSinh: { maBoDe: "GIA-HS", traLoi: { "GIA-HS-1": 5, "GIA-HS-2": 5 } },
    });
    expect(body).not.toHaveProperty("ketQua");
    expect(JSON.stringify(body)).not.toMatch(/diem|engineVersion/);
  });
  it("tích tiếp thị ⇒ tiepThi true", async () => {
    const { goiApi } = dung();
    await diDenFormLuu();
    dienFormLuu({ tiepThi: true });
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    await waitFor(() => expect(goiApi).toHaveBeenCalled());
    expect((goiApi as ReturnType<typeof vi.fn>).mock.calls[0][0].dongY.tiepThi).toBe(true);
  });
});

describe("[DISC-UI-06] kết quả lưu: thành công, lỗi, thử lại", () => {
  it("thành công không email ⇒ KHÔNG có dòng/chữ về email", async () => {
    dung();
    await diDenFormLuu();
    dienFormLuu();
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    const man = await screen.findByTestId("disc-thanh-cong");
    expect(within(man).getByTestId("disc-tb-chinh").textContent).toBe("Câu chính giả — đã lưu an toàn.");
    expect(screen.queryByTestId("disc-tb-email")).toBeNull();
    expect(man.textContent).not.toMatch(/email|mail/i);
  });
  it("thành công có email ⇒ hiện dòng email từ thongBaoSauLuu", async () => {
    dung({ goiApi: vi.fn<GoiLuu>(async () => thanhCong("Đã gửi tới a***@gmail.com.")) });
    await diDenFormLuu();
    dienFormLuu({ email: "an@gmail.com" });
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    expect((await screen.findByTestId("disc-tb-email")).textContent).toBe("Đã gửi tới a***@gmail.com.");
  });
  it("lỗi máy chủ ⇒ KHÔNG hiện 'đã lưu'; giữ form; báo CHƯA lưu", async () => {
    dung({ goiApi: vi.fn<GoiLuu>(async () => ({ ok: false, loi: "LUU_THAT_BAI" })) });
    await diDenFormLuu();
    dienFormLuu();
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    const loi = await screen.findByTestId("disc-loi-luu");
    expect(loi.textContent).toMatch(/Chưa lưu được/);
    expect(screen.queryByTestId("disc-thanh-cong")).toBeNull();
    expect(screen.queryByText(/Đã lưu kết quả/)).toBeNull();
    expect(screen.getByTestId("disc-luu-gui").textContent).toMatch(/Thử lại/);
    expect((screen.getByLabelText(/Số điện thoại/) as HTMLInputElement).value).toBe("0905123456");
  });
  it("mất mạng và API ném lỗi ⇒ vẫn là lỗi, không là thành công", async () => {
    dung({
      goiApi: vi.fn<GoiLuu>(async () => {
        throw new Error("boom");
      }),
    });
    await diDenFormLuu();
    dienFormLuu();
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    expect((await screen.findByTestId("disc-loi-luu")).textContent).toMatch(/CHƯA được lưu/);
    expect(screen.queryByTestId("disc-thanh-cong")).toBeNull();
  });
  it("lỗi từng ô từ server (soDienThoai) hiện ngay dưới ô", async () => {
    dung({ goiApi: vi.fn<GoiLuu>(async () => ({ ok: false, loi: "DU_LIEU_KHONG_HOP_LE", chiTiet: [{ truong: "soDienThoai", thongBao: "Số điện thoại không hợp lệ (server)" }] })) });
    await diDenFormLuu();
    dienFormLuu();
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    expect(await screen.findByText("Số điện thoại không hợp lệ (server)")).toBeTruthy();
    expect(screen.queryByTestId("disc-thanh-cong")).toBeNull();
  });
  it("thử lại dùng ĐÚNG MỘT idempotencyKey (sinh một lần mỗi lượt)", async () => {
    const goiApi = vi.fn<GoiLuu>().mockResolvedValueOnce({ ok: false, loi: "MANG" }).mockResolvedValueOnce({ ok: false, loi: "LUU_THAT_BAI" }).mockResolvedValueOnce(thanhCong());
    let n = 0;
    const sinhKhoa = vi.fn(() => `khoa-gia-lan-${++n}-0123456789`);
    dung({ goiApi, sinhKhoa });
    await diDenFormLuu();
    dienFormLuu();
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByTestId("disc-luu-gui"));
      await waitFor(() => expect(goiApi).toHaveBeenCalledTimes(i + 1));
      if (i < 2) await screen.findByTestId("disc-loi-luu");
    }
    await screen.findByTestId("disc-thanh-cong");
    const khoa = (goiApi as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].idempotencyKey);
    expect(new Set(khoa).size).toBe(1);
    expect(sinhKhoa).toHaveBeenCalledTimes(1);
  });
  it("đang lưu ⇒ nút khoá + báo 'Đang lưu'; bấm lặp không gửi lần hai", async () => {
    let xong!: (r: PhanHoiLuu) => void;
    const goiApi = vi.fn<GoiLuu>(() => new Promise((res) => (xong = res as (r: PhanHoiLuu) => void)));
    dung({ goiApi });
    await diDenFormLuu();
    dienFormLuu();
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    await waitFor(() => expect(screen.getByTestId("disc-luu-gui").textContent).toMatch(/Đang lưu/));
    expect((screen.getByTestId("disc-luu-gui") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByTestId("disc-form-luu"));
    expect(goiApi).toHaveBeenCalledTimes(1);
    xong(thanhCong());
    await screen.findByTestId("disc-thanh-cong");
  });
  it("còn câu chưa trả lời (nháp dở) ⇒ KHÔNG gọi API, KHÔNG báo đã lưu", async () => {
    const kho = khoGia();
    ghiBanNhap(kho, { buoc: "hoanThanh", idempotencyKey: "khoa-cu-0123456789abcdef", hoSo: { phuHuynh: { hoTen: "Mẹ Giả Một", vaiTro: "ME", namSinh: "1988" }, hocSinh: { hoTen: "Bé Giả Hai", namSinh: "2017", bacHoc: "3" }, xacNhanLech: false }, bo: BO_GIA, traLoi: { PH: { "GIA-PH-1": 5 }, HS: {} }, cau: { PH: 0, HS: 0 } }, MOC);  // gitleaks:allow
    const { goiApi } = dung({ kho });
    fireEvent.click(screen.getByTestId("disc-ban-nhap-tiep"));
    gioLaiTen();
    fireEvent.click(screen.getByTestId("disc-ho-so-tiep"));
    await screen.findByTestId("disc-hoan-thanh");
    dienFormLuu();
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    expect((await screen.findByTestId("disc-loi-luu")).textContent).toMatch(/CHƯA lưu/);
    expect(goiApi).not.toHaveBeenCalled();
    expect(screen.queryByTestId("disc-thanh-cong")).toBeNull();
  });
  it("server trả 503 ENGINE_CHUA_SAN_SANG khi lưu ⇒ báo CHƯA lưu, giữ form, không nói 'đã lưu'", async () => {
    dung({ goiApi: vi.fn<GoiLuu>(async () => ({ ok: false, loi: "ENGINE_CHUA_SAN_SANG" })) });
    await diDenFormLuu();
    dienFormLuu();
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    expect((await screen.findByTestId("disc-loi-luu")).textContent).toMatch(/CHƯA được lưu/);
    expect(screen.queryByTestId("disc-thanh-cong")).toBeNull();
  });
});

describe("[DISC-UI-06b] mã nhận trên màn thành công", () => {
  it("hiện mã ABCDE-FGHJK, cảnh báo 'chỉ hiện một lần', ghi vào máy, CTA tới /kich-hoat?disc=1", async () => {
    dung();
    await diDenFormLuu();
    dienFormLuu();
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    await screen.findByTestId("disc-thanh-cong");
    expect(screen.getByTestId("disc-ma-nhan").textContent).toBe("ABCDE-FGHJK");
    expect(screen.getByTestId("disc-ma-nhan-canh-bao").textContent).toMatch(/chỉ hiện một lần/);
    expect(screen.getByTestId("disc-ma-nhan-canh-bao").textContent).toMatch(/không xem lại được/);
    expect(window.localStorage.getItem(KHOA_LOCAL_MA_NHAN)).toBe("ABCDEFGHJK");
    const cta = screen.getByTestId("disc-nhan-ket-qua") as HTMLAnchorElement;
    expect(cta.getAttribute("href")).toBe("/kich-hoat?disc=1");
    expect(cta.textContent).toBe("Nhận kết quả vào tài khoản");
  });
  it("maNhan null (phát lại khi bài đã nhận) ⇒ KHÔNG có ô mã, KHÔNG ghi gì vào máy", async () => {
    dung({ goiApi: vi.fn<GoiLuu>(async () => ({ ...(thanhCong() as Extract<PhanHoiLuu, { ok: true }>), maNhan: null })) });
    await diDenFormLuu();
    dienFormLuu();
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    await screen.findByTestId("disc-thanh-cong");
    expect(screen.queryByTestId("disc-ma-nhan-khung")).toBeNull();
    expect(screen.queryByTestId("disc-ma-nhan")).toBeNull();
    expect(screen.getByTestId("disc-thanh-cong").textContent).not.toMatch(/ABCDE/);
    expect(window.localStorage.getItem(KHOA_LOCAL_MA_NHAN)).toBeNull();
  });
});

describe("[DISC-UI-07] bản nháp trên thiết bị", () => {
  it("ghi nháp KHÔNG chứa SĐT, email hay điểm", async () => {
    const kho = khoGia();
    dung({ kho });
    await diDenFormLuu();
    dienFormLuu({ sdt: "0905123456", email: "an@gmail.com", tiepThi: true });
    const tho = kho.map.get(KHOA_BAN_NHAP) ?? "";
    expect(tho.length).toBeGreaterThan(0);
    expect(tho).not.toMatch(/0905123456|905123456|an@gmail|soDienThoai|email|diem|tiepThi/);
  });
  it("thành công ⇒ xoá nháp", async () => {
    const kho = khoGia();
    dung({ kho });
    await diDenFormLuu();
    expect(kho.map.has(KHOA_BAN_NHAP)).toBe(true);
    dienFormLuu();
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    await screen.findByTestId("disc-thanh-cong");
    expect(kho.map.has(KHOA_BAN_NHAP)).toBe(false);
  });
  it("lỗi lưu ⇒ nháp còn nguyên", async () => {
    const kho = khoGia();
    dung({ kho, goiApi: vi.fn<GoiLuu>(async () => ({ ok: false, loi: "MANG" })) });
    await diDenFormLuu();
    dienFormLuu();
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    await screen.findByTestId("disc-loi-luu");
    expect(kho.map.has(KHOA_BAN_NHAP)).toBe(true);
  });
  it("khôi phục: hỏi trước, 'Làm tiếp' trả về đúng câu đang dở và giữ khoá", async () => {
    const kho = khoGia();
    ghiBanNhap(
      kho,
      {
        buoc: "phuHuynh",
        idempotencyKey: "khoa-cu-0123456789abcdef",  // gitleaks:allow
        hoSo: { phuHuynh: { hoTen: "Mẹ Giả Một", vaiTro: "ME", namSinh: "1988" }, hocSinh: { hoTen: "Bé Giả Hai", namSinh: "2017", bacHoc: "3" }, xacNhanLech: false },
        bo: BO_GIA,
        traLoi: { PH: { "GIA-PH-1": 5 }, HS: {} },
        cau: { PH: 1, HS: 0 },
      },
      MOC,
    );
    const goiApi = vi.fn<GoiLuu>(async () => thanhCong());
    dung({ kho, goiApi });
    expect(screen.getByTestId("disc-ban-nhap")).toBeTruthy();
    fireEvent.click(screen.getByTestId("disc-ban-nhap-tiep"));
    expect(screen.getByTestId("disc-da-khoi-phuc").textContent).toMatch(/nhập lại hai họ tên/);
    gioLaiTen();
    fireEvent.click(screen.getByTestId("disc-ho-so-tiep"));
    expect(await screen.findByText("Câu 2 / 2")).toBeTruthy();
    expect(screen.queryByTestId("disc-ban-nhap")).toBeNull();
    // làm nốt tới khi lưu: phải dùng khoá cũ
    fireEvent.click(screen.getByLabelText(/Rất đúng/));
    fireEvent.click(screen.getByTestId("disc-cau-xong"));
    lamBai();
    await screen.findByRole("option", { name: "Phường Hải Châu" }); // danh mục địa chỉ đã tải xong
    dienFormLuu();
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    await waitFor(() => expect(goiApi).toHaveBeenCalled());
    expect((goiApi as ReturnType<typeof vi.fn>).mock.calls[0][0].idempotencyKey).toBe("khoa-cu-0123456789abcdef");
  });
  it("'Bắt đầu lại' xoá nháp", () => {
    const kho = khoGia();
    ghiBanNhap(kho, { buoc: "hoSo", idempotencyKey: "khoa-cu-0123456789abcdef", hoSo: { phuHuynh: { hoTen: "A", vaiTro: "", namSinh: "" }, hocSinh: { hoTen: "", namSinh: "", bacHoc: "" }, xacNhanLech: false }, bo: BO_GIA, traLoi: { PH: {}, HS: {} }, cau: { PH: 0, HS: 0 } }, MOC);  // gitleaks:allow
    dung({ kho });
    fireEvent.click(screen.getByTestId("disc-ban-nhap-xoa"));
    expect(kho.map.has(KHOA_BAN_NHAP)).toBe(false);
    expect((screen.getByLabelText("Họ và tên") as HTMLInputElement).value).toBe("");
  });
  it("nháp hỏng hoặc quá hạn ⇒ bỏ qua, không hỏi", () => {
    dung({ kho: khoGia({ [KHOA_BAN_NHAP]: "{không phải json" }) });
    expect(screen.queryByTestId("disc-ban-nhap")).toBeNull();
    cleanup();
    const kho = khoGia();
    ghiBanNhap(kho, { buoc: "hoSo", idempotencyKey: "khoa-cu-0123456789abcdef", hoSo: { phuHuynh: { hoTen: "A", vaiTro: "", namSinh: "" }, hocSinh: { hoTen: "", namSinh: "", bacHoc: "" }, xacNhanLech: false }, bo: BO_GIA, traLoi: { PH: {}, HS: {} }, cau: { PH: 0, HS: 0 } }, MOC - 3 * 3_600_000);  // gitleaks:allow
    dung({ kho });
    expect(screen.queryByTestId("disc-ban-nhap")).toBeNull();
  });
  it("[DISC-UI-07b] nháp KHÔNG chứa họ tên của phụ huynh hay của bé (đo trên chuỗi thô ghi xuống kho)", async () => {
    const kho = khoGia();
    dung({ kho });
    dienHoSo();
    await tiepHoSo();
    lamBai();
    const tho = kho.map.get(KHOA_BAN_NHAP) ?? "";
    expect(tho.length).toBeGreaterThan(0);
    expect(tho).not.toMatch(/Giả Một|Giả Hai|hoTen/);
    expect(tho).toMatch(/1988/); // đối chứng dương: nháp CÓ ghi thứ được phép (năm sinh)
    expect(tho).toMatch(/GIA-PH/);
  });
  it("[DISC-UI-07c] mặc định nháp nằm ở sessionStorage, KHÔNG phải localStorage", async () => {
    render(<HanhTrinhDisc layBoDe={layBoDeGia()} goiApi={vi.fn<GoiLuu>()} namNay={NAM_NAY} bayGio={() => MOC} sinhKhoa={() => "khoa-gia-0123456789abcdef"} />);
    dienHoSo();
    await tiepHoSo();
    expect(window.sessionStorage.getItem(KHOA_BAN_NHAP)).not.toBeNull();
    expect(window.localStorage.getItem(KHOA_BAN_NHAP)).toBeNull();
    expect(window.localStorage.getItem(KHOA_BAN_NHAP_CU_V1)).toBeNull();
  });
  it("[DISC-UI-07d] nháp v1 cũ (localStorage, có tên) bị xoá ngay khi trang mở", () => {
    window.localStorage.setItem(KHOA_BAN_NHAP_CU_V1, JSON.stringify({ v: 1, hoSo: { hocSinh: { hoTen: "Bé Giả Hai" } } }));
    dung();
    expect(window.localStorage.getItem(KHOA_BAN_NHAP_CU_V1)).toBeNull();
  });
  it("[DISC-UI-07e] nháp quá 2 giờ ⇒ bị bỏ; còn trong 2 giờ ⇒ hỏi", () => {
    const kho = khoGia();
    const vao = { buoc: "hoSo" as const, idempotencyKey: "khoa-cu-0123456789abcdef", hoSo: { phuHuynh: { vaiTro: "", namSinh: "1988" }, hocSinh: { namSinh: "", bacHoc: "" }, xacNhanLech: false }, traLoi: { PH: {}, HS: {} }, cau: { PH: 0, HS: 0 } };  // gitleaks:allow
    ghiBanNhap(kho, vao, MOC - 2 * 3_600_000 - 1);
    dung({ kho });
    expect(screen.queryByTestId("disc-ban-nhap")).toBeNull();
    cleanup();
    ghiBanNhap(kho, vao, MOC - 2 * 3_600_000);
    dung({ kho });
    expect(screen.getByTestId("disc-ban-nhap")).toBeTruthy();
  });
  it("localStorage ném lỗi / không có ⇒ hành trình vẫn chạy đủ", async () => {
    dung({ kho: khoNem });
    await diDenFormLuu();
    dienFormLuu();
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    await screen.findByTestId("disc-thanh-cong");
    cleanup();
    dung({ kho: null });
    expect(screen.getByTestId("disc-ho-so")).toBeTruthy();
  });
});

describe("[DISC-UI-S10] khoá idempotency: chỉ nguồn ngẫu nhiên MẬT MÃ, không rơi về Date.now()/Math.random()", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("có randomUUID ⇒ dùng nó", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "11111111-2222-3333-4444-555555555555", getRandomValues: () => new Uint8Array(16) });
    expect(sinhKhoaMacDinh()).toBe("11111111-2222-3333-4444-555555555555");
  });
  it("ngữ cảnh không an toàn (không randomUUID) ⇒ getRandomValues (CSPRNG), ≥128 bit, không đụng Math.random/Date.now", () => {
    let n = 0;
    vi.stubGlobal("crypto", { getRandomValues: (b: Uint8Array) => (b.fill(++n), b) });
    const rnd = vi.spyOn(Math, "random");
    const now = vi.spyOn(Date, "now");
    const a = sinhKhoaMacDinh();
    const b = sinhKhoaMacDinh();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    expect(rnd).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });
  it("không có crypto nào ⇒ NÉM KhongCoNguonNgauNhienError (không sinh khoá đoán được)", () => {
    vi.stubGlobal("crypto", undefined);
    const rnd = vi.spyOn(Math, "random");
    expect(() => sinhKhoaMacDinh()).toThrow(KhongCoNguonNgauNhienError);
    expect(rnd).not.toHaveBeenCalled();
  });
  it("UI: sinh khoá thất bại ⇒ lời thân thiện, KHÔNG gọi API lưu, form còn nguyên", async () => {
    const goiApi = vi.fn<GoiLuu>(async () => thanhCong());
    dung({
      goiApi,
      sinhKhoa: () => {
        throw new KhongCoNguonNgauNhienError();
      },
    });
    await diDenFormLuu();
    dienFormLuu();
    fireEvent.click(screen.getByTestId("disc-luu-gui"));
    const loi = await screen.findByTestId("disc-loi-luu");
    expect(loi.textContent).toMatch(/chưa hỗ trợ/);
    expect(loi.textContent).not.toMatch(/KHONG_CO|Error|undefined/);
    expect(goiApi).not.toHaveBeenCalled();
    expect(screen.queryByTestId("disc-thanh-cong")).toBeNull();
    expect((screen.getByLabelText(/Số điện thoại/) as HTMLInputElement).value).toBe("0905123456");
  });
});
