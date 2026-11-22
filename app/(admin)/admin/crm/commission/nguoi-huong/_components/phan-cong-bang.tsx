"use client";

// Bảng "cơ sở → người hưởng hoa hồng" + chỗ nhập tay.
//
// Ba thứ màn này BẮT BUỘC nói ra, vì im lặng ở đây nghĩa là tiền treo mà không ai biết:
//   1. Cơ sở CHƯA khai vai nào — hiện đỏ, không ẩn đi cho gọn.
//   2. Một cơ sở nhiều QC thì 1% CHIA ĐỀU — nói thẳng số phần, để người nhập biết hệ quả.
//   3. Cột `Center.managerUserId` lệch sổ QL_TT — cảnh báo, không tự sửa.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { themPhanCongAction, ketThucPhanCongAction } from "../actions";

export type NguoiChon = { id: string; name: string; email: string | null };

export type DongHienThi = {
  id: string;
  role: "QC" | "QL_TT";
  userId: string;
  userLabel: string;
  tuNgay: string;
  denNgay: string | null;
  dangHieuLuc: boolean;
};

export type CoSoHienThi = {
  centerId: string;
  centerName: string;
  centerCode: string | null;
  managerName: string | null;
  managerUserLabel: string | null;
  lechQuanLy: boolean;
  soQc: number;
  soQlTt: number;
  dong: DongHienThi[];
};

const NHAN_VAI: Record<"QC" | "QL_TT", string> = {
  QC: "Quảng cáo (QC) — 1%",
  QL_TT: "Quản lý trung tâm — 2%",
};

/** Hôm nay theo GIỜ VIỆT NAM, dạng "YYYY-MM-DD" cho `<input type="date">`. */
function homNayVN(): string {
  const vn = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return vn.toISOString().slice(0, 10);
}

function ngayVN(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

export function PhanCongBang({
  coSo,
  nguoiChon,
}: {
  coSo: CoSoHienThi[];
  nguoiChon: NguoiChon[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dangMo, setDangMo] = useState<string | null>(null);
  const [role, setRole] = useState<"QC" | "QL_TT">("QC");
  const [userId, setUserId] = useState<string | null>(null);
  const [tuNgay, setTuNgay] = useState(homNayVN());
  const [ketThucId, setKetThucId] = useState<string | null>(null);
  const [denNgay, setDenNgay] = useState(homNayVN());

  const options = nguoiChon.map((u) => ({
    value: u.id,
    label: u.email ? `${u.name} · ${u.email}` : u.name,
  }));

  function them(centerId: string) {
    if (!userId) {
      toast.error("Chọn tài khoản người hưởng");
      return;
    }
    start(async () => {
      const res = await themPhanCongAction({ centerId, role, userId, effectiveFrom: tuNgay });
      if (res.ok) {
        toast.success("Đã khai người hưởng. Chốt lại kỳ để tiền chảy vào bảng kê.");
        setDangMo(null);
        setUserId(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function ketThuc(id: string) {
    start(async () => {
      const res = await ketThucPhanCongAction({ id, effectiveTo: denNgay });
      if (res.ok) {
        toast.success("Đã kết thúc phân công. Lịch sử hoa hồng cũ GIỮ NGUYÊN.");
        setKetThucId(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      {coSo.map((c) => {
        const thieu: string[] = [];
        if (c.soQc === 0) thieu.push("QC 1%");
        if (c.soQlTt === 0) thieu.push("Quản lý TT 2%");
        return (
          <div key={c.centerId} className="rounded-lg border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
              <div>
                <h3 className="font-bold">
                  {c.centerName}
                  {c.centerCode ? (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{c.centerCode}</span>
                  ) : null}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Quản lý (tên hiển thị cũ): {c.managerName || "—"} · Tài khoản quản lý:{" "}
                  {c.managerUserLabel || "chưa gán"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {thieu.length > 0 ? (
                  <Badge variant="destructive">Chưa khai: {thieu.join(", ")}</Badge>
                ) : (
                  <Badge>Đã khai đủ</Badge>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDangMo(dangMo === c.centerId ? null : c.centerId)}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Thêm người hưởng
                </Button>
              </div>
            </div>

            {c.lechQuanLy ? (
              <div className="flex items-start gap-2 border-b bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  Cột <strong>tài khoản quản lý</strong> trên hồ sơ cơ sở KHÔNG khớp sổ phân công
                  đang hiệu lực. Hoa hồng 2% đi theo <strong>sổ</strong>, không theo cột. Thêm một
                  dòng &quot;Quản lý trung tâm&quot; để đặt lại cho khớp.
                </span>
              </div>
            ) : null}

            {c.soQc > 1 ? (
              <p className="border-b bg-muted/40 p-2 text-xs text-muted-foreground">
                Cơ sở này có <strong>{c.soQc}</strong> QC đang phụ trách ⇒ 1% được{" "}
                <strong>chia đều {c.soQc} phần</strong>. Tổng chi cho tầng QC không đổi.
              </p>
            ) : null}

            {dangMo === c.centerId ? (
              <div className="flex flex-wrap items-end gap-2 border-b bg-muted/30 p-3">
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Vai</span>
                  <Select value={role} onValueChange={(v) => setRole(v as "QC" | "QL_TT")}>
                    <SelectTrigger className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="QC">{NHAN_VAI.QC}</SelectItem>
                      <SelectItem value="QL_TT">{NHAN_VAI.QL_TT}</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Tài khoản</span>
                  <div className="w-72">
                    <Combobox
                      options={options}
                      value={userId}
                      onValueChange={setUserId}
                      placeholder="Tìm theo tên hoặc email…"
                    />
                  </div>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Có hiệu lực từ</span>
                  <Input
                    type="date"
                    value={tuNgay}
                    onChange={(e) => setTuNgay(e.target.value)}
                    className="w-44"
                  />
                </label>
                <Button onClick={() => them(c.centerId)} disabled={pending}>
                  {pending ? "Đang lưu…" : "Lưu"}
                </Button>
              </div>
            ) : null}

            <div className="p-3">
              {c.dong.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Chưa có dòng nào — toàn bộ QC 1% và Quản lý TT 2% của cơ sở này đang{" "}
                  <strong>treo</strong>.
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {c.dong.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2">
                      <Badge variant={d.dangHieuLuc ? "default" : "secondary"}>
                        {d.role === "QC" ? "QC" : "QL TT"}
                      </Badge>
                      <span className="font-medium">{d.userLabel}</span>
                      <span className="text-muted-foreground">
                        {ngayVN(d.tuNgay)} → {d.denNgay ? ngayVN(d.denNgay) : "nay"}
                      </span>
                      {d.dangHieuLuc ? (
                        ketThucId === d.id ? (
                          <span className="flex items-center gap-1">
                            <Input
                              type="date"
                              value={denNgay}
                              onChange={(e) => setDenNgay(e.target.value)}
                              className="h-8 w-40"
                            />
                            <Button size="sm" onClick={() => ketThuc(d.id)} disabled={pending}>
                              Xác nhận
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setKetThucId(null)}>
                              Huỷ
                            </Button>
                          </span>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => setKetThucId(d.id)}>
                            Kết thúc
                          </Button>
                        )
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
