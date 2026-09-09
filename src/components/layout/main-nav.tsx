"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { List, Repeat, Shield, User, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  users: Users,
  repeat: Repeat,
  list: List,
  user: User,
  shield: Shield,
};

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
}

export function MainNav({
  items,
  orientation,
}: {
  items: NavItem[];
  orientation: "horizontal" | "vertical";
}) {
  const pathname = usePathname();

  return (
    <ul className={cn("flex", orientation === "horizontal" ? "justify-around" : "flex-col gap-1")}>
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href} className={orientation === "horizontal" ? "flex-1" : undefined}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 items-center gap-1 text-xs font-medium transition-colors",
                orientation === "horizontal"
                  ? "flex-col justify-center py-2"
                  : "min-h-11 flex-row gap-3 rounded-[var(--radius-control)] px-3 text-sm",
                active ? "text-primary" : "text-muted hover:text-foreground",
                orientation === "vertical" && active && "bg-primary/10",
              )}
            >
              <Icon className="size-5" aria-hidden />
              <span>{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
