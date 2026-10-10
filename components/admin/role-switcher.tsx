"use client";

// #13 (câu 11) — nút "Chuyển vai trò". CHỈ đổi menu + dashboard mặc định, KHÔNG đổi quyền.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserCog, Check } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { roleCodeLabel } from "@/lib/labels";
import { setActiveRoleAction } from "@/app/(admin)/admin/_actions/active-role";

export function RoleSwitcher({ roles, activeRole }: { roles: string[]; activeRole: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (roles.length <= 1) return null;

  const choose = (role: string) => {
    startTransition(async () => {
      const res = await setActiveRoleAction(role);
      if (!res.ok) {
        toast.error(res.error ?? "Không đổi được vai trò");
        return;
      }
      // F3 (Q41) — vai thuộc khu vực host khác (VD Giáo viên) → điều hướng full-page
      // sang đúng site. Chỉ có khi SSO đa subdomain đã bật (server quyết); mặc định
      // targetHost rỗng → chỉ làm mới menu như cũ.
      if (res.targetHost) {
        window.location.assign(res.targetHost);
        return;
      }
      router.refresh();
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending}
        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
      >
        <UserCog className="h-4 w-4 text-muted-foreground" />
        <span className="hidden sm:inline">{activeRole ? roleCodeLabel(activeRole) : "Mọi vai trò"}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* Group BẮT BUỘC: DropdownMenuLabel = Menu.GroupLabel của base-ui, nó gọi
            useMenuGroupRootContext() và THROW nếu không có <Menu.Group> bọc ngoài.
            Thiếu Group ⇒ mở dropdown là crash cả tab (prod chỉ hiện "This page couldn't
            load" vì lỗi đã minify). Gặp thật khi smoke prod 10/07 trên tài khoản Toại. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Chuyển vai trò — chỉ đổi menu hiển thị, không đổi quyền của bạn.
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => choose("")}>
            {activeRole === null ? <Check className="mr-2 h-4 w-4" /> : <span className="mr-6" />}
            Mọi vai trò (gộp)
          </DropdownMenuItem>
          {roles.map((r) => (
            <DropdownMenuItem key={r} onClick={() => choose(r)}>
              {activeRole === r ? <Check className="mr-2 h-4 w-4" /> : <span className="mr-6" />}
              {roleCodeLabel(r)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
