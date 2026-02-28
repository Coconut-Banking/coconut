"use client";

import { useState, useEffect } from "react";
import { ChevronRight, Shield, Database, CreditCard, User, Download, CheckCircle2, AlertTriangle } from "lucide-react";
import { motion } from "motion/react";
import { useTransactions } from "@/hooks/useTransactions";
import { useDemoMode } from "@/components/AppGate";

const DEMO_BANKS = [
  { id: "chase", name: "Chase", accounts: "Checking ••••4821, Savings ••••7203", color: "#117ACA", connected: "Mar 1, 2026" },
  { id: "amex", name: "American Express", accounts: "Platinum ••••9012", color: "#016FD0", connected: "Jan 15, 2026" },
];

const sections = [
  { id: "profile", label: "Profile", icon: User },
  { id: "banks", label: "Connected Banks", icon: CreditCard },
  { id: "security", label: "Security", icon: Shield },
  { id: "data", label: "Data & Export", icon: Database },
];

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState("profile");
  const [name, setName] = useState("Jamie Doe");
  const [email, setEmail] = useState("jamie@example.com");
  const [saved, setSaved] = useState(false);
  const [twoFA, setTwoFA] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const { linked } = useTransactions();
  const isDemo = useDemoMode();
  const [plaidAccounts, setPlaidAccounts] = useState<{
    accounts?: Array<{ account_id: string; name: string; type?: string; subtype?: string; mask?: string | null }>;
  } | null>(null);

  useEffect(() => {
    if (linked && !isDemo) {
      fetch("/api/plaid/accounts")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => data && setPlaidAccounts(data))
        .catch(() => {});
    }
  }, [linked, isDemo]);

  const banks = linked && !isDemo
    ? (plaidAccounts?.accounts ?? []).map((a) => ({
        id: a.account_id,
        name: a.name || "Account",
        accounts: `${(a.subtype ?? a.type ?? "account").replace(/_/g, " ")} ••••${a.mask ?? "****"}`,
        color: "#3D8E62",
        connected: "Connected",
      }))
    : DEMO_BANKS;

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="max-w-3xl mx-auto px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your account, security, and preferences.</p>
      </div>

      <div className="flex gap-6">
        <div className="w-44 shrink-0">
          <nav className="bg-white rounded-2xl border border-gray-100 p-2 space-y-0.5">
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all text-left ${
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
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#3D8E62] to-[#5BAE82] flex items-center justify-center text-white text-xl font-bold">
                      JD
                    </div>
                    <div>
                      <button className="text-sm text-[#3D8E62] font-medium hover:underline">Change photo</button>
                      <p className="text-xs text-gray-400 mt-0.5">JPG or PNG, max 2MB</p>
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
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62] transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Currency</label>
                      <select className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none bg-white focus:ring-2 focus:ring-[#3D8E62]/20">
                        <option>USD — US Dollar</option>
                        <option>EUR — Euro</option>
                        <option>GBP — British Pound</option>
                      </select>
                    </div>
                    <button
                      onClick={handleSave}
                      className="flex items-center gap-2 bg-[#3D8E62] hover:bg-[#2D7A52] text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
                    >
                      {saved ? (
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
                    {linked && (
                      <a href="/connect" className="text-sm text-[#3D8E62] font-medium hover:underline">+ Add account</a>
                    )}
                    {!linked && (
                      <button className="text-sm text-[#3D8E62] font-medium hover:underline">+ Add account</button>
                    )}
                  </div>
                  <div className="space-y-3">
                    {banks.length === 0 && linked && !plaidAccounts ? (
                      <div className="py-6 text-center text-sm text-gray-500">Loading accounts...</div>
                    ) : banks.length === 0 && linked ? (
                      <div className="py-6 text-center text-sm text-gray-500">No accounts found.</div>
                    ) : (
                    banks.map((bank) => (
                      <div key={bank.id} className="flex items-center gap-4 p-4 border border-gray-100 rounded-xl hover:border-gray-200 transition-colors">
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0"
                          style={{ backgroundColor: bank.color }}
                        >
                          {bank.name[0]}
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-semibold text-gray-900">{bank.name}</div>
                          <div className="text-xs text-gray-400">{bank.accounts}</div>
                          <div className="text-xs text-gray-400 mt-0.5">Connected {bank.connected}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="flex items-center gap-1 text-xs text-[#3D8E62]">
                            <CheckCircle2 size={12} />
                            Active
                          </div>
                          <button className="text-xs text-red-400 hover:text-red-600 px-2.5 py-1.5 border border-red-100 rounded-lg hover:border-red-200 transition-colors">
                            Disconnect
                          </button>
                        </div>
                      </div>
                    ))
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
