// C-05 — bảng LEAD RỚT. Bộ test này canh sáu thứ hỏng CÂM, tức hỏng mà bảng vẫn vẽ
// ra đủ dòng và không ai nghi ngờ:
//
//  1. GỘP THÀNH "PHIẾU RỚT". Từ C-06, rớt là trạng thái của TỪNG CON. Phiếu hai con
//     mà một đứa rớt một đứa đang học thử: gộp thành một dòng "phiếu rớt" là khai tử
//     nhầm đứa còn sống — đúng cái sai mà C-06 vừa chữa. Một con rớt = một dòng, và
//     dòng đó phải nói được đứa CÒN LẠI đang ở đâu.
//  2. `status = null` BỊ ĐỌC THÀNH RỚT. Cột `LeadChild.status` cố ý không có default:
//     null = phiếu cũ CHƯA ai phân loại. Coi null là rớt là bịa ra một bảng lead rớt
//     đầy những em đang đi học.
//  3. ĐỒNG HỒ ĐẾM CẢ VIỆC MÁY LÀM. `lastActivityAt` bị bump bởi mọi dòng
//     `LeadActivity`, kể cả "Tự động chia cho Sale A" lúc 2 giờ sáng. Cột "lần tiếp
//     cận gần nhất" mà đếm cả thứ đó thì lead treo hiện xanh mướt.
//  4. HOẠT ĐỘNG CỦA PHIẾU KHÁC RƠI NHẦM SANG. Một lượt đọc gom hoạt động của N phiếu;
//     nhóm sai theo `leadId` là reset đồng hồ của phiếu bị bỏ quên bằng cuộc gọi cho
//     nhà khác.
//  5. PII RÒ QUA BÁO CÁO. Tên phụ huynh, tên con và LÝ DO RỚT đều là dữ liệu riêng của
//     một gia đình. "Báo cáo nội bộ" không phải lý do để đọc thẳng cột thô.
//  6. NGƯỠNG DÙNG CHUNG CHO MỌI CƠ SỞ. Hai ngưỡng `centerOverridable` (quyết định
//     12(a)) ⇒ cùng một số ngày có thể ra hai màu ở hai cơ sở.
import { describe, it, expect } from "vitest";
import type { LeadChildStatus } from "@prisma/client";
import { MASKED_TEXT } from "@/lib/lead/pii";
import {
  buildLostLeadRows,
  type LostLeadActivityInput,
  type LostLeadLeadInput,
} from "./lost-leads";

const NGAY = 86_400_000;
const NOW = new Date("2026-08-26T09:00:00+07:00");
const truoc = (ngay: number) => new Date(NOW.getTime() - ngay * NGAY);

function phieu(over: Partial<LostLeadLeadInput> = {}): LostLeadLeadInput {
  return {
    id: "lead-1",
    parentName: "Nguyễn Thị Lan",
    createdAt: truoc(30),
    centerId: "cs1",
    lostNote: "Nhà chuyển vào Sài Gòn",
    courseName: "Lập trình Robot",
    assignedToName: "Trần Sale",
    children: [{ id: "c1", fullName: "Nguyễn Bảo Bin", status: "LOST" as LeadChildStatus }],
    ...over,
  };
}

function hd(over: Partial<LostLeadActivityInput> = {}): LostLeadActivityInput {
  return {
    leadId: "lead-1",
    type: "CALL",
    createdAt: truoc(5),
    metadata: null,
    ...over,
  };
}

const CO_QUYEN_PII = { now: NOW, canViewPii: true };

describe("[C-05] một dòng = MỘT CON rớt, không gộp thành phiếu rớt", () => {
  it("phiếu 2 con mà chỉ 1 đứa rớt → đúng 1 dòng, và dòng đó nói tên đứa rớt", () => {
    const rows = buildLostLeadRows({
      leads: [
        phieu({
          children: [
            { id: "c1", fullName: "Bảo Bin", status: "LOST" as LeadChildStatus },
            { id: "c2", fullName: "Bảo Bơ", status: "TRIAL_ATTENDED" as LeadChildStatus },
          ],
        }),
      ],
      activities: [],
      ...CO_QUYEN_PII,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.leadChildId).toBe("c1");
    expect(rows[0]!.childName).toBe("Bảo Bin");
  });

  it("dòng mang theo trạng thái của các con CÒN LẠI — phiếu chưa chết hẳn phải nhìn thấy", () => {
    const rows = buildLostLeadRows({
      leads: [
        phieu({
          children: [
            { id: "c1", fullName: "Bảo Bin", status: "LOST" as LeadChildStatus },
            { id: "c2", fullName: "Bảo Bơ", status: "ENROLLED" as LeadChildStatus },
          ],
        }),
      ],
      activities: [],
      ...CO_QUYEN_PII,
    });

    expect(rows[0]!.siblings).toEqual([
      { leadChildId: "c2", childName: "Bảo Bơ", status: "ENROLLED" },
    ]);
  });

  it("hai con cùng rớt → HAI dòng, cùng phiếu và cùng lý do rớt", () => {
    const rows = buildLostLeadRows({
      leads: [
        phieu({
          children: [
            { id: "c1", fullName: "Bảo Bin", status: "LOST" as LeadChildStatus },
            { id: "c2", fullName: "Bảo Bơ", status: "LOST" as LeadChildStatus },
          ],
        }),
      ],
      activities: [],
      ...CO_QUYEN_PII,
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.leadChildId).sort()).toEqual(["c1", "c2"]);
    expect(new Set(rows.map((r) => r.leadId))).toEqual(new Set(["lead-1"]));
    expect(new Set(rows.map((r) => r.lostNote))).toEqual(new Set(["Nhà chuyển vào Sài Gòn"]));
  });

  it("`status = null` (phiếu cũ chưa phân loại) KHÔNG phải rớt", () => {
    const rows = buildLostLeadRows({
      leads: [phieu({ children: [{ id: "c1", fullName: "Bảo Bin", status: null }] })],
      activities: [],
      ...CO_QUYEN_PII,
    });
    expect(rows).toHaveLength(0);
  });

  it("phiếu không con nào rớt → không dòng nào", () => {
    const rows = buildLostLeadRows({
      leads: [
        phieu({
          children: [{ id: "c1", fullName: "Bảo Bin", status: "CONSULTING" as LeadChildStatus }],
        }),
      ],
      activities: [],
      ...CO_QUYEN_PII,
    });
    expect(rows).toHaveLength(0);
  });

  it("phiếu KHÔNG có con nào (dữ liệu cũ, chưa tách LeadChild) → không dòng nào, không nổ", () => {
    const rows = buildLostLeadRows({
      leads: [phieu({ children: [] })],
      activities: [],
      ...CO_QUYEN_PII,
    });
    expect(rows).toHaveLength(0);
  });
});

describe("[C-05] hai cột cốt lõi — lần tiếp cận gần nhất & số ngày chưa tiếp cận", () => {
  it("lấy lần TIẾP CẬN mới nhất, không phải hoạt động mới nhất", () => {
    const rows = buildLostLeadRows({
      leads: [phieu()],
      activities: [
        hd({ type: "CALL", createdAt: truoc(6) }),
        hd({ type: "MESSAGE", createdAt: truoc(3) }),
        // Máy đẩy trạng thái hôm qua — KHÔNG phải một lần chạm khách.
        hd({ type: "STATUS_CHANGE", createdAt: truoc(1) }),
      ],
      ...CO_QUYEN_PII,
    });

    expect(rows[0]!.clock.lastOutreachAt).toEqual(truoc(3));
    expect(rows[0]!.clock.days).toBe(3);
    expect(rows[0]!.clock.fromCreatedAt).toBe(false);
  });

  it("ghi chú do MÁY ghi (metadata.system) không được tính là đã tiếp cận", () => {
    const rows = buildLostLeadRows({
      leads: [phieu()],
      activities: [
        hd({ type: "NOTE", createdAt: truoc(8) }),
        hd({ type: "NOTE", createdAt: truoc(1), metadata: { system: true } }),
      ],
      ...CO_QUYEN_PII,
    });

    expect(rows[0]!.clock.lastOutreachAt).toEqual(truoc(8));
    expect(rows[0]!.clock.days).toBe(8);
    expect(rows[0]!.clock.level).toBe("DANGER");
  });

  it("chưa tiếp cận lần nào → đếm từ ngày vào hệ thống + bật cờ để màn nói ra", () => {
    const rows = buildLostLeadRows({
      leads: [phieu({ createdAt: truoc(30) })],
      activities: [hd({ type: "STATUS_CHANGE", createdAt: truoc(2) })],
      ...CO_QUYEN_PII,
    });

    expect(rows[0]!.clock.lastOutreachAt).toBeNull();
    expect(rows[0]!.clock.fromCreatedAt).toBe(true);
    expect(rows[0]!.clock.days).toBe(30);
  });

  it("hoạt động của phiếu KHÁC không được reset đồng hồ phiếu này", () => {
    const rows = buildLostLeadRows({
      leads: [phieu({ id: "lead-1", createdAt: truoc(20) })],
      activities: [hd({ leadId: "lead-KHAC", type: "CALL", createdAt: truoc(1) })],
      ...CO_QUYEN_PII,
    });

    expect(rows[0]!.clock.lastOutreachAt).toBeNull();
    expect(rows[0]!.clock.days).toBe(20);
  });

  it("hai con cùng phiếu dùng CHUNG đồng hồ — tiếp cận là chuyện với phụ huynh", () => {
    const rows = buildLostLeadRows({
      leads: [
        phieu({
          children: [
            { id: "c1", fullName: "Bin", status: "LOST" as LeadChildStatus },
            { id: "c2", fullName: "Bơ", status: "LOST" as LeadChildStatus },
          ],
        }),
      ],
      activities: [hd({ type: "CALL", createdAt: truoc(4) })],
      ...CO_QUYEN_PII,
    });

    expect(rows.map((r) => r.clock.days)).toEqual([4, 4]);
  });
});

describe("[C-05] ngưỡng cảnh báo lấy theo CƠ SỞ của phiếu", () => {
  it("cùng 4 ngày, cơ sở đặt ngưỡng chặt hơn thì ra đỏ còn cơ sở kia mới vàng", () => {
    const rows = buildLostLeadRows({
      leads: [
        phieu({ id: "l-cs1", centerId: "cs1", children: [{ id: "a", fullName: "A", status: "LOST" as LeadChildStatus }] }),
        phieu({ id: "l-cs2", centerId: "cs2", children: [{ id: "b", fullName: "B", status: "LOST" as LeadChildStatus }] }),
      ],
      activities: [
        hd({ leadId: "l-cs1", createdAt: truoc(4) }),
        hd({ leadId: "l-cs2", createdAt: truoc(4) }),
      ],
      thresholdsFor: (centerId) =>
        centerId === "cs1" ? { warnDays: 1, dangerDays: 3 } : { warnDays: 2, dangerDays: 7 },
      ...CO_QUYEN_PII,
    });

    const theoCoSo = new Map(rows.map((r) => [r.centerId, r.clock.level]));
    expect(theoCoSo.get("cs1")).toBe("DANGER");
    expect(theoCoSo.get("cs2")).toBe("WARN");
  });
});

describe("[C-05] sắp xếp — bỏ quên lâu nhất lên đầu", () => {
  it("xếp giảm dần theo số ngày chưa tiếp cận", () => {
    const rows = buildLostLeadRows({
      leads: [
        phieu({ id: "l1", children: [{ id: "a", fullName: "A", status: "LOST" as LeadChildStatus }] }),
        phieu({ id: "l2", children: [{ id: "b", fullName: "B", status: "LOST" as LeadChildStatus }] }),
        phieu({ id: "l3", children: [{ id: "c", fullName: "C", status: "LOST" as LeadChildStatus }] }),
      ],
      activities: [
        hd({ leadId: "l1", createdAt: truoc(3) }),
        hd({ leadId: "l2", createdAt: truoc(11) }),
        hd({ leadId: "l3", createdAt: truoc(6) }),
      ],
      ...CO_QUYEN_PII,
    });

    expect(rows.map((r) => r.leadChildId)).toEqual(["b", "c", "a"]);
  });
});

describe("[C-05] PII — bảng nội bộ vẫn phải đi qua tầng che", () => {
  const dungChung = {
    leads: [
      phieu({
        parentName: "Nguyễn Thị Lan",
        lostNote: "Bố mẹ ly hôn nên tạm dừng",
        children: [
          { id: "c1", fullName: "Nguyễn Bảo Bin", status: "LOST" as LeadChildStatus },
          { id: "c2", fullName: "Nguyễn Bảo Bơ", status: "CONSULTING" as LeadChildStatus },
        ],
      }),
    ],
    activities: [],
    now: NOW,
  };

  it("có quyền PII → nguyên văn", () => {
    const r = buildLostLeadRows({ ...dungChung, canViewPii: true })[0]!;
    expect(r.parentName).toBe("Nguyễn Thị Lan");
    expect(r.childName).toBe("Nguyễn Bảo Bin");
    expect(r.lostNote).toBe("Bố mẹ ly hôn nên tạm dừng");
    expect(r.siblings[0]!.childName).toBe("Nguyễn Bảo Bơ");
  });

  it("KHÔNG có quyền → che tên PH, tên CẢ HAI con và lý do rớt", () => {
    const r = buildLostLeadRows({ ...dungChung, canViewPii: false })[0]!;
    expect(r.parentName).toBe("Nguyễn T. L.");
    expect(r.childName).toBe("Nguyễn B. B.");
    expect(r.lostNote).toBe(MASKED_TEXT);
    expect(r.siblings[0]!.childName).toBe("Nguyễn B. B.");
    // Không một mẩu tên/lý do thật nào được rời server qua RSC payload.
    const chuoi = JSON.stringify(r);
    expect(chuoi).not.toContain("Lan");
    expect(chuoi).not.toContain("ly hôn");
  });

  it("trạng thái của các con KHÔNG bị che — đó là dữ liệu nghiệp vụ, không phải danh tính", () => {
    const r = buildLostLeadRows({ ...dungChung, canViewPii: false })[0]!;
    expect(r.siblings[0]!.status).toBe("CONSULTING");
  });
});
