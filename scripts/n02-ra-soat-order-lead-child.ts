/**
 * scripts/n02-ra-soat-order-lead-child.ts — N-2 · quyết định B4 (24/08/2026).
 *
 * Rà đơn CŨ chưa quy được về con (`Order.leadChildId IS NULL`) và nói rõ:
 *   · bao nhiêu đơn suy được TỰ ĐỘNG (phiếu có ĐÚNG MỘT con) — điều kiện suy duy nhất;
 *   · bao nhiêu đơn phải rà TAY (phiếu nhiều con) — kèm danh sách để người rà mở từng cái;
 *   · bao nhiêu đơn KHÔNG BAO GIỜ quy được (không gắn phiếu, hoặc phiếu không có con nào).
 *
 *   pnpm tsx scripts/n02-ra-soat-order-lead-child.ts           # DRY-RUN (mặc định)
 *   pnpm tsx scripts/n02-ra-soat-order-lead-child.ts --apply   # ghi phần SUY ĐƯỢC
 *
 * ⚠️ VÌ SAO KHÔNG BACKFILL TRONG MIGRATION: phiếu nhiều con thì KHÔNG có cách suy nào
 * đúng. Gán bừa một đứa là chuyển doanh thu của đứa này sang đứa kia — tổng vẫn khớp nên
 * không ai phát hiện, và sửa lại sau thì phải đối chiếu từng đơn bằng tay. Thà để `null`
 * và cho báo cáo hiện dòng "chưa quy được về con" (`lib/reports/revenue-by-child.ts`).
 *
 * ⚠️ Migration `20260826120000_n02_add_order_lead_child` phải chạy TRƯỚC script này.
 * Chạy trên PROD là việc của người vận hành (luật cứng #4), không phải của CI.
 */
import "./_load-env";
import { currentDbHost } from "./_load-env";
import { scriptDb } from "./_script-db";
import { inferLeadChildIdFromChildren } from "../lib/orders/lead-child-link";

const db = scriptDb();
const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`DB đang trỏ tới: ${currentDbHost()}`);
  console.log(APPLY ? "CHẾ ĐỘ GHI (--apply)\n" : "DRY-RUN — chưa ghi gì.\n");

  const rows = await db.order.findMany({
    where: { leadChildId: null },
    select: {
      id: true,
      code: true,
      totalAmount: true,
      createdAt: true,
      leadId: true,
      lead: {
        select: {
          id: true,
          parentName: true,
          children: { select: { id: true, leadId: true, fullName: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const suyDuoc: { id: string; code: string; childId: string; childName: string }[] = [];
  const raTay: typeof rows = [];
  const khongCoPhieu: typeof rows = [];
  const phieuKhongCon: typeof rows = [];

  for (const o of rows) {
    if (!o.lead) {
      khongCoPhieu.push(o);
      continue;
    }
    const con = o.lead.children;
    if (con.length === 0) {
      phieuKhongCon.push(o);
      continue;
    }
    // ĐÚNG một điều kiện suy, dùng chung hàm với đường tạo đơn để hai chỗ không lệch luật.
    const id = inferLeadChildIdFromChildren(con);
    if (id) {
      suyDuoc.push({
        id: o.id,
        code: o.code,
        childId: id,
        childName: con.find((c) => c.id === id)?.fullName ?? "?",
      });
    } else {
      raTay.push(o);
    }
  }

  const tien = (rs: { totalAmount: number }[]) =>
    rs.reduce((s, r) => s + r.totalAmount, 0).toLocaleString("vi-VN") + "đ";

  console.log("=== ĐƠN CHƯA QUY ĐƯỢC VỀ CON ===");
  console.log(`Tổng: ${rows.length} đơn · ${tien(rows)}\n`);
  console.log(`SUY ĐƯỢC (phiếu đúng 1 con)      : ${suyDuoc.length} đơn`);
  console.log(`PHẢI RÀ TAY (phiếu nhiều con)    : ${raTay.length} đơn · ${tien(raTay)}`);
  console.log(`Phiếu không có con nào           : ${phieuKhongCon.length} đơn · ${tien(phieuKhongCon)}`);
  console.log(`Đơn không gắn phiếu (vãng lai)   : ${khongCoPhieu.length} đơn · ${tien(khongCoPhieu)}\n`);

  if (raTay.length > 0) {
    console.log("--- PHẢI RÀ TAY: mở từng đơn, chọn con, hoặc TÁCH thành nhiều đơn ---");
    for (const o of raTay) {
      const ten = o.lead!.children.map((c) => c.fullName).join(" · ");
      console.log(
        `  ${o.code} · ${o.totalAmount.toLocaleString("vi-VN")}đ · PH "${o.lead!.parentName}" · con: ${ten}`,
      );
    }
    console.log("");
  }

  if (!APPLY) {
    console.log(
      suyDuoc.length > 0
        ? `Chạy lại với \`--apply\` để ghi ${suyDuoc.length} đơn suy được. Phần rà tay KHÔNG được đụng tới.`
        : "Không có đơn nào suy được tự động.",
    );
    return;
  }

  let n = 0;
  for (const s of suyDuoc) {
    // updateMany + điều kiện `leadChildId: null`: nếu trong lúc rà có người vừa gán tay
    // thì lượt ghi này KHÔNG đè lên lựa chọn của họ.
    const r = await db.order.updateMany({
      where: { id: s.id, leadChildId: null },
      data: { leadChildId: s.childId },
    });
    n += r.count;
  }
  console.log(`✓ Đã quy ${n}/${suyDuoc.length} đơn về con (bỏ qua đơn đã có người gán tay).`);
  if (raTay.length > 0) {
    console.log(`⚠️ Còn ${raTay.length} đơn của phiếu NHIỀU CON — cố ý không đụng tới. Rà tay theo danh sách trên.`);
  }
}

main()
  .catch((e) => console.error(String(e).slice(0, 400)))
  .finally(() => db.$disconnect());
