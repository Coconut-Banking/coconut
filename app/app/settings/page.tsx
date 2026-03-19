"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { ChevronRight, Shield, Database, CreditCard, User, Download, CheckCircle2, AlertTriangle, Mail, Loader2, EyeOff, Eye, Building2, Wallet, Upload, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useTransactions } from "@/hooks/useTransactions";
import { useGmail } from "@/hooks/useGmail";
import { useHiddenAccounts } from "@/hooks/useHiddenAccounts";
import { useCurrency, useCompactView, useManualMonthlyIncome } from "@/hooks/useCurrency";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { formatCurrency } from "@/lib/currency";
import { usePlaidAlerts } from "@/hooks/usePlaidAlerts";
import { usePayPal } from "@/hooks/usePayPal";
import { CSVImportModal } from "@/components/csv-import-modal";
import { useSearchParams } from "next/navigation";
import { AnimatePresence } from "motion/react";

const sections = [
  { id: "profile", label: "Profile", icon: User },
  { id: "banks", label: "Connected Banks", icon: CreditCard },
  { id: "wallets", label: "Digital Wallets", icon: Wallet },
  { id: "email", label: "Email Receipts", icon: Mail },
  { id: "security", label: "Security", icon: Shield },
  { id: "data", label: "Data & Export", icon: Database },
];

function SettingsContent() {
  const { user } = useUser();
  const [activeSection, setActiveSection] = useState("profile");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const { currencyCode: currency, setCurrency } = useCurrency();
  const { compact: compactView, setCompact: setCompactView } = useCompactView();
  const { manualMonthlyIncome, setManualMonthlyIncome } = useManualMonthlyIncome();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [twoFA, setTwoFA] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const { linked, syncAndRefetch } = useTransactions();
  const gmail = useGmail();
  const { needsReauth, newAccountsAvailable, refetch: refetchAlerts } = usePlaidAlerts();
  const paypal = usePayPal();
  const { hide, unhide, isHidden } = useHiddenAccounts();
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [paypalBanner, setPaypalBanner] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const searchParams = useSearchParams();
  const [incomeInput, setIncomeInput] = useState("");
  const [plaidAccounts, setPlaidAccounts] = useState<{
    accounts?: Array<{ account_id: string; id?: string; name: string; type?: string; subtype?: string; mask?: string | null; institution_name?: string | null }>;
  } | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountsRefreshing, setAccountsRefreshing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [manualWallets, setManualWallets] = useState<{ id: string; name: string; platform: string; balance: number }[]>([]);
  const [walletPlatform, setWalletPlatform] = useState<"venmo" | "cashapp">("venmo");
  const [walletBalance, setWalletBalance] = useState("");
  const [walletSaving, setWalletSaving] = useState(false);
  const retriedAccountsRef = useRef(false);
  const refreshingRef = useRef(false);

  const disconnectBank = async () => {
    if (!confirm("Disconnect your bank? You can reconnect anytime to get real transactions.")) return;
    setDisconnecting(true);
    try {
      const res = await fetch("/api/plaid/disconnect", { method: "POST" });
      if (res.ok) {
        if (typeof sessionStorage !== "undefined") sessionStorage.removeItem("tx_prod_sync_done");
        window.location.href = "/connect";
      } else alert("Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  };

  const wipeAllData = async () => {
    if (!confirm("Delete ALL your transactions, accounts, and linked data? This cannot be undone. You'll need to reconnect your bank.")) return;
    setWiping(true);
    try {
      const res = await fetch("/api/plaid/wipe", { method: "POST" });
      if (res.ok) {
        if (typeof sessionStorage !== "undefined") sessionStorage.removeItem("tx_prod_sync_done");
        window.location.href = "/connect";
      } else alert("Failed to wipe data");
    } finally {
      setWiping(false);
    }
  };

  useEffect(() => {
    if (user) {
      setName(user.fullName ?? "");
      setEmail(user.primaryEmailAddress?.emailAddress ?? "");
    }
  }, [user]);

  useEffect(() => {
    setIncomeInput(manualMonthlyIncome > 0 ? String(manualMonthlyIncome) : "");
  }, [manualMonthlyIncome]);

  useEffect(() => {
    const pp = searchParams.get("paypal");
    if (pp === "connected") {
      setPaypalBanner({ type: "success", message: "PayPal connected successfully!" });
      setActiveSection("wallets");
    } else if (pp === "error" || pp === "unauthorized") {
      setPaypalBanner({ type: "error", message: pp === "unauthorized" ? "PayPal authorization was denied. Please try again." : "Failed to connect PayPal. Please try again." });
      setActiveSection("wallets");
    }
  }, [searchParams]);

  // Fetch manual wallet balances
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/manual-accounts", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setManualWallets(data.accounts ?? []);
        }
      } catch {
        // silent – non-critical
      }
    })();
  }, []);

  const saveWalletBalance = async () => {
    const bal = parseFloat(walletBalance);
    if (!isFinite(bal)) return;
    setWalletSaving(true);
    try {
      const platformLabel = walletPlatform === "venmo" ? "Venmo" : "Cash App";
      const res = await fetch("/api/manual-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `${platformLabel} Wallet`, platform: walletPlatform, balance: bal }),
      });
      if (res.ok) {
        const data = await res.json();
        setManualWallets((prev) => {
          const idx = prev.findIndex((w) => w.platform === walletPlatform && w.name === `${platformLabel} Wallet`);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = data.account;
            return copy;
          }
          return [...prev, data.account];
        });
        setWalletBalance("");
      }
    } catch {
      // silent
    } finally {
      setWalletSaving(false);
    }
  };

  const removeWallet = async (id: string) => {
    try {
      const res = await fetch(`/api/manual-accounts?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setManualWallets((prev) => prev.filter((w) => w.id !== id));
      }
    } catch {
      // silent
    }
  };

  const fetchAccounts = async (forceRefresh = false) => {
    setAccountsError(null);
    const url = forceRefresh ? `/api/plaid/accounts?refresh=1&t=${Date.now()}` : `/api/plaid/accounts?t=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store", credentials: "include" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setAccountsError(body.error ?? `Failed to load accounts (${res.status})`);
      setPlaidAccounts({ accounts: [] });
      return;
    }
    const data = await res.json();
    setPlaidAccounts(data);
  };

  const refreshAccounts = async () => {
    if (!linked || refreshingRef.current) return;
    refreshingRef.current = true;
    setAccountsRefreshing(true);
    setAccountsError(null);
    try {
      await fetch("/api/plaid/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      await syncAndRefetch();
      await fetchAccounts(true);
    } catch {
      setAccountsError("Refresh failed");
    } finally {
      setAccountsRefreshing(false);
      refreshingRef.current = false;
    }
  };

  // Fetch accounts on mount and when linked changes. When linked but empty, retry with refresh=1
  // to ensure sync runs (fixes "No accounts found" when bank is connected but cache is stale).
  useEffect(() => {
    fetchAccounts();
  }, [linked]);

  const banks = (Array.isArray(plaidAccounts?.accounts) ? plaidAccounts.accounts : []).map((a) => {
    const inst = (a as { institution_name?: string | null }).institution_name;
    const accountLabel = a.name || "Account";
    const displayName = inst ? `${inst} - ${accountLabel}` : accountLabel;
    const liabilityTypes = new Set(["credit", "loan"]);
    return {
      id: (a as { id?: string }).id ?? a.account_id,
      name: displayName,
      accounts: `${(a.subtype ?? a.type ?? "account").replace(/_/g, " ")} ••••${a.mask ?? "****"}`,
      color: "#3D8E62",
      connected: "Connected",
      subtype: a.subtype ?? a.type ?? "account",
      mask: a.mask ?? null,
      balance: (a as { balance_current?: number | null }).balance_current ?? null,
      iso_currency_code: (a as { iso_currency_code?: string }).iso_currency_code ?? "USD",
      isLiability: liabilityTypes.has(a.type ?? ""),
    };
  });
  const visibleBanks = banks.filter((b) => !isHidden(b.id));
  const hiddenBanks = banks.filter((b) => isHidden(b.id));

  // When linked and accounts empty, retry once with refresh=1 to run full sync path
  useEffect(() => {
    if (
      linked &&
      banks.length === 0 &&
      !plaidAccounts?.accounts?.length &&
      !accountsRefreshing &&
      !retriedAccountsRef.current
    ) {
      retriedAccountsRef.current = true;
      fetchAccounts(true);
    }
  }, [linked, banks.length, plaidAccounts?.accounts?.length, accountsRefreshing]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const [firstName, ...rest] = name.trim().split(" ");
      const lastName = rest.join(" ");
      await user.update({ firstName: firstName || "", lastName: lastName || "" });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      alert("Failed to save profile changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your account, security, and preferences.</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-6">
        <div className="w-full sm:w-44 shrink-0">
          <nav className="bg-white rounded-2xl border border-gray-100 p-2 flex sm:flex-col gap-0.5 overflow-x-auto">
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all text-left whitespace-nowrap ${
                  activeSection === id
                    ? "bg-[#EEF7F2] text-[#3D8E62] font-medium"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <Icon size={14} className={activeSection === id ? "text-[#3D8E62]" : "text-gray-400"} />
                {label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex-1 min-w-0">
          <motion.div
            key={activeSection}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {activeSection === "profile" && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border border-gray-100 p-6">
                  <h2 className="text-sm font-semibold text-gray-900 mb-5">Profile</h2>
                  <div className="flex items-center gap-4 mb-6 pb-6 border-b border-gray-100">
                    {user?.imageUrl ? (
                      <img src={user.imageUrl} alt="Profile" className="w-16 h-16 rounded-full object-cover" />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#3D8E62] to-[#5BAE82] flex items-center justify-center text-white text-xl font-bold">
                        {(user?.firstName?.[0] ?? "").toUpperCase()}{(user?.lastName?.[0] ?? "").toUpperCase() || ""}
                      </div>
                    )}
                    <div>
                      <label className="text-sm font-medium text-[#3D8E62] hover:text-[#2D7A52] cursor-pointer">
                        Change photo
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file || !user) return;
                            try {
                              await user.setProfileImage({ file });
                              e.target.value = "";
                            } catch (err) {
                              alert(err instanceof Error ? err.message : "Failed to update photo");
                            }
                          }}
                        />
                      </label>
                      <p className="text-xs text-gray-400 mt-0.5">JPG, PNG or GIF. Max 5MB.</p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Full name</label>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62] transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Email address</label>
                      <input
                        type="email"
                        value={email}
                        readOnly
                        className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 text-gray-500 cursor-not-allowed"
                      />
                      <p className="text-xs text-gray-400 mt-1">Email is managed by your authentication provider.</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Currency</label>
                      <select
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value as typeof currency)}
                        className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none bg-white focus:ring-2 focus:ring-[#3D8E62]/20"
                      >
                        {SUPPORTED_CURRENCIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code} — {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Expected monthly income</label>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        placeholder="e.g. 5000"
                        value={incomeInput}
                        onChange={(e) => setIncomeInput(e.target.value)}
                        onBlur={async () => {
                          const v = parseFloat(incomeInput);
                          if (!Number.isNaN(v) && v >= 0) {
                            await setManualMonthlyIncome(v);
                            setIncomeInput(v > 0 ? String(v) : "");
                          } else {
                            setIncomeInput(manualMonthlyIncome > 0 ? String(manualMonthlyIncome) : "");
                          }
                        }}
                        className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62] transition-all"
                      />
                      <p className="text-xs text-gray-400 mt-0.5">Add if your bank doesn&apos;t sync payroll (Rippling, People Center, etc.) — improves cash flow accuracy</p>
                    </div>
                    <div className="flex items-center justify-between py-3 border-b border-gray-100">
                      <div>
                        <div className="text-sm font-medium text-gray-800">Compact view</div>
                        <div className="text-xs text-gray-400 mt-0.5">Show more items per screen in transactions and receipts</div>
                      </div>
                      <label className="relative inline-flex cursor-pointer">
                        <input
                          type="checkbox"
                          checked={compactView}
                          onChange={(e) => setCompactView(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-gray-200 peer-checked:bg-[#3D8E62] rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                      </label>
                    </div>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex items-center gap-2 bg-[#3D8E62] hover:bg-[#2D7A52] text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
                    >
                      {saving ? (
                        <>
                          <Loader2 size={15} className="animate-spin" />
                          Saving…
                        </>
                      ) : saved ? (
                        <>
                          <CheckCircle2 size={15} />
                          Saved
                        </>
                      ) : (
                        "Save changes"
                      )}
                    </button>
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 p-6">
                  <h2 className="text-sm font-semibold text-gray-900 mb-1">Notifications</h2>
                  <p className="text-xs text-gray-400 mb-4">Control when and how Coconut reaches you.</p>
                  <div className="space-y-3">
                    {[
                      { label: "Large transactions", desc: "Alerts for charges over $200" },
                      { label: "Price increases", desc: "When subscriptions change cost" },
                      { label: "Split reminders", desc: "Gentle nudges for unsettled splits" },
                      { label: "Weekly digest", desc: "Summary of your week every Sunday" },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between py-1">
                        <div>
                          <div className="text-sm font-medium text-gray-800">{item.label}</div>
                          <div className="text-xs text-gray-400">{item.desc}</div>
                        </div>
                        <label className="relative inline-flex cursor-pointer">
                          <input type="checkbox" defaultChecked className="sr-only peer" />
                          <div className="w-9 h-5 bg-gray-200 peer-checked:bg-[#3D8E62] rounded-full transition-colors peer-focus:outline-none after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeSection === "banks" && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border border-gray-100 p-6">
                  <div className="flex items-center justify-between mb-5">
                    <h2 className="text-sm font-semibold text-gray-900">Connected banks</h2>
                    <a href="/connect" className="text-sm text-[#3D8E62] font-medium hover:underline">
                      {linked ? "+ Add account" : "Connect bank"}
                    </a>
                  </div>
                  <div className="space-y-3">
                    {banks.length === 0 && linked && plaidAccounts === null ? (
                      <div className="py-6 text-center text-sm text-gray-500">Loading accounts...</div>
                    ) : banks.length === 0 && linked ? (
                      <div className="py-6 text-center space-y-3">
                        <p className="text-sm text-gray-500">No accounts found.</p>
                        {accountsError === "Not linked" ? (
                          <p className="text-xs text-amber-600">
                            Connect your bank first, then come back here.
                          </p>
                        ) : accountsError ? (
                          <p className="text-xs text-amber-600">{accountsError}</p>
                        ) : null}
                        <div className="flex flex-col sm:flex-row gap-2 justify-center items-center">
                          <a
                            href="/connect"
                            className="text-sm font-medium text-white bg-[#3D8E62] hover:bg-[#2D7A52] px-4 py-2 rounded-xl transition-colors"
                          >
                            Connect bank
                          </a>
                            {!accountsError && (
                            <button
                              onClick={refreshAccounts}
                              disabled={accountsRefreshing}
                              className="text-sm text-[#3D8E62] font-medium hover:underline disabled:opacity-50"
                            >
                              {accountsRefreshing ? "Refreshing…" : "Refresh accounts"}
                            </button>
                          )}
                        </div>
                        {process.env.NODE_ENV !== "production" && (
                          <button
                            onClick={async () => {
                              try {
                                const r = await fetch("/api/plaid/debug");
                                const d = await r.json();
                                alert(JSON.stringify(d, null, 2));
                              } catch {
                                alert("Debug fetch failed");
                              }
                            }}
                            className="mt-2 text-xs text-gray-400 hover:text-gray-600"
                          >
                            Show debug info
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        {visibleBanks.map((bank) => (
                          <div key={bank.id} className="flex items-center gap-3 p-4 border border-gray-100 rounded-xl">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${bank.isLiability ? "bg-red-50" : "bg-[#EEF7F2]"}`}>
                              {bank.isLiability
                                ? <CreditCard size={15} className="text-red-400" />
                                : <Building2 size={15} className="text-[#3D8E62]" />
                              }
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-gray-900 truncate">{bank.name}</div>
                              <div className="text-xs text-gray-400 capitalize">
                                {bank.subtype.replace(/_/g, " ")}{bank.mask ? ` ••${bank.mask}` : ""}
                              </div>
                            </div>
                            <div className="text-right shrink-0 mr-2">
                              {bank.balance != null ? (
                                <>
                                  <div className={`text-sm font-semibold ${bank.isLiability ? "text-red-500" : "text-gray-900"}`}>
                                    {bank.isLiability ? "-" : ""}{formatCurrency(bank.balance, bank.iso_currency_code)}
                                  </div>
                                  <div className="text-xs text-gray-400">{bank.isLiability ? "owed" : "available"}</div>
                                </>
                              ) : (
                                <div className="text-xs text-gray-400">—</div>
                              )}
                            </div>
                            <button
                              onClick={() => hide(bank.id)}
                              className="text-xs text-gray-500 hover:text-red-600 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                              title="Hide from Transactions"
                            >
                              <EyeOff size={14} />
                              Hide
                            </button>
                          </div>
                        ))}
                        {hiddenBanks.length > 0 && (
                          <div className="pt-2 border-t border-gray-100">
                            <div className="text-xs font-medium text-gray-500 mb-2">Hidden accounts</div>
                            {hiddenBanks.map((bank) => (
                              <div key={bank.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl mb-2">
                                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-gray-200/60">
                                  {bank.isLiability
                                    ? <CreditCard size={13} className="text-gray-400" />
                                    : <Building2 size={13} className="text-gray-400" />
                                  }
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm text-gray-600 truncate">{bank.name}</div>
                                  <div className="text-xs text-gray-400 capitalize">
                                    {bank.subtype.replace(/_/g, " ")}{bank.mask ? ` ••${bank.mask}` : ""}
                                  </div>
                                </div>
                                <button
                                  onClick={() => unhide(bank.id)}
                                  className="text-xs text-[#3D8E62] hover:text-[#2D7A52] flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-[#EEF7F2] transition-colors"
                                >
                                  <Eye size={14} />
                                  Show again
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="pt-2 space-y-2">
                          {newAccountsAvailable && (
                            <Link
                              href="/connect?update=1&new_accounts=1"
                              className="block w-full text-sm text-[#3D8E62] hover:text-[#2D7A52] px-4 py-3 border border-[#C3E0D3] rounded-xl hover:bg-[#EEF7F2] transition-colors text-center"
                              onClick={() => refetchAlerts()}
                            >
                              Add new accounts from your bank
                            </Link>
                          )}
                          <Link
                            href="/connect?update=1"
                            className={`block w-full text-sm px-4 py-3 border rounded-xl transition-colors text-center ${
                              needsReauth
                                ? "font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border-amber-200"
                                : "text-[#3D8E62] hover:text-[#2D7A52] border-[#C3E0D3] hover:bg-[#EEF7F2]"
                            }`}
                          >
                            {needsReauth ? "Fix connection (re-auth at bank) — required" : "Fix connection (re-auth at bank)"}
                          </Link>
                          <button
                            onClick={disconnectBank}
                            disabled={disconnecting || wiping}
                            className="w-full text-sm text-red-600 hover:text-red-700 px-4 py-3 border border-red-200 rounded-xl hover:bg-red-50 transition-colors disabled:opacity-50"
                          >
                            {disconnecting ? "Disconnecting…" : "Disconnect bank"}
                          </button>
                          <button
                            onClick={wipeAllData}
                            disabled={disconnecting || wiping}
                            className="w-full text-sm text-red-700 hover:text-red-800 px-4 py-3 border border-red-300 rounded-xl bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50"
                          >
                            {wiping ? "Wiping…" : "Wipe all data & start fresh"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="bg-[#EEF7F2] border border-[#C3E0D3] rounded-2xl px-5 py-4 flex items-start gap-3">
                  <Shield size={16} className="text-[#3D8E62] shrink-0 mt-0.5" />
                  <p className="text-sm text-[#2D5A44]">
                    Coconut connects via read-only access. We never store your banking credentials, and cannot initiate any transactions.
                  </p>
                </div>
              </div>
            )}

            {activeSection === "wallets" && (
              <div className="space-y-4">
                {paypalBanner && (
                  <div className={`rounded-2xl px-5 py-4 flex items-start gap-3 ${
                    paypalBanner.type === "success"
                      ? "bg-[#EEF7F2] border border-[#C3E0D3]"
                      : "bg-red-50 border border-red-100"
                  }`}>
                    {paypalBanner.type === "success" ? (
                      <CheckCircle2 size={16} className="text-[#3D8E62] shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
                    )}
                    <p className={`text-sm ${paypalBanner.type === "success" ? "text-[#2D5A44]" : "text-red-700"}`}>
                      {paypalBanner.message}
                    </p>
                  </div>
                )}

                {/* PayPal */}
                <div className="bg-white rounded-2xl border border-gray-100 p-6">
                  <h2 className="text-sm font-semibold text-gray-900 mb-1">PayPal</h2>
                  <p className="text-xs text-gray-400 mb-5">
                    Connect your PayPal account to sync transactions automatically.
                  </p>

                  {paypal.loading ? (
                    <div className="py-6 text-center text-sm text-gray-500">Loading...</div>
                  ) : !paypal.connected ? (
                    <div className="text-center py-8">
                      <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-3">
                        <Wallet size={20} className="text-gray-400" />
                      </div>
                      <p className="text-sm text-gray-600 mb-1">No PayPal connected</p>
                      <p className="text-xs text-gray-400 mb-4">
                        Link your PayPal to import and sync your transactions.
                      </p>
                      <button
                        onClick={paypal.connect}
                        className="bg-[#3D8E62] hover:bg-[#2D7A52] text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
                      >
                        Connect PayPal
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center gap-4 p-4 border border-gray-100 rounded-xl">
                        <div className="w-10 h-10 rounded-xl bg-[#EEF7F2] flex items-center justify-center shrink-0">
                          <Wallet size={16} className="text-[#3D8E62]" />
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-semibold text-gray-900">{paypal.email || "PayPal"}</div>
                          <div className="text-xs text-gray-400">
                            {paypal.lastSync
                              ? `Last synced ${new Date(paypal.lastSync).toLocaleString()}`
                              : "Not yet synced"}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="flex items-center gap-1 text-xs text-[#3D8E62]">
                            <CheckCircle2 size={12} />
                            Connected
                          </div>
                          <button
                            onClick={() => {
                              if (confirm("Disconnect PayPal? You can reconnect anytime.")) {
                                paypal.disconnect();
                              }
                            }}
                            className="text-xs text-red-400 hover:text-red-600 px-2.5 py-1.5 border border-red-100 rounded-lg hover:border-red-200 transition-colors"
                          >
                            Disconnect
                          </button>
                        </div>
                      </div>

                      <button
                        onClick={paypal.sync}
                        disabled={paypal.syncing}
                        className="flex items-center gap-2 bg-[#3D8E62] hover:bg-[#2D7A52] disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
                      >
                        {paypal.syncing ? (
                          <>
                            <Loader2 size={15} className="animate-spin" />
                            Syncing...
                          </>
                        ) : (
                          "Sync Now"
                        )}
                      </button>

                      {paypal.syncResult && (
                        <div className="bg-[#EEF7F2] border border-[#C3E0D3] rounded-xl px-4 py-3">
                          <p className="text-sm text-[#2D5A44]">
                            Synced <span className="font-semibold">{paypal.syncResult.synced}</span> transaction{paypal.syncResult.synced !== 1 ? "s" : ""}.
                          </p>
                          {paypal.syncResult.errors.length > 0 && (
                            <p className="text-xs text-amber-600 mt-1">
                              {paypal.syncResult.errors.length} error{paypal.syncResult.errors.length !== 1 ? "s" : ""} during sync.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* CSV Import */}
                <div className="bg-white rounded-2xl border border-gray-100 p-6">
                  <h2 className="text-sm font-semibold text-gray-900 mb-1">CSV Import</h2>
                  <p className="text-xs text-gray-400 mb-5">
                    Import Venmo, Cash App, or PayPal transaction history from CSV exports.
                  </p>
                  <div className="text-center py-4">
                    <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-3">
                      <Upload size={20} className="text-gray-400" />
                    </div>
                    <button
                      onClick={() => setCsvModalOpen(true)}
                      className="bg-[#3D8E62] hover:bg-[#2D7A52] text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
                    >
                      Import CSV
                    </button>
                  </div>
                </div>

                {/* Wallet Balances */}
                <div className="bg-white rounded-2xl border border-gray-100 p-6">
                  <h2 className="text-sm font-semibold text-gray-900 mb-1">Wallet Balances</h2>
                  <p className="text-xs text-gray-400 mb-5">
                    Manually set your Venmo or Cash App wallet balance. PayPal balance is auto-synced.
                  </p>

                  <div className="flex items-end gap-3 mb-5">
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 mb-1.5 block">Platform</label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setWalletPlatform("venmo");
                            const existing = manualWallets.find((w) => w.platform === "venmo");
                            setWalletBalance(existing ? String(existing.balance) : "");
                          }}
                          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                            walletPlatform === "venmo"
                              ? "bg-[#3D8E62] text-white"
                              : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                          }`}
                        >
                          Venmo
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setWalletPlatform("cashapp");
                            const existing = manualWallets.find((w) => w.platform === "cashapp");
                            setWalletBalance(existing ? String(existing.balance) : "");
                          }}
                          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                            walletPlatform === "cashapp"
                              ? "bg-[#3D8E62] text-white"
                              : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                          }`}
                        >
                          Cash App
                        </button>
                      </div>
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 mb-1.5 block">Balance</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={walletBalance}
                        onChange={(e) => setWalletBalance(e.target.value)}
                        className="w-full border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/30 focus:border-[#3D8E62]"
                      />
                    </div>
                    <button
                      onClick={saveWalletBalance}
                      disabled={walletSaving || !walletBalance}
                      className="bg-[#3D8E62] hover:bg-[#2D7A52] disabled:opacity-50 text-white px-5 py-2 rounded-xl text-sm font-medium transition-colors"
                    >
                      {walletSaving ? "Saving..." : "Save"}
                    </button>
                  </div>

                  {manualWallets.length > 0 && (
                    <div className="space-y-2">
                      {manualWallets.map((w) => (
                        <div key={w.id} className="flex items-center gap-3 p-3 border border-gray-100 rounded-xl">
                          <div className="w-8 h-8 rounded-lg bg-[#EEF7F2] flex items-center justify-center shrink-0">
                            <Wallet size={14} className="text-[#3D8E62]" />
                          </div>
                          <div className="flex-1">
                            <div className="text-sm font-medium text-gray-900">{w.name}</div>
                            <div className="text-xs text-gray-400">{w.platform === "venmo" ? "Venmo" : w.platform === "cashapp" ? "Cash App" : w.platform}</div>
                          </div>
                          <div className="text-sm font-semibold text-gray-900">${w.balance.toFixed(2)}</div>
                          <button
                            onClick={() => removeWallet(w.id)}
                            className="text-gray-300 hover:text-red-500 transition-colors p-1"
                            title="Remove wallet"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-[#EEF7F2] border border-[#C3E0D3] rounded-2xl px-5 py-4 flex items-start gap-3">
                  <Shield size={16} className="text-[#3D8E62] shrink-0 mt-0.5" />
                  <p className="text-sm text-[#2D5A44]">
                    Coconut connects via read-only OAuth access. We never store your PayPal password.
                  </p>
                </div>

                <AnimatePresence>
                  {csvModalOpen && (
                    <CSVImportModal
                      onClose={() => setCsvModalOpen(false)}
                      onSuccess={() => setCsvModalOpen(false)}
                    />
                  )}
                </AnimatePresence>
              </div>
            )}

            {activeSection === "email" && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border border-gray-100 p-6">
                  <h2 className="text-sm font-semibold text-gray-900 mb-1">Email Receipts</h2>
                  <p className="text-xs text-gray-400 mb-5">
                    Connect your Gmail to automatically scan for purchase receipts and enrich your transaction data.
                  </p>

                  {gmail.loading ? (
                    <div className="py-6 text-center text-sm text-gray-500">Loading...</div>
                  ) : !gmail.connected ? (
                    <div className="text-center py-8">
                      <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-3">
                        <Mail size={20} className="text-gray-400" />
                      </div>
                      <p className="text-sm text-gray-600 mb-1">No email connected</p>
                      <p className="text-xs text-gray-400 mb-4">
                        Connect Gmail to find itemized receipts from Amazon, Walmart, and more.
                      </p>
                      <button
                        onClick={gmail.connect}
                        className="bg-[#3D8E62] hover:bg-[#2D7A52] text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
                      >
                        Connect Gmail
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center gap-4 p-4 border border-gray-100 rounded-xl">
                        <div className="w-10 h-10 rounded-xl bg-[#EEF7F2] flex items-center justify-center shrink-0">
                          <Mail size={16} className="text-[#3D8E62]" />
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-semibold text-gray-900">{gmail.email || "Gmail"}</div>
                          <div className="text-xs text-gray-400">
                            {gmail.lastScan
                              ? `Last scanned ${new Date(gmail.lastScan).toLocaleDateString()}`
                              : "Not yet scanned"}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="flex items-center gap-1 text-xs text-[#3D8E62]">
                            <CheckCircle2 size={12} />
                            Connected
                          </div>
                          <button
                            onClick={gmail.disconnect}
                            className="text-xs text-red-400 hover:text-red-600 px-2.5 py-1.5 border border-red-100 rounded-lg hover:border-red-200 transition-colors"
                          >
                            Disconnect
                          </button>
                        </div>
                      </div>

                      <button
                        onClick={gmail.scan}
                        disabled={gmail.scanning}
                        className="flex items-center gap-2 bg-[#3D8E62] hover:bg-[#2D7A52] disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
                      >
                        {gmail.scanning ? (
                          <>
                            <Loader2 size={15} className="animate-spin" />
                            Scanning...
                          </>
                        ) : (
                          "Scan for receipts"
                        )}
                      </button>

                      {gmail.tokenError && (
                        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                          <p className="text-sm text-red-700 mb-2">
                            Gmail access has expired. Please reconnect to continue scanning.
                          </p>
                          <button
                            onClick={() => { gmail.disconnect().then(() => gmail.connect()); }}
                            className="text-xs font-medium text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-100 transition-colors"
                          >
                            Reconnect Gmail
                          </button>
                        </div>
                      )}

                      {gmail.scanResult && (
                        <div className="bg-[#EEF7F2] border border-[#C3E0D3] rounded-xl px-4 py-3">
                          <p className="text-sm text-[#2D5A44]">
                            Scanned <span className="font-semibold">{gmail.scanResult.emailsFetched}</span> email{gmail.scanResult.emailsFetched !== 1 ? "s" : ""},
                            saved <span className="font-semibold">{gmail.scanResult.inserted}</span> receipt{gmail.scanResult.inserted !== 1 ? "s" : ""},
                            matched <span className="font-semibold">{gmail.scanResult.matched}</span> to transactions.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="bg-[#EEF7F2] border border-[#C3E0D3] rounded-2xl px-5 py-4 flex items-start gap-3">
                  <Shield size={16} className="text-[#3D8E62] shrink-0 mt-0.5" />
                  <p className="text-sm text-[#2D5A44]">
                    Coconut only reads receipt emails from known retailers. We never access personal messages, drafts, or sent mail.
                  </p>
                </div>
              </div>
            )}

            {activeSection === "security" && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border border-gray-100 p-6">
                  <h2 className="text-sm font-semibold text-gray-900 mb-5">Security</h2>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-3 border-b border-gray-100">
                      <div>
                        <div className="text-sm font-medium text-gray-800">Two-factor authentication</div>
                        <div className="text-xs text-gray-400 mt-0.5">Extra layer of security with an authenticator app</div>
                      </div>
                      <label className="relative inline-flex cursor-pointer">
                        <input
                          type="checkbox"
                          checked={twoFA}
                          onChange={(e) => setTwoFA(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-gray-200 peer-checked:bg-[#3D8E62] rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                      </label>
                    </div>
                    <button className="flex items-center justify-between w-full py-3 border-b border-gray-100 text-left hover:bg-gray-50 -mx-2 px-2 rounded-lg transition-colors">
                      <div>
                        <div className="text-sm font-medium text-gray-800">Change password</div>
                        <div className="text-xs text-gray-400 mt-0.5">Last changed 3 months ago</div>
                      </div>
                      <ChevronRight size={15} className="text-gray-400" />
                    </button>
                    <button className="flex items-center justify-between w-full py-3 border-b border-gray-100 text-left hover:bg-gray-50 -mx-2 px-2 rounded-lg transition-colors">
                      <div>
                        <div className="text-sm font-medium text-gray-800">Active sessions</div>
                        <div className="text-xs text-gray-400 mt-0.5">Manage where you&apos;re logged in</div>
                      </div>
                      <ChevronRight size={15} className="text-gray-400" />
                    </button>
                    <div className="flex items-center justify-between py-3">
                      <div>
                        <div className="text-sm font-medium text-gray-800">Login notifications</div>
                        <div className="text-xs text-gray-400 mt-0.5">Get notified of new sign-ins</div>
                      </div>
                      <label className="relative inline-flex cursor-pointer">
                        <input type="checkbox" checked={notifications} onChange={(e) => setNotifications(e.target.checked)} className="sr-only peer" />
                        <div className="w-9 h-5 bg-gray-200 peer-checked:bg-[#3D8E62] rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                      </label>
                    </div>
                  </div>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-2xl px-5 py-4 flex items-start gap-3">
                  <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm font-semibold text-amber-900 mb-0.5">Danger zone</div>
                    <p className="text-xs text-amber-700 mb-3">These actions are irreversible. Proceed with caution.</p>
                    <button className="text-xs text-red-500 font-medium border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
                      Delete account
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeSection === "data" && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border border-gray-100 p-6">
                  <h2 className="text-sm font-semibold text-gray-900 mb-1">Data & Export</h2>
                  <p className="text-xs text-gray-400 mb-5">Download your data anytime. Your data, your rules.</p>
                  <div className="mb-5 p-4 border border-red-200 rounded-xl bg-red-50">
                    <div className="text-sm font-medium text-red-800 mb-1">Wipe all data</div>
                    <p className="text-xs text-red-700 mb-3">Delete all transactions, accounts, and linked data. Start completely fresh and reconnect.</p>
                    <button
                      onClick={wipeAllData}
                      disabled={wiping}
                      className="text-sm font-medium text-red-700 hover:text-red-800 border border-red-300 px-3 py-2 rounded-lg bg-white hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      {wiping ? "Wiping…" : "Wipe all data & start fresh"}
                    </button>
                  </div>
                  <div className="space-y-3">
                    {[
                      { label: "Export transactions", desc: "All transactions as a CSV file", format: "CSV" },
                      { label: "Export subscriptions", desc: "Your recurring charges list", format: "CSV" },
                      { label: "Full data export", desc: "Everything in JSON format", format: "JSON" },
                    ].map((item) => (
                      <button
                        key={item.label}
                        className="w-full flex items-center gap-4 p-4 border border-gray-100 rounded-xl hover:border-gray-200 hover:bg-gray-50 transition-all text-left"
                      >
                        <div className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center shrink-0">
                          <Download size={15} className="text-gray-500" />
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-medium text-gray-800">{item.label}</div>
                          <div className="text-xs text-gray-400">{item.desc}</div>
                        </div>
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-md font-mono shrink-0">
                          {item.format}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 p-6">
                  <h2 className="text-sm font-semibold text-gray-900 mb-4">Data privacy</h2>
                  <div className="space-y-3 text-sm text-gray-600">
                    {[
                      "Your transaction data is encrypted at rest with AES-256.",
                      "We use read-only connections — we can't move your money.",
                      "We never sell your data to third parties.",
                      "You can delete your account and all data at any time.",
                    ].map((item) => (
                      <div key={item} className="flex items-start gap-2.5">
                        <CheckCircle2 size={14} className="text-[#3D8E62] shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                  <button className="flex items-center gap-1.5 mt-4 text-sm text-[#3D8E62] font-medium hover:underline">
                    Read our full privacy policy <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>}>
      <SettingsContent />
    </Suspense>
  );
}
