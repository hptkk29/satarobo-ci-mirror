// lib/finance/hoa-don/nha-cung-cap/registry.ts — ProviderRegistry: (pháp nhân × môi trường) → adapter. THUẦN.
//
// Cấu hình được TIÊM vào lúc dựng — registry không đọc env, không đọc DB, không import cổng nào. Việc đọc
// cấu hình (env VPS, bảng pháp nhân) là của tầng nối SAU này; registry chỉ giữ luật chọn:
//
//   1. KHÔNG TÌM THẤY ⇒ `null`. Không rơi về adapter khác, không rơi sang môi trường khác: TEST không bao giờ
//      "đỡ" cho PROD và ngược lại; pháp nhân chưa khai không mượn adapter của pháp nhân khác. Chuyển nhà cung
//      cấp ngầm trên hoá đơn thuế là sự cố, không phải tính năng. Nơi gọi đọc `null` thành "chưa cấu hình"
//      (giữ đúng hành vi hiện tại: không nút, không phát hành).
//   2. CẤM HAI ADAPTER CHO MỘT KHOÁ ⇒ ném ngay lúc dựng registry (không đợi đến lúc phát hành mới lộ).
//   3. PROD PHẢI KHAI TƯỜNG MINH, và chỉ nhận adapter ở môi trường THẬT; TEST chỉ nhận GIA_LAP/SANDBOX — để
//      môi trường test không thể phát hành chứng từ thuế thật, và PROD không thể lặng lẽ chạy mô phỏng.
//   4. Adapter dựng ra phải ĐÚNG nhà cung cấp mà mục khai (hàm tạo không được đổi nhà cung cấp ngầm).
//   5. Mục sai (lỗi cặp môi trường / nhà cung cấp) KHÔNG được nhớ đệm — hỏi lại vẫn ném.
//
// Adapter được dựng LƯỜI, một lần cho mỗi khoá, và nhớ trong chính thể hiện registry (không biến toàn cục).

import { MA_NHA_CUNG_CAP, type HoaDonNhaCungCap, type MaNhaCungCap } from "./hop-dong";

export type MoiTruongDangKy = "TEST" | "PROD";

const MOI_TRUONG_DANG_KY: readonly MoiTruongDangKy[] = ["TEST", "PROD"];

export type MucDangKy = Readonly<{
  /** Mã pháp nhân — khớp CHÍNH XÁC (không chuẩn hoá chữ hoa, không cắt khoảng trắng). */
  phapNhanMa: string;
  moiTruong: MoiTruongDangKy;
  nhaCungCap: MaNhaCungCap;
  taoAdapter: () => HoaDonNhaCungCap;
}>;

export type KhaiBaoMoTa = Readonly<{ phapNhanMa: string; moiTruong: MoiTruongDangKy; nhaCungCap: MaNhaCungCap }>;

export type MaLoiDangKy =
  | "DUPLICATE_PROVIDER_BINDING"
  | "INVALID_PROVIDER_BINDING"
  | "PROVIDER_ENVIRONMENT_MISMATCH"
  | "PROVIDER_MISMATCH";

/** Lỗi cấu hình registry. Mã EN cho máy, thông điệp VI cho người vận hành; không bao giờ chứa bí mật. */
export class LoiDangKyNhaCungCap extends Error {
  constructor(
    readonly ma: MaLoiDangKy,
    thongDiep: string,
  ) {
    super(thongDiep);
    this.name = "LoiDangKyNhaCungCap";
  }
}

export interface RegistryNhaCungCap {
  /** `null` = không có khai báo cho đúng khoá này. Ném `LoiDangKyNhaCungCap` nếu khai báo có nhưng sai. */
  layAdapter(phapNhanMa: string, moiTruong: MoiTruongDangKy): HoaDonNhaCungCap | null;
  /** Có khai báo không — KHÔNG dựng adapter. */
  coKhaiBao(phapNhanMa: string, moiTruong: MoiTruongDangKy): boolean;
  /** Bản sao mô tả các khai báo — KHÔNG dựng adapter. */
  danhSachKhaiBao(): readonly KhaiBaoMoTa[];
}

function khoaMuc(phapNhanMa: string, moiTruong: string): string {
  return `${moiTruong}\u0000${phapNhanMa}`;
}

function kiemMuc(m: MucDangKy): void {
  if (typeof m.phapNhanMa !== "string" || m.phapNhanMa.length === 0 || m.phapNhanMa !== m.phapNhanMa.trim()) {
    throw new LoiDangKyNhaCungCap(
      "INVALID_PROVIDER_BINDING",
      "Mã pháp nhân của khai báo nhà cung cấp rỗng hoặc có khoảng trắng đầu/cuối.",
    );
  }
  if (!MOI_TRUONG_DANG_KY.includes(m.moiTruong)) {
    throw new LoiDangKyNhaCungCap(
      "INVALID_PROVIDER_BINDING",
      `Khai báo nhà cung cấp của pháp nhân ${m.phapNhanMa}: môi trường chỉ nhận TEST | PROD.`,
    );
  }
  if (!(MA_NHA_CUNG_CAP as readonly string[]).includes(m.nhaCungCap)) {
    throw new LoiDangKyNhaCungCap(
      "INVALID_PROVIDER_BINDING",
      `Khai báo nhà cung cấp của pháp nhân ${m.phapNhanMa} (${m.moiTruong}): nhà cung cấp không nằm trong danh sách hỗ trợ.`,
    );
  }
  if (typeof m.taoAdapter !== "function") {
    throw new LoiDangKyNhaCungCap(
      "INVALID_PROVIDER_BINDING",
      `Khai báo nhà cung cấp của pháp nhân ${m.phapNhanMa} (${m.moiTruong}): thiếu hàm tạo adapter.`,
    );
  }
  // Chặn sớm cặp chắc chắn sai, không cần dựng adapter: mô phỏng không bao giờ là "thật".
  if (m.moiTruong === "PROD" && m.nhaCungCap === "MOCK") {
    throw new LoiDangKyNhaCungCap(
      "PROVIDER_ENVIRONMENT_MISMATCH",
      `Pháp nhân ${m.phapNhanMa}: PROD không được khai adapter mô phỏng (MOCK).`,
    );
  }
}

function kiemAdapterDung(m: MucDangKy, adapter: HoaDonNhaCungCap): void {
  if (adapter.nhaCungCap !== m.nhaCungCap) {
    throw new LoiDangKyNhaCungCap(
      "PROVIDER_MISMATCH",
      `Pháp nhân ${m.phapNhanMa} (${m.moiTruong}) khai nhà cung cấp ${m.nhaCungCap} nhưng hàm tạo trả adapter của ${adapter.nhaCungCap}.`,
    );
  }
  const duocMoiTruong =
    m.moiTruong === "PROD" ? adapter.moiTruongVanHanh === "THAT" : adapter.moiTruongVanHanh === "GIA_LAP" || adapter.moiTruongVanHanh === "SANDBOX";
  if (!duocMoiTruong) {
    throw new LoiDangKyNhaCungCap(
      "PROVIDER_ENVIRONMENT_MISMATCH",
      `Pháp nhân ${m.phapNhanMa}: khai báo ${m.moiTruong} nhưng adapter ${adapter.nhaCungCap} đang ở môi trường ${adapter.moiTruongVanHanh} ` +
        `(PROD chỉ nhận môi trường THAT; TEST chỉ nhận GIA_LAP hoặc SANDBOX).`,
    );
  }
}

export function taoRegistryNhaCungCap(mucs: readonly MucDangKy[]): RegistryNhaCungCap {
  const theoKhoa = new Map<string, MucDangKy>();
  for (const m of mucs) {
    kiemMuc(m);
    const k = khoaMuc(m.phapNhanMa, m.moiTruong);
    if (theoKhoa.has(k)) {
      throw new LoiDangKyNhaCungCap(
        "DUPLICATE_PROVIDER_BINDING",
        `Pháp nhân ${m.phapNhanMa} (${m.moiTruong}) đã có khai báo nhà cung cấp — cấm khai hai adapter cho cùng một khoá.`,
      );
    }
    theoKhoa.set(k, Object.freeze({ ...m }));
  }
  const daDung = new Map<string, HoaDonNhaCungCap>();

  return {
    layAdapter(phapNhanMa, moiTruong) {
      const k = khoaMuc(phapNhanMa, moiTruong);
      const m = theoKhoa.get(k);
      if (!m) return null;
      const co = daDung.get(k);
      if (co) return co;
      const adapter = m.taoAdapter();
      kiemAdapterDung(m, adapter);
      daDung.set(k, adapter);
      return adapter;
    },
    coKhaiBao(phapNhanMa, moiTruong) {
      return theoKhoa.has(khoaMuc(phapNhanMa, moiTruong));
    },
    danhSachKhaiBao() {
      return [...theoKhoa.values()].map((m) => ({ phapNhanMa: m.phapNhanMa, moiTruong: m.moiTruong, nhaCungCap: m.nhaCungCap }));
    },
  };
}
