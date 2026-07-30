"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const navigation = [
  {
    href: "/",
    label: "Tổng quan",
    shortLabel: "01",
    description: "Dòng thảo luận",
  },
  {
    href: "/jobs",
    label: "Tiến trình",
    shortLabel: "02",
    description: "Crawl & phân tích",
  },
  {
    href: "/settings",
    label: "Thiết lập",
    shortLabel: "03",
    description: "Nguồn & từ khóa",
  },
];

function pageTitle(pathname: string): string {
  if (pathname.startsWith("/settings")) return "Thiết lập thu thập";
  if (pathname.startsWith("/jobs")) return "Tiến trình hệ thống";
  return "Bức tranh thảo luận";
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Điều hướng chính">
        <Link className="brand" href="/" aria-label="VinListen — trang tổng quan">
          <span className="brand-mark" aria-hidden="true">
            VL
          </span>
          <span>
            <strong>VinListen</strong>
            <small>Social intelligence</small>
          </span>
        </Link>

        <nav className="primary-nav">
          {navigation.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                className={`nav-link${active ? " is-active" : ""}`}
                href={item.href}
                key={item.href}
                aria-current={active ? "page" : undefined}
              >
                <span className="nav-index" aria-hidden="true">
                  {item.shortLabel}
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <span className="privacy-dot" aria-hidden="true" />
          <p>
            <strong>Privacy first</strong>
            <span>Không lưu link hồ sơ cá nhân</span>
          </p>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">VinFuture · Social Listening</p>
            <h1>{pageTitle(pathname)}</h1>
          </div>
          <div className="topbar-meta">
            <span className="pulse-dot" aria-hidden="true" />
            <span>
              Làm mới tự động
              <strong>5 giây</strong>
            </span>
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
