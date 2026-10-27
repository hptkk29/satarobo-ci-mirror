"use client";

import * as React from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { ChevronDownIcon, CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type ComboboxOption = { value: string; label: string };

// Diacritic-insensitive, case-insensitive normalizer (Vietnamese-aware) for
// client-side filtering. Standalone (no extra dep) so the combobox stays generic.
function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

/**
 * Searchable single-select combobox built on Base UI's Combobox primitive.
 * Admin-safe: NO Magic UI / Motion. Filtering is diacritic-insensitive so
 * typing "ha noi" matches "Hà Nội".
 */
export function Combobox({
  options,
  value,
  onValueChange,
  placeholder,
  emptyText = "Không tìm thấy kết quả",
  disabled,
  id,
  className,
}: {
  options: ComboboxOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const selected = React.useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );

  return (
    <ComboboxPrimitive.Root
      items={options}
      value={selected}
      onValueChange={(v) =>
        onValueChange((v as ComboboxOption | null)?.value ?? null)
      }
      isItemEqualToValue={(a, b) =>
        (a as ComboboxOption | null)?.value === (b as ComboboxOption | null)?.value
      }
      filter={(item, query) => {
        if (!query) return true;
        return normalizeText((item as ComboboxOption).label).includes(
          normalizeText(query),
        );
      }}
      disabled={disabled}
    >
      <div className="relative">
        <ComboboxPrimitive.Input
          id={id}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center rounded-lg border border-input bg-transparent py-2 pr-9 pl-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        />
        <ComboboxPrimitive.Trigger
          disabled={disabled}
          className="absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground disabled:opacity-50"
          aria-label="Mở danh sách"
        >
          <ComboboxPrimitive.Icon
            render={<ChevronDownIcon className="size-4" />}
          />
        </ComboboxPrimitive.Trigger>
      </div>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          sideOffset={4}
          className="isolate z-50 w-(--anchor-width)"
        >
          <ComboboxPrimitive.Popup className="max-h-(--available-height) w-(--anchor-width) min-w-36 overflow-y-auto rounded-lg bg-popover py-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
            <ComboboxPrimitive.Empty className="px-3 py-2 text-sm text-muted-foreground">
              {emptyText}
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List>
              {(item: ComboboxOption) => (
                <ComboboxPrimitive.Item
                  key={item.value}
                  value={item}
                  className="relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1.5 pr-8 pl-3 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <span className="flex-1">{item.label}</span>
                  <ComboboxPrimitive.ItemIndicator
                    render={
                      <span className="absolute right-2 flex size-4 items-center justify-center" />
                    }
                  >
                    <CheckIcon className="size-4" />
                  </ComboboxPrimitive.ItemIndicator>
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
}
