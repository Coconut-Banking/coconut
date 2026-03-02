"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ArrowLeftRight,
  RefreshCw,
  Users,
  Settings,
  Search,
  Bell,
  ChevronDown,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useUser, useClerk } from "@clerk/nextjs";

const navItems = [
  { href: "/app/dashboard", label: "Overview", icon: LayoutDashboard, end: true },
  { href: "/app/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/app/subscriptions", label: "Subscriptions", icon: RefreshCw },
  { href: "/app/shared", label: "Shared", icon: Users },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState("");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { user } = useUser();
  const { signOut } = useClerk();

  const displayName = user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || "You";
  const displayEmail = user?.primaryEmailAddress?.emailAddress || "";
  const initials = displayName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/app/transactions?q=${encodeURIComponent(searchQuery.trim())}`);
    } else {
      router.push("/app/transactions");
    }
  };

  return (
    <div className="flex h-screen bg-[#F7FAF8] overflow-hidden">
      {/* Sidebar — hidden on small screens for responsive layout */}
      <aside className="hidden md:flex w-56 flex-col bg-white border-r border-[#E8EAEC] shrink-0">
        <div className="px-5 py-5 border-b border-[#E8EAEC]">
          <Link href="/" className="flex items-center gap-2.5 group cursor-pointer">
            <div className="w-7 h-7 rounded-lg bg-[#3D8E62] flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 2C7 2 3 4.5 3 8C3 10.2 4.8 12 7 12C9.2 12 11 10.2 11 8C11 4.5 7 2 7 2Z" fill="white" fillOpacity="0.9"/>
                <path d="M7 5C7 5 5 6.5 5 8.5C5 9.6 5.9 10.5 7 10.5" stroke="white" strokeWidth="0.8" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="text-[15px] font-semibold text-gray-900 tracking-tight">Coconut</span>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map(({ href, label, icon: Icon, end }) => {
            const isActive = end ? (pathname === href || pathname === "/app") : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150 ${
                  isActive
                    ? "bg-[#EEF7F2] text-[#3D8E62] font-medium"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <Icon size={16} className={isActive ? "text-[#3D8E62]" : "text-gray-400"} />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 py-4 border-t border-[#E8EAEC] relative" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#3D8E62] to-[#5BAE82] flex items-center justify-center text-white text-xs font-semibold shrink-0">
              {initials}
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">{displayName}</div>
              <div className="text-xs text-gray-400 truncate">{displayEmail}</div>
            </div>
            <ChevronDown size={14} className={`text-gray-400 shrink-0 transition-transform ${userMenuOpen ? "rotate-180" : ""}`} />
          </button>

          {userMenuOpen && (
            <div className="absolute bottom-full left-3 right-3 mb-1 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50">
              <button
                onClick={() => signOut(() => router.push("/"))}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors rounded-lg"
              >
                <LogOut size={14} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="bg-white border-b border-[#E8EAEC] px-4 sm:px-6 py-3 flex items-center gap-3 shrink-0">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="md:hidden w-10 h-10 flex items-center justify-center rounded-lg hover:bg-gray-50 text-gray-600"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <form onSubmit={handleSearch} className="flex-1 min-w-0 max-w-xl">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search your money. Try: dinner with Alex in January"
                className="w-full pl-9 pr-4 py-2 text-sm bg-[#F7FAF8] border border-[#E8EAEC] rounded-xl text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62] transition-all"
              />
            </div>
          </form>
          <div className="flex items-center gap-2">
            <button className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-50 text-gray-500 transition-colors relative">
              <Bell size={16} />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#3D8E62]" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto min-w-0">
          {children}
        </main>
      </div>

      {/* Mobile nav overlay */}
      {mobileNavOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black/30 z-40"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <aside className="md:hidden fixed inset-y-0 left-0 w-64 bg-white border-r border-[#E8EAEC] z-50 flex flex-col shadow-xl">
            <div className="px-5 py-5 border-b border-[#E8EAEC] flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2.5" onClick={() => setMobileNavOpen(false)}>
                <div className="w-7 h-7 rounded-lg bg-[#3D8E62] flex items-center justify-center shrink-0">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M7 2C7 2 3 4.5 3 8C3 10.2 4.8 12 7 12C9.2 12 11 10.2 11 8C11 4.5 7 2 7 2Z" fill="white" fillOpacity="0.9"/>
                    <path d="M7 5C7 5 5 6.5 5 8.5C5 9.6 5.9 10.5 7 10.5" stroke="white" strokeWidth="0.8" strokeLinecap="round"/>
                  </svg>
                </div>
                <span className="text-[15px] font-semibold text-gray-900 tracking-tight">Coconut</span>
              </Link>
              <button
                onClick={() => setMobileNavOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
              {navItems.map(({ href, label, icon: Icon, end }) => {
                const isActive = end ? (pathname === href || pathname === "/app") : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMobileNavOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ${
                      isActive
                        ? "bg-[#EEF7F2] text-[#3D8E62] font-medium"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    }`}
                  >
                    <Icon size={18} className={isActive ? "text-[#3D8E62]" : "text-gray-400"} />
                    {label}
                  </Link>
                );
              })}
            </nav>
          </aside>
        </>
      )}
    </div>
  );
}
