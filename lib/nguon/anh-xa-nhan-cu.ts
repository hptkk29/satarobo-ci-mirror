/**
 * lib/nguon/anh-xa-nhan-cu.ts — ÁNH XẠ 28 NHÃN `Lead.source` CŨ → 8 NGUỒN MẶC ĐỊNH + UNKNOWN (D10, D12). THUẦN.
 *
 * Đặc tả: `docs/source-commission/07 §2.6.2`; bảng quyết định: văn bản 06/10/2026 §2 (28 dòng đã chốt), ĐÃ ĐỔI ĐÍCH theo
 * SPEC nguồn động 09/10/2026 §1.3:
 *  · bốn nhóm nhân sự (Sale / Quản lý / Giáo viên / nhân sự khác) → MỘT nguồn `EMPLOYEE_REFERRAL`; VAI của họ đi kèm ở
 *    `vaiNguon` để di trú ghi `LeadAttribution.referrerRoleCode` (snapshot);
 *  · nhóm quảng cáo cũ → `PAID_ADS`;
 *  · Organic (#15, #17) → `CENTER_ORGANIC` — ĐẢO bảng 06/10 (khi đó là quảng cáo) theo yêu cầu mới của chủ dự án 09/10:
 *    Marketing 1% theo nguồn không còn thuộc về lead organic.
 *
 * KHÔNG đọc DB, KHÔNG đọc đồng hồ: mọi thứ cần từ DB (người nhập đã giải, aff, mã trong note) do tầng
 * `di-tru-db.ts` giải rồi đưa vào. Ngày tháng là tham số (luật 19).
 *
 * Nguyên tắc cứng của D10: **không đoán**. Nhãn ngoài 28 dòng ⇒ `INVALID` ("0 phiếu không đích" là CỔNG,
 * không phải mục tiêu mềm). Nhóm cần NGƯỜI mà nhãn cũ không mang người ⇒ `referrerMissing` + xem tay —
 * di trú KHÔNG BAO GIỜ tự gán người theo tên nằm trong `note`.
 */
import {
  canNguoi,
  DANH_MUC_GOC,
  nhomGocHoacNem,
  suyVaiNguon,
  type DongVaiSangNguon,
  type MaNhomGoc,
  type MaVaiNguon,
} from "./danh-muc-goc";

export type LuatNhan =
  | { kieu: "CO_DINH"; nhom: MaNhomGoc; vai?: MaVaiNguon }
  /** [PB-9] Đích chốt theo BẰNG CHỨNG TỪNG PHIẾU cũ, không phải luật ngữ nghĩa của nhãn (06/10 §3). */
  | { kieu: "CO_DINH_THEO_PHIEU"; nhom: MaNhomGoc; vai?: MaVaiNguon } // < MOC_KHAO_SAT_0610 ⇒ nhom; ≥ mốc ⇒ xem tay
  | { kieu: "THEO_AFF" } // không aff ⇒ PAID_ADS; có aff ⇒ theo loại aff (PR11)
  | { kieu: "THEO_NGUOI_NHAP" }; // < MOC_NGUOI_NHAP ⇒ PAID_ADS; ≥ mốc ⇒ người nhập (D12)

/** `vai` chỉ có nghĩa với nguồn nhân sự giới thiệu: nó là SNAPSHOT vai ngữ nghĩa, không chọn nguồn. */
const co = (nhom: MaNhomGoc, vai?: MaVaiNguon): LuatNhan => (vai ? { kieu: "CO_DINH", nhom, vai } : { kieu: "CO_DINH", nhom });
const theoPhieu = (nhom: MaNhomGoc, vai?: MaVaiNguon): LuatNhan =>
  vai ? { kieu: "CO_DINH_THEO_PHIEU", nhom, vai } : { kieu: "CO_DINH_THEO_PHIEU", nhom };
const nv = (vai: MaVaiNguon): LuatNhan => co("EMPLOYEE_REFERRAL", vai);

/** NGUYÊN VĂN §2 tài liệu 06/10 (28 dòng, đã chốt). `stt` = số dòng của bảng đó, để in và để lưới so. */
export const BANG_ANH_XA_0610: readonly { stt: number; nhan: string; luat: LuatNhan }[] = [
  { stt: 1, nhan: "Quản Lý Trung Tâm", luat: nv("MANAGER") },
  { stt: 2, nhan: "legacy-sheet", luat: co("PAID_ADS") },
  { stt: 3, nhan: "Nguồn từ Marketing Hội Sở từ Quảng Cáo", luat: co("PAID_ADS") },
  { stt: 4, nhan: "Nguồn từ Ban lãnh đạo công ty", luat: nv("MANAGER") },
  { stt: 5, nhan: "quatang", luat: { kieu: "THEO_AFF" } },
  { stt: 6, nhan: "Ads", luat: co("PAID_ADS") },
  { stt: 7, nhan: "sale-form", luat: { kieu: "THEO_NGUOI_NHAP" } },
  { stt: 8, nhan: "Quản lý trung tâm", luat: nv("MANAGER") },
  { stt: 9, nhan: "covua.quatang.edu.vn", luat: { kieu: "THEO_AFF" } },
  { stt: 10, nhan: "Khác", luat: theoPhieu("EMPLOYEE_REFERRAL", "SALE") },
  { stt: 11, nhan: "Giới thiệu", luat: co("PARENT_REFERRAL") },
  { stt: 12, nhan: "sale-form-app", luat: { kieu: "THEO_NGUOI_NHAP" } },
  { stt: 13, nhan: "Form", luat: co("PAID_ADS") },
  { stt: 14, nhan: "Nguồn khác", luat: theoPhieu("EMPLOYEE_REFERRAL", "MANAGER") },
  { stt: 15, nhan: "Organic", luat: co("CENTER_ORGANIC") },
  { stt: 16, nhan: "Website", luat: co("WALK_IN") },
  { stt: 17, nhan: "Nguồn từ Marketing Hội Sở từ Organic", luat: co("CENTER_ORGANIC") },
  { stt: 18, nhan: "Sale tự kiếm", luat: nv("SALE") },
  { stt: 19, nhan: "Nguồn từ Sale tự kiếm", luat: nv("SALE") },
  { stt: 20, nhan: "Quản lý Trung Tâm", luat: nv("MANAGER") },
  { stt: 21, nhan: "Con cổ đông", luat: nv("MANAGER") },
  { stt: 22, nhan: "Nhập tay", luat: theoPhieu("EMPLOYEE_REFERRAL", "MANAGER") },
  { stt: 23, nhan: "Tự khai thác", luat: nv("SALE") },
  { stt: 24, nhan: "lead cũ khi làm bên LTN gọi học trải nghiệm 5 buổi", luat: nv("MANAGER") },
  { stt: 25, nhan: "Nguồn từ phụ huynh giới thiệu", luat: co("PARENT_REFERRAL") },
  { stt: 26, nhan: "Import Excel ĐK", luat: nv("MANAGER") },
  { stt: 27, nhan: "lien-he", luat: co("WALK_IN") },
  { stt: 28, nhan: "Nguồn KH tự đến Trung Tâm", luat: co("WALK_IN") },
];

/** 01/10/2026 00:00 giờ VN. */
export const MOC_NGUOI_NHAP: Date = new Date("2026-09-30T17:00:00.000Z");

/**
 * Mốc nghiệm thu 06/10: nhãn #28 sinh 16:20:13 giờ VN ⇒ so §8.3 với createdAt < 2026-10-06T09:21:00Z.
 * Cũng là mốc của luật CO_DINH_THEO_PHIEU ([PB-9]): mọi phiếu chủ dự án đã xem đều tạo trước mốc này.
 */
export const MOC_KHAO_SAT_0610: Date = new Date("2026-10-06T09:21:00.000Z");

/** NFC + trim + gộp khoảng trắng + toLowerCase(). Rỗng ⇒ null. */
export function chuanHoaNhanNguon(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = raw.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  return s === "" ? null : s;
}

/** Cùng kiểu + cùng nhóm + cùng VAI (vai được ghi vào `referrerRoleCode` nên hai dòng cùng khoá mà khác vai là mâu thuẫn). */
const cungLuat = (a: LuatNhan, b: LuatNhan): boolean =>
  a.kieu === b.kieu &&
  ("nhom" in a ? "nhom" in b && a.nhom === b.nhom && (a.vai ?? null) === (b.vai ?? null) : !("nhom" in b));

/**
 * [PB-24] Dựng bảng tra từ các dòng — THUẦN, export để ca âm gọi được. Khoá = `chuanHoaNhanNguon(nhan)`;
 * hai dòng cùng khoá mà khác `luat` (so sâu) ⇒ ném. Module gọi nó MỘT lần lúc nạp trên BANG_ANH_XA_0610.
 */
export function dungBangTra(
  rows: readonly { stt: number; nhan: string; luat: LuatNhan }[],
): ReadonlyMap<string, { stt: number; luat: LuatNhan }> {
  const bang = new Map<string, { stt: number; luat: LuatNhan }>();
  for (const r of rows) {
    const khoa = chuanHoaNhanNguon(r.nhan);
    if (khoa === null) throw new Error(`Dòng ${r.stt}: nhãn rỗng`);
    const cu = bang.get(khoa);
    if (cu) {
      if (!cungLuat(cu.luat, r.luat)) {
        throw new Error(`Hai dòng (#${cu.stt}, #${r.stt}) cùng khoá "${khoa}" mà KHÁC luật — bảng ánh xạ tự mâu thuẫn`);
      }
      continue; // cùng luật ⇒ giữ dòng đầu
    }
    bang.set(khoa, { stt: r.stt, luat: r.luat });
  }
  return bang;
}

const BANG_TRA = dungBangTra(BANG_ANH_XA_0610);

/**
 * Nhãn (đã chuẩn hoá) có phải loại "máy" mà NGƯỜI NHẬP quyết nhóm (sale-form, sale-form-app) không.
 * Tầng DB hỏi hàm này để biết dòng nào cần giải người nhập — không chép danh sách nhãn thứ hai.
 */
export function laNhanTheoNguoiNhap(nhanChuan: string | null): boolean {
  return nhanChuan !== null && BANG_TRA.get(nhanChuan)?.luat.kieu === "THEO_NGUOI_NHAP";
}

export type LyDoXemTay =
  | "THIEU_NGUOI"
  | "MA_NV_KHONG_GIAI"
  | "AFF_CHUA_PHAN_LOAI"
  | "NHAN_CHOT_THEO_PHIEU" // [PB-9] nhãn #10/#14/#22 trên phiếu tạo SAU MOC_KHAO_SAT_0610
  | "VAI_SUY_TU_HIEN_TAI"; // [PB-12] người nhập không có vai hiệu lực tại createdAt — nhóm suy từ vai hôm nay

export type KetQuaAnhXa =
  | { loai: "INVALID"; nhanChuan: string }
  | {
      loai: "MAPPED" | "UNKNOWN";
      /** Mã nhóm — 9 mã gốc, hoặc nhóm do admin cấu hình làm đích "nhân sự giới thiệu" (đường sống, `nhomNhanSu`). */
      nhom: MaNhomGoc | (string & {});
      stt: number | null; // dòng bảng 06/10; null với nhãn rỗng
      nguoi: { kind: "EMPLOYEE"; employeeId: string } | null;
      /** Vai ngữ nghĩa của nhân sự giới thiệu — SNAPSHOT để ghi `referrerRoleCode`. null khi nguồn không phải nhân sự giới thiệu. */
      vaiNguon: MaVaiNguon | null;
      referrerMissing: boolean;
      giaiTrinh: string | null; // chỉ nhóm OTHER; ≥ 10 ký tự
      xemTay: LyDoXemTay[];
    };

export type DauVaoAnhXa = {
  nhan: string | null;
  createdAt: Date;
  /** Trước PR11: `loai` luôn null (Affiliate chưa có cột kind). */
  affiliate: { ton: boolean; loai: "CA_NHAN" | "TO_CHUC" | null } | null;
  /** ĐÃ GIẢI ở tầng DB: từ `createdById → User.employeeId`, không có thì từ mã trong note theo NGÀY. */
  nguoiNhap: { employeeId: string; roleCodes: readonly string[]; vaiTuHienTai: boolean } | null;
  /** Mã đã chuẩn hoá (để in giải trình khi không giải được). */
  maNvTrongNote: string | null;
};

const ket = (
  nhom: MaNhomGoc | (string & {}),
  stt: number | null,
  phu: Partial<Omit<Extract<KetQuaAnhXa, { loai: "MAPPED" | "UNKNOWN" }>, "loai" | "nhom" | "stt">> = {},
): KetQuaAnhXa => ({
  loai: nhom === "UNKNOWN" ? "UNKNOWN" : "MAPPED",
  nhom,
  stt,
  nguoi: phu.nguoi ?? null,
  vaiNguon: phu.vaiNguon ?? null,
  referrerMissing: phu.referrerMissing ?? false,
  giaiTrinh: phu.giaiTrinh ?? null,
  xemTay: phu.xemTay ?? [],
});

/**
 * @param nhomNhanSu Nhóm đích khi nhãn chỉ nói "người nhập là nhân sự" (`THEO_NGUOI_NHAP`): đường sống truyền setting
 *   `nguon.nhomNhanSuMacDinh`, di trú truyền `NHOM_NHAN_SU_GOC`. BẮT BUỘC (luật 7) — vai KHÔNG chọn nhóm.
 */
export function anhXaNhanCu(input: DauVaoAnhXa, vaiSangNguon: readonly DongVaiSangNguon[], nhomNhanSu: string): KetQuaAnhXa {
  // 1. Nhãn rỗng ⇒ UNKNOWN (D7: khác nguồn 11).
  const nhanChuan = chuanHoaNhanNguon(input.nhan);
  if (nhanChuan === null) return ket("UNKNOWN", null);

  // 2. Ngoài 28 dòng ⇒ INVALID — không đoán.
  const dong = BANG_TRA.get(nhanChuan);
  if (!dong) return { loai: "INVALID", nhanChuan };
  const { stt, luat } = dong;
  const nhanIn = (input.nhan ?? "").trim();

  // 3. Đích cố định.
  if (luat.kieu === "CO_DINH") return coDinh(luat.nhom, stt, luat.vai ?? null);
  if (luat.kieu === "CO_DINH_THEO_PHIEU") {
    if (input.createdAt.getTime() < MOC_KHAO_SAT_0610.getTime()) return coDinh(luat.nhom, stt, luat.vai ?? null);
    return ket("OTHER", stt, {
      giaiTrinh: `Nhãn "${nhanIn}" chỉ được chốt đích theo từng phiếu tới 06/10/2026 — phiếu sau mốc chưa có đích`,
      xemTay: ["NHAN_CHOT_THEO_PHIEU"],
    });
  }

  // 4. Theo aff.
  if (luat.kieu === "THEO_AFF") {
    const aff = input.affiliate;
    if (aff === null || !aff.ton) return ket("PAID_ADS", stt);
    if (aff.loai === null) return ket("UNKNOWN", stt, { xemTay: ["AFF_CHUA_PHAN_LOAI"] });
    // Luật theo loại aff (CA_NHAN / TO_CHUC) thuộc PR11 — dùng sớm là NÉM, không đoán.
    throw new Error("PR11: luật quy nguồn theo loại affiliate chưa được hiện thực ở PR1");
  }

  // 5. Theo người nhập (D12).
  if (input.createdAt.getTime() < MOC_NGUOI_NHAP.getTime()) return ket("PAID_ADS", stt);
  const nguoi = input.nguoiNhap;
  if (nguoi) {
    return ket(nhomNhanSu, stt, {
      nguoi: { kind: "EMPLOYEE", employeeId: nguoi.employeeId },
      vaiNguon: suyVaiNguon(nguoi.roleCodes, vaiSangNguon),
      xemTay: nguoi.vaiTuHienTai ? ["VAI_SUY_TU_HIEN_TAI"] : [],
    });
  }
  // D12: KHÔNG âm thầm về quảng cáo — vào nguồn khác (OTHER) có giải trình, và xem tay.
  const ma = input.maNvTrongNote;
  return ket("OTHER", stt, {
    giaiTrinh: ma
      ? `Mã nhân viên "${ma}" không có trong hệ thống tại ngày tạo phiếu (nhãn ${nhanIn})`
      : `Phiếu nhãn ${nhanIn} từ 01/10/2026 không có mã/ID người nhập`,
    xemTay: ["MA_NV_KHONG_GIAI"],
  });
}

/** Nhóm cần NGƯỜI mà nhãn cũ không mang người ⇒ thiếu người, xem tay (không bao giờ tự gán theo tên trong note). */
function coDinh(nhom: MaNhomGoc, stt: number, vai: MaVaiNguon | null): KetQuaAnhXa {
  return canNguoi(nhom)
    ? ket(nhom, stt, { vaiNguon: vai, referrerMissing: true, xemTay: ["THIEU_NGUOI"] })
    : ket(nhom, stt, { vaiNguon: vai });
}

// ── Tóm tắt cả lượt di trú ──────────────────────────────────────────────────────────────────────

export type HangDiTru = { leadId: string; kq: KetQuaAnhXa; nhanChuan: string | null; createdAt: Date };

export type TomTatDiTru = {
  total: number;
  mapped: number;
  unknown: number;
  invalid: number;
  duplicate: number;
  manualReview: number;
  /** Trong `manualReview`: số lead CŨNG trùng SĐT (phiếu #10/#14/#22 sau mốc ưu tiên ManualReview hơn Duplicate). */
  manualReviewTrungSdt: number;
  /** = total − invalid. */
  seGhi: number;
  /** Mọi dòng KHÔNG invalid, bất kể nhóm phân hoạch. */
  theoDich: Record<MaNhomGoc, number>;
  theoDichTruocMocKhaoSat: Record<MaNhomGoc, number>;
  /**
   * Mỗi dòng = MỘT cặp (nhãn × đích). `soXemTay` = số lead của dòng có ≥1 lý do xem tay (AUTO = `soLead − soXemTay`) —
   * độc lập với việc lead đó rơi nhóm phân hoạch nào (Duplicate hay MANUAL_REVIEW).
   */
  theoNhan: { nhanChuan: string | null; stt: number | null; nhom: MaNhomGoc | "INVALID"; soLead: number; soXemTay: number }[];
  /** Đếm trong nhóm MANUAL_REVIEW (SAU phân hoạch). Một dòng nhiều lý do được đếm ở mỗi lý do. */
  xemTayTheoLyDo: Record<LyDoXemTay, number>;
};

const khongTheoDich = (): Record<MaNhomGoc, number> =>
  Object.fromEntries(DANH_MUC_GOC.map((d) => [d.code, 0])) as Record<MaNhomGoc, number>;

/**
 * Sáu nhóm là PHÂN HOẠCH (E6) — mỗi dòng vào ĐÚNG MỘT nhóm, theo thứ tự ưu tiên:
 * INVALID → MANUAL_REVIEW nếu xemTay có `NHAN_CHOT_THEO_PHIEU` → DUPLICATE (leadId ∈ trungSdt) →
 * MANUAL_REVIEW (xemTay không rỗng) → UNKNOWN → MAPPED.
 * Bất biến: `mapped + unknown + invalid + duplicate + manualReview === total`.
 *
 * [M3 — 07/10] `NHAN_CHOT_THEO_PHIEU` đứng TRƯỚC Duplicate: Duplicate là "vẫn ghi, liệt kê để gộp" (03 §7.1) còn
 * phiếu #10/#14/#22 sau mốc là thứ D21 KHÔNG cho ghi tự động — để Duplicate hút nó thì báo cáo nói "vẫn ghi" về đúng
 * thứ không được ghi, và số phiếu chờ xem tay (mục 6) thiếu những phiếu trùng SĐT. Các lý do xem tay KHÁC
 * (THIEU_NGUOI, …) vẫn để Duplicate thắng như trước — spec nói cả hai nhóm đều "ghi".
 * `seGhi` KHÔNG đổi (= total − invalid): H21 (PR3 `--apply` xử lý quãng chờ thế nào) còn mở, mặc định không ghi
 * tự động — số phiếu đó đọc ở `xemTayTheoLyDo.NHAN_CHOT_THEO_PHIEU`.
 */
export function tomTatDiTru(rows: readonly HangDiTru[], trungSdt: ReadonlySet<string>): TomTatDiTru {
  const t: TomTatDiTru = {
    total: rows.length,
    mapped: 0,
    unknown: 0,
    invalid: 0,
    duplicate: 0,
    manualReview: 0,
    manualReviewTrungSdt: 0,
    seGhi: 0,
    theoDich: khongTheoDich(),
    theoDichTruocMocKhaoSat: khongTheoDich(),
    theoNhan: [],
    xemTayTheoLyDo: {
      THIEU_NGUOI: 0,
      MA_NV_KHONG_GIAI: 0,
      AFF_CHUA_PHAN_LOAI: 0,
      NHAN_CHOT_THEO_PHIEU: 0,
      VAI_SUY_TU_HIEN_TAI: 0,
    },
  };
  const theoNhan = new Map<string, TomTatDiTru["theoNhan"][number]>();

  for (const h of rows) {
    const k = h.kq;
    const nhomIn: MaNhomGoc | "INVALID" = k.loai === "INVALID" ? "INVALID" : nhomGocHoacNem(k.nhom);
    const khoa = `${h.nhanChuan ?? ""}\u0000${nhomIn}`;
    const dong = theoNhan.get(khoa);
    const xem = k.loai !== "INVALID" && k.xemTay.length > 0 ? 1 : 0;
    if (dong) {
      dong.soLead += 1;
      dong.soXemTay += xem;
    } else theoNhan.set(khoa, { nhanChuan: h.nhanChuan, stt: k.loai === "INVALID" ? null : k.stt, nhom: nhomIn, soLead: 1, soXemTay: xem });

    if (k.loai === "INVALID") {
      t.invalid += 1;
      continue;
    }
    t.theoDich[nhomIn as MaNhomGoc] += 1;
    if (h.createdAt.getTime() < MOC_KHAO_SAT_0610.getTime()) t.theoDichTruocMocKhaoSat[nhomIn as MaNhomGoc] += 1;
    const trung = trungSdt.has(h.leadId);
    if (trung && !k.xemTay.includes("NHAN_CHOT_THEO_PHIEU")) t.duplicate += 1;
    else if (k.xemTay.length > 0) {
      t.manualReview += 1;
      if (trung) t.manualReviewTrungSdt += 1;
      // [F3] Đếm lý do SAU phân hoạch: chỉ dòng thật sự nằm ở nhóm MANUAL_REVIEW. Đếm trước (khi dòng còn có
      // thể rơi sang DUPLICATE) làm tổng lý do lệch khỏi `manualReview`. Dòng có NHIỀU lý do được đếm ở MỖI
      // lý do ⇒ tổng các lý do ≥ `manualReview` (dấu = chỉ khi mọi dòng chỉ có một lý do).
      for (const ly of k.xemTay) t.xemTayTheoLyDo[ly] += 1;
    }
    else if (k.loai === "UNKNOWN") t.unknown += 1;
    else t.mapped += 1;
  }

  t.seGhi = t.total - t.invalid;
  // Sắp ở tầng JS (không `orderBy _count` — 06/10 §10): nhiều lead trước, rồi theo tên để tất định.
  t.theoNhan = [...theoNhan.values()].sort(
    (a, b) => b.soLead - a.soLead || (a.nhanChuan ?? "").localeCompare(b.nhanChuan ?? "") || a.nhom.localeCompare(b.nhom),
  );
  return t;
}
