"use client";
// Chọn cơ sở theo HAI TẦNG: khu vực → cơ sở.
//
// 30/08/2026 — thay dãy nút phẳng. Hai cơ sở thì dãy nút đẹp hơn; mười lăm cơ sở thì
// nó thành một hàng nút tràn hai dòng, và người dùng phải đọc hết mới tìm ra chỗ mình.
// Cây tổ chức vốn đã là HO → KHU VỰC → CƠ SỞ, nên ô chọn chỉ đang nói đúng hình cây.
//
// Cơ sở chưa gắn khu vực gom vào nhóm "Chưa gắn khu vực" — KHÔNG ẩn đi: ẩn là người
// vận hành mất hẳn đường vào cơ sở đó mà chẳng có lỗi nào báo.

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { CoSoTheoKhuVuc } from "@/lib/lead/pool-board";

const CHUA_GAN = "__chua_gan__";

export function CenterPicker({
  centers,
  centerId,
  tab,
}: {
  centers: CoSoTheoKhuVuc[];
  centerId: string;
  tab: string;
}) {
  const router = useRouter();
  const dangChon = centers.find((c) => c.id === centerId);
  const [khuVuc, setKhuVuc] = useState<string>(dangChon?.khuVucId ?? CHUA_GAN);

  const nhomKhuVuc = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of centers) m.set(c.khuVucId ?? CHUA_GAN, c.khuVucTen ?? "Chưa gắn khu vực");
    return [...m.entries()].map(([id, ten]) => ({ id, ten }));
  }, [centers]);

  const coSoTrongKhuVuc = centers.filter((c) => (c.khuVucId ?? CHUA_GAN) === khuVuc);

  const oCls =
    "rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

  function di(id: string) {
    router.push(`/quan-ly-chia-lead?co_so=${id}&tab=${tab}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      {/* LUÔN hiện ô khu vực, kể cả khi mới có một khu vực: giấu nó đi thì hôm nay
          gọn hơn, nhưng ngày mở khu vực thứ hai giao diện tự đổi hình dưới chân người
          dùng — và không ai đoán được vì sao. Một ô select một dòng không phải là ồn. */}
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Khu vực</span>
        <select
          value={khuVuc}
          onChange={(e) => {
            const kv = e.target.value;
            setKhuVuc(kv);
            // Nhảy luôn sang cơ sở đầu tiên của khu vực vừa chọn: để nguyên là màn
            // hiện dữ liệu của khu vực CŨ trong khi ô khu vực đã đổi — nói dối.
            const dau = centers.find((c) => (c.khuVucId ?? CHUA_GAN) === kv);
            if (dau && dau.id !== centerId) di(dau.id);
          }}
          className={oCls}
        >
          {nhomKhuVuc.map((k) => (
            <option key={k.id} value={k.id}>
              {k.ten}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Cơ sở</span>
        <select
          value={coSoTrongKhuVuc.some((c) => c.id === centerId) ? centerId : ""}
          onChange={(e) => e.target.value && di(e.target.value)}
          className={oCls}
        >
          {!coSoTrongKhuVuc.some((c) => c.id === centerId) && <option value="">— chọn —</option>}
          {coSoTrongKhuVuc.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
