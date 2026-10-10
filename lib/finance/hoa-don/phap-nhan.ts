// lib/finance/hoa-don/phap-nhan.ts — pháp nhân phát hành hoá đơn + thuế suất theo loại
// đơn. THUẦN: không Prisma, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// HAI PHÁP NHÂN — ĐO TỪ HOÁ ĐƠN THẬT, KHÔNG PHẢI DỮ LIỆU BẨN
//
// Ba tờ ở `E:\websatarobo data\hoadon` (14/09/2026) mang HAI đơn vị bán khác nhau, hai mã
// số thuế khác nhau, hai phần mềm phát hành khác nhau:
//
//   · CÔNG TY CỔ PHẦN CÔNG NGHỆ GIÁO DỤC SATA ROBO  · MST 0402301783
//     258 Lê Thanh Nghị, Phường Hòa Cường, TP Đà Nẵng · ký hiệu 1C26TSR · MISA meInvoice
//   · CÔNG TY CỔ PHẦN CÔNG NGHỆ GIÁO DỤC NEW VISION · MST 0402341070
//     114–116 Hoàng Diệu, Phường Hải Châu, TP Đà Nẵng · ký hiệu 1C26MNV · VIN HOADON
//
// ⚠️ ĐỪNG SUY PHÁP NHÂN TỪ ĐỊA CHỈ CƠ SỞ. "114–116 Hoàng Diệu" TRÙNG địa chỉ CS2
// (CLAUDE.md § Business context), còn "258 Lê Thanh Nghị" không phải cơ sở nào — nó là trụ
// sở đăng ký. Khớp theo địa chỉ là đúng ngẫu nhiên một nửa rồi sai vĩnh viễn nửa còn lại;
// cùng họ với bẫy `Center("hoi-so").address = "Đà Nẵng"` khớp lỏng mọi chuỗi cơ sở đã ghi
// trong memory. Ánh xạ cơ sở → pháp nhân là DỮ LIỆU KHAI (`macDinhTheoCoSo`), không suy.
//
// ⚠️ HỆ THỐNG KHÔNG TỰ KÝ HOÁ ĐƠN. Cả ba tờ đều mang **Mã CQT** (mã cơ quan thuế cấp) và
// **chữ ký số của pháp nhân** — hai thứ chỉ MISA/VIN tạo ra được. Từ 30/09 (bước 1) hệ thống
// có thể NHỜ MISA phát hành qua API khi kế toán bấm "Phát hành qua MISA" (chỉ pháp nhân
// `phanMem = "MISA meInvoice"` — `laPhapNhanMisa`; MISA ký HSM); còn lại vẫn là dựng ĐÚNG bộ
// số cho kế toán làm ở phần mềm phát hành rồi tải lên. Xem docs/ke-toan-hoa-don/PLAN.md "Bước 1".
// ─────────────────────────────────────────────────────────────────────────────

import { KIEU_GIA, type KieuGia } from "@/lib/finance/hoa-don/tinh-hoa-don";

export type PhapNhan = {
  /** Mã do người vận hành đặt, dùng làm khoá tham chiếu. */
  ma: string;
  /** Tên đầy đủ in ở dòng "Đơn vị bán hàng". */
  ten: string;
  maSoThue: string;
  diaChi: string;
  dienThoai?: string;
  /** Hộp thư nhận yêu cầu xuất hoá đơn (BLĐ 22/09/2026 khai cho Sata Robo). */
  email?: string;
  website?: string;
  /** "1C26TSR" — ký hiệu hoá đơn năm nay của pháp nhân đó. */
  kyHieu?: string;
  /** Phần mềm phát hành, để kế toán biết xuất file theo khuôn nào. */
  phanMem?: string;
  ghiChu?: string;
  bat: boolean;
};

/** Thuế suất + quy ước giá, khai theo TỪNG loại đơn. */
export type ThueTheoLoaiDon = {
  /** `OrderType` của Prisma, hoặc "TAT_CA" cho dòng phủ chung. */
  loaiDon: string;
  thueSuat: number;
  kieuGia: KieuGia;
  ghiChu?: string;
};

export type CauHinhHoaDon = {
  phapNhan: PhapNhan[];
  /** `Center.code` → `PhapNhan.ma`. Kế toán vẫn đổi được lúc xuất. */
  macDinhTheoCoSo: { maCoSo: string; maPhapNhan: string }[];
  /** Dùng khi cơ sở của đơn không có dòng khai nào. */
  phapNhanMacDinh?: string;
  thue: ThueTheoLoaiDon[];
};

/**
 * Mặc định dựng từ ĐÚNG ba tờ hoá đơn đo được — không phải số bịa để form có gì hiển thị.
 *
 * `macDinhTheoCoSo` để RỖNG có chủ đích: ba tờ mẫu không đủ để kết luận cơ sở nào phát
 * hành qua pháp nhân nào (tờ New Vision ghi tên một học viên, không ghi cơ sở). Đoán ở đây
 * là gán sai mã số thuế lên hoá đơn thật. Kế toán khai một lần ở màn Cấu hình vận hành.
 *
 * ⚠️ CẬP NHẬT 15/09/2026 — `macDinhTheoCoSo` KHÔNG còn rỗng: chủ dự án đã chốt
 * *"cs1 là satarobo còn cs2 là new vision"*. Xem chú thích ngay tại ô đó, kèm số phiếu đã
 * in SAI pháp nhân trong lúc ô này còn trống.
 */
export const CAU_HINH_HOA_DON_MAC_DINH: CauHinhHoaDon = {
  phapNhan: [
    {
      ma: "SATA_ROBO",
      ten: "CÔNG TY CỔ PHẦN CÔNG NGHỆ GIÁO DỤC SATA ROBO",
      maSoThue: "0402301783",
      // ⚠️ ĐỊA CHỈ ĐỔI THEO QUYẾT ĐỊNH BLĐ 22/09/2026 (hồ sơ Bộ Công Thương).
      // Trước đó ô này là "258 Lê Thanh Nghị…" — ĐO TỪ HOÁ ĐƠN THẬT (1C26TSR-86,
      // 1C26TSR-127), tức đó là địa chỉ đang in trên tờ do MISA phát hành.
      // BLĐ chốt dùng 211 Nguyễn Hữu Thọ cho chứng từ, khớp địa chỉ khai trong hồ sơ BCT.
      // ⇒ KẾ TOÁN PHẢI ĐỔI ĐỊA CHỈ TRONG MISA meInvoice cho khớp; nếu không, phiếu thu
      //   của hệ thống và hoá đơn của MISA sẽ in hai địa chỉ khác nhau cho cùng một đơn.
      diaChi: "211 Nguyễn Hữu Thọ, Phường Hòa Cường, Thành phố Đà Nẵng, Việt Nam",
      dienThoai: "0837.312.860",
      email: "ketoan@satarobo.vn",
      kyHieu: "1C26TSR",
      phanMem: "MISA meInvoice",
      ghiChu:
        "Địa chỉ/điện thoại/email theo quyết định BLĐ 22/09/2026. Ký hiệu + phần mềm đo từ hoá đơn 1C26TSR-86 và 1C26TSR-127 (16/07 và 04/09/2026).",
      bat: true,
    },
    {
      ma: "NEW_VISION",
      ten: "CÔNG TY CỔ PHẦN CÔNG NGHỆ GIÁO DỤC NEW VISION",
      maSoThue: "0402341070",
      diaChi: "114 - 116 Hoàng Diệu, Phường Hải Châu, Thành phố Đà Nẵng, Việt Nam",
      dienThoai: "0702.193.933",
      website: "https://satarobo.vn",
      kyHieu: "1C26MNV",
      phanMem: "VIN HOADON",
      ghiChu:
        "Đo từ hoá đơn 1C26MNV-13 (29/08/2026). Địa chỉ TRÙNG CS2 — trùng thật, đừng dùng địa chỉ để suy pháp nhân.",
      bat: true,
    },
  ],
  /**
   * ÁNH XẠ CƠ SỞ → PHÁP NHÂN — chủ dự án chốt 15/09/2026:
   * *"cs1 là satarobo còn cs2 là new vision đấy nhé"*.
   *
   * Trước đó ô này để RỖNG có chủ đích vì ba tờ mẫu không nói được điều này (tờ New Vision
   * ghi tên một học viên, không ghi cơ sở). Nay có người quyết nên khai thẳng.
   *
   * ⚠️ HỆ QUẢ ĐO ĐƯỢC CỦA VIỆC BỎ TRỐNG: `phapNhanChoDon` rơi về `phapNhanMacDinh`, nên
   * phiếu RCP-CS2-26-0011 của đơn ORD-260915-000010 (cơ sở **CS2**) in ra "CÔNG TY … SATA
   * ROBO · MST 0402301783" — SAI PHÁP NHÂN, sai mã số thuế, trên giấy đưa phụ huynh. Bỏ
   * trống không phải trạng thái trung tính: nó im lặng chọn pháp nhân đầu tiên.
   *
   * ⚠️ Vẫn KHÔNG suy từ địa chỉ. Địa chỉ New Vision ("114–116 Hoàng Diệu") TRÙNG địa chỉ
   * CS2, nên lần này suy theo địa chỉ sẽ đúng — đúng NGẪU NHIÊN. Sata Robo đăng ký ở "258
   * Lê Thanh Nghị", không phải cơ sở nào, nên cùng phép suy đó lại không tìm ra CS1. Đây là
   * DỮ LIỆU KHAI, và chỉ người vận hành mới nói được.
   *
   * ⚠️ `maCoSo` là `Center.code` ("CS1"/"CS2"), KHÔNG phải `Center.id` (id là slug
   * "co-so-nguyen-huu-tho"). Đo trên DB 15/09: code CS1 · CS2 · CS91 · CS92 · HO · ITLI_HO.
   */
  macDinhTheoCoSo: [
    { maCoSo: "CS1", maPhapNhan: "SATA_ROBO" },
    // ⚠️ ĐỔI THEO QUYẾT ĐỊNH BLĐ 22/09/2026: CS2 trước đây ánh xạ sang NEW_VISION (chốt
    // 15/09), nay mọi chứng từ phát sinh qua website đều đứng tên SATA ROBO — pháp nhân
    // đăng ký hồ sơ Bộ Công Thương. Pháp nhân NEW_VISION GIỮ NGUYÊN trong danh sách vì
    // hoá đơn cũ đã phát hành dưới tên đó; chỉ gỡ ánh xạ mặc định.
    { maCoSo: "CS2", maPhapNhan: "SATA_ROBO" },
  ],
  phapNhanMacDinh: "SATA_ROBO",
  thue: [
    {
      loaiDon: "TAT_CA",
      thueSuat: 8,
      kieuGia: KIEU_GIA.DA_GOM_THUE,
      ghiChu:
        "8% là mức trên cả ba tờ đo được. Quy ước giá mặc định lấy theo 2/3 tờ (1C26TSR-86 và 1C26MNV-13): số khách trả ĐÃ GỒM thuế. Tờ còn lại (1C26TSR-127, học phí) lại CHƯA GỒM — kế toán khai riêng dòng COURSE nếu đúng là vậy.",
    },
  ],
};

/** Giá trị `phanMem` của pháp nhân phát hành qua MISA meInvoice — đo từ hoá đơn thật (1C26TSR-86, -127). */
export const PHAN_MEM_MISA = "MISA meInvoice" as const;

/**
 * Bước 1 (30/09) — pháp nhân này có phát hành được qua cổng MISA meInvoice không. MỘT chỗ quyết, cho cả
 * nút trên màn lẫn action: pháp nhân dùng phần mềm khác (NEW_VISION = VIN HOADON) ⇒ không — hoá đơn của
 * họ không thể ký bằng HSM của MISA. So ĐÚNG giá trị khai (không `includes`): một pháp nhân khai lơ mơ
 * thì thà không hiện nút còn hơn gửi sai phần mềm.
 */
export function laPhapNhanMisa(p: Pick<PhapNhan, "phanMem"> | null | undefined): boolean {
  return p?.phanMem?.trim() === PHAN_MEM_MISA;
}

/**
 * Thuế suất + quy ước giá cho một loại đơn. Dòng khai ĐÍCH DANH loại đơn thắng dòng
 * "TAT_CA"; không có dòng nào thì rơi về 8% / đã-gồm-thuế (mức của cả ba tờ đo được).
 *
 * ⚠️ KHÔNG có mặc định 0%: một hoá đơn in nhầm 0% thuế là sai tờ khai thuế, và nó không
 * báo lỗi ở đâu cả. Thà lấy mức phổ biến nhất đo được rồi để kế toán sửa.
 */
export function thueChoLoaiDon(
  loaiDon: string,
  cauHinh: Pick<CauHinhHoaDon, "thue">,
): { thueSuat: number; kieuGia: KieuGia } {
  const dung = cauHinh.thue.find((t) => t.loaiDon === loaiDon);
  const chung = cauHinh.thue.find((t) => t.loaiDon === "TAT_CA");
  const d = dung ?? chung;
  return {
    thueSuat: d?.thueSuat ?? 8,
    kieuGia: d?.kieuGia ?? KIEU_GIA.DA_GOM_THUE,
  };
}

/**
 * Pháp nhân gợi ý cho một đơn: theo cơ sở của đơn, rồi tới mặc định chung, rồi tới pháp
 * nhân ĐANG BẬT đầu tiên. Trả `null` khi không còn gì bật — màn phải bắt chọn tay chứ
 * KHÔNG được im lặng in một mã số thuế nào đó lên hoá đơn.
 */
export function phapNhanChoDon(
  maCoSo: string | null | undefined,
  cauHinh: CauHinhHoaDon,
): PhapNhan | null {
  const dangBat = cauHinh.phapNhan.filter((p) => p.bat);
  const tim = (ma: string | undefined) =>
    ma ? (dangBat.find((p) => p.ma === ma) ?? null) : null;

  const theoCoSo = maCoSo
    ? tim(cauHinh.macDinhTheoCoSo.find((m) => m.maCoSo === maCoSo)?.maPhapNhan)
    : null;
  return theoCoSo ?? tim(cauHinh.phapNhanMacDinh) ?? dangBat[0] ?? null;
}

/**
 * Luật NGHIỆP VỤ của cấu hình hoá đơn — zod ở registry chỉ kiểm hình dạng.
 * Trả mảng câu tiếng Việt; rỗng = hợp lệ. Đường ghi PHẢI gọi hàm này.
 */
export function kiemCauHinhHoaDon(c: CauHinhHoaDon): string[] {
  const loi: string[] = [];

  if (c.phapNhan.length === 0) loi.push("Phải khai ít nhất một pháp nhân.");
  if (c.phapNhan.length > 0 && !c.phapNhan.some((p) => p.bat)) {
    loi.push("Phải có ít nhất một pháp nhân đang bật.");
  }

  const daGap = new Set<string>();
  for (const p of c.phapNhan) {
    if (daGap.has(p.ma)) loi.push(`Mã pháp nhân bị trùng: ${p.ma}`);
    daGap.add(p.ma);
    // MST doanh nghiệp Việt Nam: 10 số, hoặc 13 số dạng đơn vị phụ thuộc (10-3).
    const so = p.maSoThue.replace(/[\s-]/g, "");
    if (!/^\d{10}$|^\d{13}$/.test(so)) {
      loi.push(
        `Mã số thuế của "${p.ten}" phải là 10 hoặc 13 chữ số (đang: ${p.maSoThue}).`,
      );
    }
    if (p.diaChi.trim().length < 5) {
      loi.push(
        `Pháp nhân "${p.ten}" thiếu địa chỉ — địa chỉ là trường bắt buộc trên hoá đơn.`,
      );
    }
  }

  const maHopLe = new Set(c.phapNhan.map((p) => p.ma));
  for (const m of c.macDinhTheoCoSo) {
    if (!maHopLe.has(m.maPhapNhan)) {
      loi.push(
        `Cơ sở "${m.maCoSo}" trỏ tới pháp nhân không tồn tại: ${m.maPhapNhan}`,
      );
    }
  }
  if (c.phapNhanMacDinh && !maHopLe.has(c.phapNhanMacDinh)) {
    loi.push(`Pháp nhân mặc định không tồn tại: ${c.phapNhanMacDinh}`);
  }

  const loaiDaGap = new Set<string>();
  for (const t of c.thue) {
    if (loaiDaGap.has(t.loaiDon)) {
      loi.push(`Loại đơn "${t.loaiDon}" được khai thuế hai lần.`);
    }
    loaiDaGap.add(t.loaiDon);
    // Không chặn cứng vào {0,5,8,10}: mức thuế là chính sách nhà nước, đổi thì đổi ở màn
    // chứ không phải sửa mã. Chỉ chặn số vô nghĩa.
    if (t.thueSuat < 0 || t.thueSuat > 100) {
      loi.push(`Thuế suất của "${t.loaiDon}" phải trong khoảng 0–100%.`);
    }
  }
  if (!c.thue.some((t) => t.loaiDon === "TAT_CA")) {
    loi.push(
      "Phải có dòng thuế 'TAT_CA' làm mức phủ chung — thiếu nó thì loại đơn chưa khai sẽ rơi về mặc định trong mã.",
    );
  }

  return loi;
}
