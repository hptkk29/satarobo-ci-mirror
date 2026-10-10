/**
 * GHI lịch sử tương tác — hành vi của hàm ghi + lưới ghim 15 ĐIỂM CẮM.
 *
 * Hai phần, và phần hai là phần dễ bị bỏ:
 *
 *  [GHI-01..04] HÀNH VI — `ghiTuongTacLead` nhận một `kho` tối thiểu nên test được THẬT
 *  (không DB, không mock Prisma): kiểm đúng dòng nó ghi và đúng đồng hồ nó đẩy.
 *
 *  [GHI-10..12] LƯỚI GHIM — 15 điểm cắm nằm trong Server Action chạm DB, test thuần không
 *  tới được. Gỡ MỘT lời gọi ở một action là mất lịch sử của đúng việc đó mà không ca nào
 *  đỏ, vì không ca nào chạm vào action ấy. Canh bằng lưới ghim mã nguồn (luật 11: neo hẹp,
 *  không cờ `/s`, và đã cấy lại để thấy đỏ).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ghiTuongTacLead, type KhoGhiTuongTac } from "./ghi";

// ── kho giả: ghi lại lời gọi thay vì chạm DB ──────────────────────────────────────────
function khoGia() {
  const dong: Record<string, unknown>[] = [];
  const dayDongHo: { id: string; moc: Date }[] = [];
  const kho: KhoGhiTuongTac = {
    leadActivity: {
      create: (args) => {
        dong.push(args.data as unknown as Record<string, unknown>);
        return undefined;
      },
    },
    lead: {
      update: (args) => {
        dayDongHo.push({ id: args.where.id, moc: args.data.lastActivityAt });
        return undefined;
      },
    },
  };
  return { kho, dong, dayDongHo };
}

const MOC = new Date("2026-09-18T05:00:00.000Z");

describe("[GHI-01] dòng ghi ra đúng hình dạng panel đọc được", () => {
  it("lưu dưới `NOTE` + câu người đọc ở `content`", async () => {
    const { kho, dong } = khoGia();
    await ghiTuongTacLead(kho, {
      leadId: "lead1",
      actorId: "u1",
      actorName: "Trần Bình",
      moc: MOC,
      sk: { viec: "trial.xep-lop", tenCon: "Nguyễn An", tenLop: "TN-01" },
    });
    expect(dong).toHaveLength(1);
    expect(dong[0]!.type).toBe("NOTE");
    expect(dong[0]!.content).toBe("Xếp Nguyễn An vào lớp trải nghiệm TN-01.");
    expect(dong[0]!.leadId).toBe("lead1");
    expect(dong[0]!.actorName).toBe("Trần Bình");
  });

  it("⚠️ KHÔNG set `metadata.text` — panel có nhánh render thẳng `text` và bỏ qua `content`", async () => {
    // `lead-activity-panel.tsx`: `if (activity.type === "NOTE" && metaStr(meta.text))` →
    // render `meta.text`. Đặt `text` vào là câu mô tả biến mất khỏi màn hình, mà dữ liệu
    // thì vẫn đủ nên không ai thấy lỗi.
    const { kho, dong } = khoGia();
    await ghiTuongTacLead(kho, {
      leadId: "lead1",
      actorId: null,
      actorName: "System",
      moc: MOC,
      sk: { viec: "con.them", tenCon: "Nguyễn An" },
    });
    const meta = dong[0]!.metadata as Record<string, unknown>;
    expect(Object.keys(meta)).not.toContain("text");
  });

  it("⚠️ marker là `heThong`, KHÔNG phải `system`", async () => {
    // `system: true` là marker của auto-chia lead, và `hasSaleInteraction()` cố ý LOẠI
    // những dòng ấy khi quyết định "lead đã có tương tác ⇒ không chia lại". Dùng lẫn
    // marker là để một lead mà Sale đã xếp lớp, đã tạo đơn bị máy chia sang người khác.
    const { kho, dong } = khoGia();
    await ghiTuongTacLead(kho, {
      leadId: "lead1",
      actorId: "u1",
      actorName: "A",
      moc: MOC,
      sk: { viec: "don.sua-ghi-chu", maDon: "DH-1" },
    });
    const meta = dong[0]!.metadata as Record<string, unknown>;
    expect(meta.heThong).toBe(true);
    expect(meta.system).toBeUndefined();
    expect(meta.viec).toBe("don.sua-ghi-chu");
  });
});

describe("[GHI-02] metadata chở được chi tiết, và `Date` không làm Prisma ném", () => {
  it("chi tiết của sự việc đi vào metadata", async () => {
    const { kho, dong } = khoGia();
    await ghiTuongTacLead(kho, {
      leadId: "lead1",
      actorId: "u1",
      actorName: "A",
      moc: MOC,
      sk: { viec: "ghi-danh.them", tenCon: "Nguyễn An", tenLop: "CS1-K01" },
    });
    const meta = dong[0]!.metadata as Record<string, unknown>;
    expect(meta.tenCon).toBe("Nguyễn An");
    expect(meta.tenLop).toBe("CS1-K01");
  });

  it("`Date` trong chi tiết → chuỗi ISO (Prisma.InputJsonValue không nhận Date)", async () => {
    const { kho, dong } = khoGia();
    const ngay = new Date("2026-09-20T07:30:00.000Z");
    await ghiTuongTacLead(kho, {
      leadId: "lead1",
      actorId: "u1",
      actorName: "A",
      moc: MOC,
      sk: { viec: "trial.diem-danh", tenCon: "An", tenLop: "TN-01", coMat: true, ngay },
    });
    const meta = dong[0]!.metadata as Record<string, unknown>;
    expect(meta.ngay).toBe("2026-09-20T07:30:00.000Z");
    expect(meta.ngay instanceof Date).toBe(false);
  });
});

describe("[GHI-03] ĐẨY ĐỒNG HỒ `lastActivityAt`", () => {
  it("mỗi dòng ghi đẩy đồng hồ SLA của đúng lead đó", async () => {
    // `lastActivityAt` là đồng hồ "bao lâu rồi không ai chạm lead này" mà màn
    // `/lead-nguoi` lọc theo (bộ lọc 90 ngày). Một hành động THẬT của Sale mà không đẩy
    // đồng hồ thì lead vẫn bị đếm là bỏ rơi dù Sale vừa xếp con vào lớp hôm qua.
    const { kho, dayDongHo } = khoGia();
    await ghiTuongTacLead(kho, {
      leadId: "lead9",
      actorId: "u1",
      actorName: "A",
      moc: MOC,
      sk: { viec: "viec.xong", tieuDe: "Gọi lại" },
    });
    expect(dayDongHo).toEqual([{ id: "lead9", moc: MOC }]);
  });

  it("dùng MỐC TRUYỀN VÀO, không đọc đồng hồ máy (luật 19)", async () => {
    const { kho, dayDongHo } = khoGia();
    const mocLa = new Date("2020-01-02T03:04:05.000Z");
    await ghiTuongTacLead(kho, {
      leadId: "lead1",
      actorId: "u1",
      actorName: "A",
      moc: mocLa,
      sk: { viec: "don.sua-ghi-chu", maDon: "DH-2" },
    });
    expect(dayDongHo[0]!.moc.toISOString()).toBe("2020-01-02T03:04:05.000Z");
  });
});

describe("[GHI-04] cửa NÉM vs cửa BỎ QUA LỖI", () => {
  it("`ghiTuongTacLead` NÉM khi kho lỗi — đó là hợp đồng của nó", async () => {
    // Cửa này dành cho lời gọi TRONG transaction, nơi caller CHỌN cho lịch sử đi cùng
    // nghiệp vụ. Nuốt lỗi ở đây là để lại một transaction đã hỏng mà caller tưởng xong.
    const kho: KhoGhiTuongTac = {
      leadActivity: {
        create: () => {
          throw new Error("DB down");
        },
      },
      lead: { update: () => undefined },
    };
    await expect(
      ghiTuongTacLead(kho, {
        leadId: "lead1",
        actorId: "u1",
        actorName: "A",
        moc: MOC,
        sk: { viec: "con.go", tenCon: "An" },
      }),
    ).rejects.toThrow("DB down");
  });
});

// ── LƯỚI GHIM ĐIỂM CẮM ────────────────────────────────────────────────────────────────
const doc = (p: string) => {
  const duong = path.join(process.cwd(), p);
  expect(fs.existsSync(duong), `${duong} không còn ở chỗ cũ`).toBe(true);
  return fs.readFileSync(duong, "utf8");
};

/** Xoá chú thích theo DÒNG (không regex `/s`): chú thích giải thích bản vá thường chứa
 *  đúng chuỗi mà bộ so khớp đang tìm — lỗi này đã làm ba lưới xanh giả hồi 08/09. */
function boChuThich(src: string): string {
  const ra: string[] = [];
  let trongKhoi = false;
  for (const d of src.split(/\r?\n/)) {
    let l = d;
    if (trongKhoi) {
      const h = l.indexOf("*/");
      if (h === -1) continue;
      l = l.slice(h + 2);
      trongKhoi = false;
    }
    for (;;) {
      const m = l.indexOf("/*");
      if (m === -1) break;
      const h = l.indexOf("*/", m + 2);
      if (h === -1) {
        l = l.slice(0, m);
        trongKhoi = true;
        break;
      }
      l = l.slice(0, m) + l.slice(h + 2);
    }
    const d2 = l.indexOf("//");
    if (d2 !== -1) l = l.slice(0, d2);
    ra.push(l);
  }
  return ra.join("\n");
}

const DIEM_CAM: { tep: string; viec: string[] }[] = [
  {
    tep: "app/(admin)/admin/leads/actions.ts",
    viec: ["viec.tao", "viec.xong", "con.them", "con.sua", "con.go", "ho-so.sua"],
  },
  {
    tep: "app/(admin)/admin/lop-trial/_actions.ts",
    viec: ["trial.xep-lop", "trial.go-lop", "trial.diem-danh", "trial.doi-lich", "trial.huy-buoi", "trial.huy-lop"],
  },
  {
    tep: "app/(admin)/admin/orders/_actions.ts",
    viec: ["don.tao", "don.doi-trang-thai", "don.sua-ghi-chu"],
  },
  { tep: "app/(admin)/admin/leads/[id]/convert/actions.ts", viec: ["chuyen-doi"] },
  // 26/09/2026 — ô "Khoá học" của bé ở màn lớp trial ghi khoá quan tâm qua đây.
  { tep: "lib/lead/khoa-quan-tam-con.ts", viec: ["con.sua"] },
  { tep: "app/(admin)/admin/leads/bulk-convert/_actions.ts", viec: ["chuyen-doi"] },
  {
    tep: "app/(admin)/admin/enrollments/_actions.ts",
    viec: ["ghi-danh.them", "ghi-danh.doi-trang-thai", "ghi-danh.chuyen-lop", "ghi-danh.go"],
  },
];

describe("[GHI-10] 15 điểm cắm còn nguyên", () => {
  it("phép quét tự kiểm: bộ bỏ chú thích KHÔNG ăn mất mã", () => {
    // Bản đầu của phép bỏ chú thích ở repo này từng ăn 52/67 KB một tệp seed, làm lưới đỏ
    // cho mã ĐÚNG — và nếu bộ so khớp là `.not.toContain` thì nó sẽ XANH vĩnh viễn.
    for (const { tep } of DIEM_CAM) {
      const goc = doc(tep);
      const sach = boChuThich(goc);
      expect(sach.length / goc.length, `${tep}: bỏ chú thích ăn mất quá nhiều`).toBeGreaterThan(
        0.3,
      );
    }
    // Và nó phải THẬT SỰ bỏ được chú thích, kẻo lưới dưới chỉ khớp vào chữ trong chú thích.
    expect(boChuThich('const a = 1; // viec: "gia"')).not.toContain("gia");
    expect(boChuThich('/* viec: "gia" */ const b = 2;')).not.toContain("gia");
  });

  for (const { tep, viec } of DIEM_CAM) {
    for (const v of viec) {
      it(`${tep} còn ghi \`${v}\``, () => {
        // Nháy ĐƠN hay KÉP tuỳ tệp — repo không có prettier nên hai lối viết cùng tồn
        // tại thật. Neo cứng một lối là lưới đỏ cho mã đúng.
        const sach = boChuThich(doc(tep));
        expect(
          sach.includes(`viec: "${v}"`) || sach.includes(`viec: '${v}'`),
          `${tep} không còn ghi \`${v}\``,
        ).toBe(true);
      });
    }
  }

  it("mọi điểm cắm đều GỌI hàm ghi, không chỉ khai mã việc", () => {
    for (const { tep } of DIEM_CAM) {
      const sach = boChuThich(doc(tep));
      expect(
        /ghiTuongTac(Lead|LeadBoQuaLoi|NhieuLead|TheoConLead)\s*\(/.test(sach),
        `${tep} khai mã việc mà không gọi hàm ghi`,
      ).toBe(true);
    }
  });
});

describe("[GHI-11] ⚠️ đường CHẠM TIỀN phải dùng cửa BỎ QUA LỖI", () => {
  // `throw` trong callback `$transaction` CUỘN LẠI MỌI PHÉP GHI (luật rollback của repo).
  // Gọi cửa NÉM trong transaction tạo đơn là để một lỗi ghi LỊCH SỬ xoá mất cái ĐƠN, cả
  // phiếu thu, cả lượt trừ kho.
  const TEP_TIEN = [
    "app/(admin)/admin/orders/_actions.ts",
    "app/(admin)/admin/enrollments/_actions.ts",
    "app/(admin)/admin/leads/[id]/convert/actions.ts",
    "app/(admin)/admin/leads/bulk-convert/_actions.ts",
  ];

  for (const tep of TEP_TIEN) {
    it(`${tep} KHÔNG gọi cửa ném`, () => {
      const sach = boChuThich(doc(tep));
      // Neo hẹp: `ghiTuongTacLead(` phải không xuất hiện, còn
      // `ghiTuongTacLeadBoQuaLoi(` thì được — nên phải chặn đúng dấu ngoặc ngay sau tên.
      expect(/\bghiTuongTacLead\s*\(/.test(sach), `${tep} gọi cửa NÉM`).toBe(false);
      expect(/\bghiTuongTacLeadBoQuaLoi\s*\(/.test(sach)).toBe(true);
    });
  }
});

describe("[GHI-12] ⚠️ THỨ TỰ: huỷ lớp phải đọc lead TRƯỚC khi huỷ", () => {
  it("`layLeadTrongLopTrial` đứng TRƯỚC `cancelTrialClass`", () => {
    // `cancelTrialClass` đẩy mọi `TrialEnrollment` sang CANCELLED. Đọc sau là ra danh sách
    // RỖNG ⇒ không lead nào được ghi, và không có lỗi nào báo: một lỗ hoàn toàn im lặng.
    const sach = boChuThich(doc("app/(admin)/admin/lop-trial/_actions.ts"));
    const iDoc = sach.indexOf("layLeadTrongLopTrial(trialClassId)");
    const iHuy = sach.indexOf("cancelTrialClass({ trialClassId");
    expect(iDoc, "không thấy lượt đọc lead trước khi huỷ lớp").toBeGreaterThan(-1);
    expect(iHuy, "không thấy lượt huỷ lớp").toBeGreaterThan(-1);
    expect(iDoc).toBeLessThan(iHuy);
  });
});

describe("[GHI-13] panel nhận ra dòng hệ thống", () => {
  it("đọc `docMaViec` + `laDongHeThong`, và dùng `NHAN_VIEC` thay nhãn 'Ghi chú'", () => {
    // Không có ba thứ này thì mọi dòng tự động hiện ra với nhãn "Ghi chú" — nhãn đó nói
    // rằng có người gõ tay, tức nói dối (luật 12).
    const sach = boChuThich(doc("app/(admin)/admin/leads/[id]/_components/lead-activity-panel.tsx"));
    expect(sach).toContain("docMaViec(a.metadata)");
    expect(sach).toContain("laDongHeThong(a.metadata)");
    expect(sach).toContain("NHAN_VIEC[maViec]");
  });
});
