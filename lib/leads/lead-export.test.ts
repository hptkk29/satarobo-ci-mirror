// G-03 — xuất Excel DANH SÁCH LEAD.
//
// Trước đợt này đường xuất là CSV, `take: 5000` im lặng, và gác bằng đúng
// `leads:view-all` (ai xem được danh sách là tải được file). Bộ test dưới canh
// những thứ chỉ lộ ra SAU khi tệp đã nằm trong máy người khác — lúc đó không thu
// hồi được nữa:
//
//  1. TÊN + SĐT PHỤ HUYNH trong tệp phải là bản ĐÃ CHE khi người xuất không có
//     `leads:view-pii`. Quản lý cơ sở đang ở đúng ô đó (quyền bị gỡ 22/08), mà họ
//     lại là người dùng chính của nút xuất ⇒ đây là đường rò khả dĩ nhất.
//  2. KHÔNG CẮT CÂM. Chạm trần quét thì tệp phải NÓI RA còn thiếu bao nhiêu dòng.
//     Một tệp thiếu 500 khách mà không có dòng nào cảnh báo sẽ được dùng để kết
//     luận "cơ sở này chỉ có ngần này khách".
//  3. Ô TÌM KIẾM KHÔNG ĐƯỢC THÀNH MÁY DÒ SỐ. Thiếu `leads:view-pii` thì nhánh tìm
//     theo SĐT phải biến mất khỏi câu truy vấn — gõ số vào `?q=` mà tệp trả về đúng
//     một dòng là đã xác nhận "số này của ai", dù tên trong tệp đã che.
//  4. BỘ CỘT CỐ ĐỊNH (chốt kỹ thuật 24/08/2026, OQ-G12): hai người xuất cùng một bộ
//     lọc phải ra tệp cùng cấu trúc, kể cả khi quyền xem PII của họ khác nhau.
//  5. NGÀY THEO GIỜ VN. Máy chạy ở UTC, nên lead tạo lúc 0h30 giờ VN mà format theo
//     giờ máy sẽ lùi một ngày — đủ để một tệp "khách trong tháng 8" thiếu người.
import { describe, it, expect } from "vitest";
import { maskLeadPiiFields, MASKED_TEXT } from "@/lib/lead/pii";
import {
  LEAD_EXPORT_COLUMNS,
  LEAD_EXPORT_MAX_ROWS,
  buildLeadExportWhere,
  buildLeadExportSheet,
  buildLeadExportInfoSheet,
  leadExportFileName,
  leadExportTruncationWarning,
  type LeadExportLead,
} from "./lead-export";

const D = (s: string) => new Date(s);

let seq = 0;
function lead(over: Partial<LeadExportLead> = {}): LeadExportLead {
  seq += 1;
  return {
    id: `lead-${seq}`,
    parentName: "Nguyễn Thị Lan",
    phone: "0905123456",
    email: "lan@example.com",
    childName: "Nguyễn Văn An",
    childAge: 8,
    status: "DANG_TU_VAN",
    source: "Facebook Ads",
    utmSource: "fb",
    utmMedium: "cpc",
    utmCampaign: "CS1_LEAD_ROBOT_0826",
    note: "Nhà ở gần CS1, hẹn gọi lại chiều",
    createdAt: D("2026-08-11T03:00:00.000Z"),
    center: { name: "CS1 — 211 Nguyễn Hữu Thọ" },
    assignedTo: { name: "Trần Sale" },
    ...over,
  };
}

/** Chỉ số cột theo TÊN — test không được đếm tay, đếm tay là hỏng khi chèn cột. */
function col(name: (typeof LEAD_EXPORT_COLUMNS)[number]): number {
  return LEAD_EXPORT_COLUMNS.indexOf(name);
}

describe("G-03 · buildLeadExportSheet — bộ cột cố định + dữ liệu từng dòng", () => {
  it("[G-03-T01] dòng đầu là đúng bộ cột cố định, và mọi dòng dữ liệu vuông cột", () => {
    const cells = buildLeadExportSheet({ leads: [lead(), lead()], totalMatching: 2 });

    expect(cells[0]).toEqual([...LEAD_EXPORT_COLUMNS]);
    expect(cells).toHaveLength(3); // 1 tiêu đề + 2 lead, không có khối cảnh báo
    for (const row of cells) {
      expect(row).toHaveLength(LEAD_EXPORT_COLUMNS.length);
    }
  });

  it("[G-03-T02] các ô đi đúng cột của nó", () => {
    const [, row] = buildLeadExportSheet({ leads: [lead()], totalMatching: 1 });

    expect(row![col("Phụ huynh")]).toBe("Nguyễn Thị Lan");
    expect(row![col("SĐT")]).toBe("0905123456");
    expect(row![col("Tên con")]).toBe("Nguyễn Văn An");
    expect(row![col("Tuổi")]).toBe(8);
    expect(row![col("Cơ sở")]).toBe("CS1 — 211 Nguyễn Hữu Thọ");
    expect(row![col("Phụ trách")]).toBe("Trần Sale");
    expect(row![col("UTM Campaign")]).toBe("CS1_LEAD_ROBOT_0826");
  });

  it("[G-03-T03] trạng thái ghi bằng TIẾNG VIỆT, không phải mã enum", () => {
    const [, row] = buildLeadExportSheet({
      leads: [lead({ status: "DA_HEN_HOC_THU" })],
      totalMatching: 1,
    });

    expect(row![col("Trạng thái")]).toBe("Đã hẹn học thử");
  });

  it("[G-03-T04] ngày đăng ký theo GIỜ VN, không theo giờ máy chạy", () => {
    // 25/08 lúc 17:30 UTC = 26/08 lúc 00:30 giờ VN. Máy Vercel chạy UTC, nên
    // format theo giờ máy sẽ ghi 25/08 và lead này rơi khỏi tệp "tháng 8 từ 26".
    const [, row] = buildLeadExportSheet({
      leads: [lead({ createdAt: D("2026-08-25T17:30:00.000Z") })],
      totalMatching: 1,
    });

    expect(row![col("Ngày đăng ký")]).toBe("26/08/2026");
  });

  it("[G-03-T05] ô trống là Ô TRỐNG, không phải số 0 và không phải chữ 'null'", () => {
    const [, row] = buildLeadExportSheet({
      leads: [
        lead({
          childAge: null,
          email: null,
          childName: null,
          source: null,
          note: null,
          center: null,
          assignedTo: { name: null },
        }),
      ],
      totalMatching: 1,
    });

    // Tuổi = 0 trong Excel bị đọc thành "bé 0 tuổi", không ai đọc ra "chưa nhập".
    expect(row![col("Tuổi")]).toBe("");
    expect(row![col("Email")]).toBe("");
    expect(row![col("Tên con")]).toBe("");
    expect(row![col("Cơ sở")]).toBe("");
    expect(row![col("Phụ trách")]).toBe("");
    expect(row![col("Ghi chú")]).toBe("");
  });
});

describe("G-03 · che PII — tệp mang bản ĐÃ CHE", () => {
  it("[G-03-T06] không có leads:view-pii ⇒ tệp không chứa số thật, tên thật, ghi chú thật", () => {
    const raw = lead();
    const daChe = maskLeadPiiFields(raw, false);
    const cells = buildLeadExportSheet({ leads: [daChe], totalMatching: 1 });

    const phang = JSON.stringify(cells);
    expect(phang).not.toContain("0905123456");
    expect(phang).not.toContain("Nguyễn Thị Lan");
    expect(phang).not.toContain("Nguyễn Văn An");
    expect(phang).not.toContain("Nhà ở gần CS1");

    const row = cells[1]!;
    expect(row[col("Ghi chú")]).toBe(MASKED_TEXT);
    expect(row[col("Phụ huynh")]).toBe("Nguyễn T. L.");
  });

  it("[G-03-T07] bộ cột KHÔNG đổi theo quyền — hai người xuất ra tệp cùng cấu trúc", () => {
    const daChe = buildLeadExportSheet({
      leads: [maskLeadPiiFields(lead(), false)],
      totalMatching: 1,
    });
    const dayDu = buildLeadExportSheet({ leads: [lead()], totalMatching: 1 });

    expect(daChe[0]).toEqual(dayDu[0]);
    expect(daChe[1]).toHaveLength(dayDu[1]!.length);
  });
});

describe("G-03 · KHÔNG cắt câm", () => {
  it("[G-03-T08] chưa chạm trần ⇒ không có cảnh báo nào", () => {
    expect(leadExportTruncationWarning(120, 120)).toBeNull();

    const cells = buildLeadExportSheet({ leads: [lead(), lead()], totalMatching: 2 });
    expect(JSON.stringify(cells)).not.toContain("BỊ CẮT");
  });

  it("[G-03-T09] chạm trần ⇒ cảnh báo nói ĐÚNG số dòng còn thiếu", () => {
    const canhBao = leadExportTruncationWarning(20_500, LEAD_EXPORT_MAX_ROWS);

    expect(canhBao).not.toBeNull();
    expect(canhBao).toContain("500"); // 20.500 − 20.000
    expect(canhBao).toContain("20.500");
    expect(canhBao).toContain("20.000");
  });

  it("[G-03-T10] cảnh báo nằm TRONG sheet dữ liệu, tách nhãn khỏi danh sách khách", () => {
    const leads = [lead(), lead()];
    const cells = buildLeadExportSheet({ leads, totalMatching: 9 });

    // 1 tiêu đề + 2 lead + 1 dòng trống + 1 nhãn + 1 cảnh báo
    expect(cells.length).toBeGreaterThan(1 + leads.length);
    const phang = JSON.stringify(cells);
    expect(phang).toContain("BỊ CẮT");
    expect(phang).toContain("không phải dòng khách");
    // Mọi dòng vẫn vuông cột — khối cảnh báo không được làm vỡ bảng.
    for (const row of cells) expect(row).toHaveLength(LEAD_EXPORT_COLUMNS.length);
  });

  it("[G-03-T11] tổng ĐÚNG bằng số dòng xuất ra vẫn không sinh cảnh báo", () => {
    const leads = Array.from({ length: 3 }, () => lead());
    const cells = buildLeadExportSheet({ leads, totalMatching: 3 });
    expect(cells).toHaveLength(4);
  });
});

describe("G-03 · sheet 'Thông tin xuất'", () => {
  const chung = {
    totalMatching: 42,
    exported: 42,
    filters: {
      status: "DANG_TU_VAN" as const,
      q: "Lan",
      centerName: "CS1 — 211 Nguyễn Hữu Thọ",
      assignedToName: "Trần Sale",
      source: "Facebook",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-26",
    },
    watermark: "Xuất bởi Quản lý CS1 (u1) lúc 2026-08-26T04:00:00.000Z — 42 dòng",
  };

  it("[G-03-T12] nói rõ tệp là bản đã che hay bản đầy đủ", () => {
    const che = JSON.stringify(buildLeadExportInfoSheet({ ...chung, canViewPii: false }));
    expect(che).toContain("ĐÃ CHE");
    expect(che).toContain("leads:view-pii");

    const day = JSON.stringify(buildLeadExportInfoSheet({ ...chung, canViewPii: true }));
    expect(day).toContain("Hiện nguyên văn");
  });

  it("[G-03-T13] chép lại bộ lọc đang áp dụng + watermark truy vết", () => {
    const phang = JSON.stringify(
      buildLeadExportInfoSheet({ ...chung, canViewPii: true }),
    );

    expect(phang).toContain("Đang tư vấn"); // trạng thái dịch sang tiếng Việt
    expect(phang).toContain("Lan");
    expect(phang).toContain("CS1 — 211 Nguyễn Hữu Thọ");
    expect(phang).toContain("Trần Sale");
    expect(phang).toContain("01/08/2026");
    expect(phang).toContain("26/08/2026");
    expect(phang).toContain(chung.watermark);
  });

  it("[G-03-T14] bộ lọc rỗng thì nói 'tất cả', không để ô trắng cho người đọc tự đoán", () => {
    const phang = JSON.stringify(
      buildLeadExportInfoSheet({
        totalMatching: 7,
        exported: 7,
        filters: { canSearchPhoneApplied: false },
        canViewPii: true,
        watermark: "wm",
      }),
    );
    expect(phang).toContain("Tất cả");
  });

  it("[G-03-T15] cảnh báo cắt cũng phải có mặt ở sheet thông tin", () => {
    const phang = JSON.stringify(
      buildLeadExportInfoSheet({
        ...chung,
        totalMatching: 20_500,
        exported: LEAD_EXPORT_MAX_ROWS,
        canViewPii: true,
      }),
    );
    expect(phang).toContain("BỊ CẮT");
  });

  it("[G-03-T16] thiếu quyền PII ⇒ nói rõ ô tìm kiếm KHÔNG tìm theo SĐT", () => {
    const phang = JSON.stringify(
      buildLeadExportInfoSheet({
        ...chung,
        filters: { ...chung.filters, canSearchPhoneApplied: false },
        canViewPii: false,
      }),
    );
    expect(phang).toContain("KHÔNG tìm theo số điện thoại");
  });
});

describe("G-03 · buildLeadExportWhere — tệp phải khớp thứ đang lọc trên màn", () => {
  it("[G-03-T17] không lọc gì ⇒ chỉ loại lead đã xoá mềm", () => {
    expect(buildLeadExportWhere({ canSearchPhone: true })).toEqual({ deletedAt: null });
  });

  it("[G-03-T18] lọc trạng thái / cơ sở / sale / nguồn đi vào where", () => {
    const where = buildLeadExportWhere({
      canSearchPhone: true,
      status: "DA_DANG_KY",
      centerId: "cs1",
      assignedToId: "u9",
      source: "Facebook",
    });

    expect(where.status).toBe("DA_DANG_KY");
    expect(where.centerId).toBe("cs1");
    expect(where.assignedToId).toBe("u9");
    expect(where.source).toEqual({ contains: "Facebook", mode: "insensitive" });
  });

  it("[G-03-T19] khoảng ngày kẹp cả hai đầu, đầu cuối lấy trọn ngày", () => {
    const where = buildLeadExportWhere({
      canSearchPhone: true,
      dateFrom: "2026-08-01",
      dateTo: "2026-08-26",
    });

    const createdAt = where.createdAt as { gte: Date; lte: Date };
    expect(createdAt.gte).toEqual(new Date("2026-08-01"));
    expect(createdAt.lte).toEqual(new Date("2026-08-26T23:59:59"));
  });

  it("[G-03-T20] CÓ quyền PII ⇒ ô tìm quét cả SĐT, theo phần LÕI của số", () => {
    const where = buildLeadExportWhere({ canSearchPhone: true, q: "0905123456" });
    const or = where.OR as Array<Record<string, unknown>>;

    // 0905… và 84905… là hai cách lưu cùng một số ⇒ tìm theo lõi "905123456".
    expect(or).toContainEqual({ phone: { contains: "905123456" } });
    expect(or).toContainEqual({
      parentName: { contains: "0905123456", mode: "insensitive" },
    });
  });

  it("[G-03-T21] 🔴 THIẾU quyền PII ⇒ nhánh tìm theo SĐT BIẾN MẤT khỏi truy vấn", () => {
    // Quản lý cơ sở KHÔNG có leads:view-pii (gỡ 22/08) nhưng CÓ leads:export.
    // Để nguyên nhánh phone là họ gõ số vào ô tìm, tệp trả về đúng một dòng, và
    // thế là xác nhận được "số này của phụ huynh nào" dù tên trong tệp đã che.
    const where = buildLeadExportWhere({ canSearchPhone: false, q: "0905123456" });
    const or = where.OR as Array<Record<string, unknown>>;

    expect(or.some((c) => "phone" in c)).toBe(false);
    // Chỉ còn parentName + childName. (Từ khoá người dùng gõ vẫn nằm trong hai
    // mệnh đề đó — đó là điều họ tự gõ; thứ bị cắt là việc ĐỐI CHIẾU nó với cột SĐT.)
    expect(or).toHaveLength(2);
  });

  it("[G-03-T22] không gõ gì vào ô tìm ⇒ không sinh mệnh đề OR rỗng", () => {
    expect(buildLeadExportWhere({ canSearchPhone: false, q: "   " }).OR).toBeUndefined();
  });

  it("[G-03-T23] trạng thái lạ gõ tay vào URL bị bỏ qua, không làm đổ truy vấn", () => {
    const where = buildLeadExportWhere({
      canSearchPhone: true,
      status: "KHONG_CO_THAT" as never,
    });
    expect(where.status).toBeUndefined();
  });
});

describe("G-03 · tên tệp", () => {
  it("[G-03-T24] mang ngày xuất theo giờ VN + đuôi .xlsx", () => {
    expect(leadExportFileName(D("2026-08-25T17:30:00.000Z"))).toBe(
      "danh-sach-lead_2026-08-26.xlsx",
    );
  });
});
