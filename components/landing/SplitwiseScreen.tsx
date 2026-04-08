"use client";

/**
 * SplitwiseScreen — lazy-loaded demo screen shown inside the phone frame
 * when the user clicks "Import from Splitwise" on the landing page.
 *
 * Extracted from CoconutMobileMarketingPage.tsx so it can be loaded with
 * next/dynamic and kept out of the initial JS bundle.
 */
import React from "react";
import { motion } from "motion/react";
import { ChevronLeft, Users, Hash, FileText, Check } from "lucide-react";
import { ThemeCtx } from "./theme-context";

// ─────────────────────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────────────────────
const SW_IMPORTED_FRIENDS: { name: string; initials: string; color: string; amount: number; dir: "owes_you"|"you_owe" }[] = [
  { name: "Alex Chen", initials: "AC", color: "#818CF8", amount: 86.00, dir: "owes_you" },
  { name: "Sam Rivera", initials: "SR", color: "#F472B6", amount: 32.50, dir: "you_owe" },
  { name: "Jordan Lee", initials: "JL", color: "#FACC15", amount: 45.00, dir: "owes_you" },
];
const SW_IMPORTED_GROUPS: { name: string; members: number; expenses: number; balance: number }[] = [
  { name: "Tahoe Trip 🏔️", members: 4, expenses: 8, balance: -24.00 },
  { name: "Apartment 🏠", members: 3, expenses: 14, balance: 112.50 },
  { name: "Concert crew 🎵", members: 5, expenses: 3, balance: -18.00 },
];
const SW_IMPORTED_EXPENSES: { name: string; amount: number; date: string; who: string }[] = [
  { name: "Nobu dinner", amount: 186.40, date: "Mar 28", who: "Alex" },
  { name: "Uber to SFO", amount: 42.00, date: "Mar 25", who: "Sam" },
  { name: "Airbnb", amount: 320.00, date: "Mar 22", who: "Group" },
  { name: "Groceries", amount: 67.50, date: "Mar 20", who: "Jordan" },
  { name: "Thai takeout", amount: 54.20, date: "Mar 15", who: "Alex" },
  { name: "Concert tickets", amount: 95.00, date: "Mar 12", who: "Group" },
];
const SW_TOTAL_EXPENSES = 23;

function wait(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function SplitwiseScreen({ onBack }: { onBack: () => void }) {
  const C = React.useContext(ThemeCtx);
  const [phase, setPhase] = React.useState<"connecting"|"friends"|"groups"|"expenses"|"done">("connecting");
  const [friendIdx, setFriendIdx] = React.useState(0);
  const [groupIdx, setGroupIdx] = React.useState(0);
  const [expenseIdx, setExpenseIdx] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await wait(1400);
      if (cancelled) return;
      setPhase("friends");
      for (let i = 1; i <= SW_IMPORTED_FRIENDS.length; i++) {
        await wait(400);
        if (cancelled) return;
        setFriendIdx(i);
      }
      await wait(500);
      if (cancelled) return;
      setPhase("groups");
      for (let i = 1; i <= SW_IMPORTED_GROUPS.length; i++) {
        await wait(400);
        if (cancelled) return;
        setGroupIdx(i);
      }
      await wait(500);
      if (cancelled) return;
      setPhase("expenses");
      for (let i = 1; i <= SW_IMPORTED_EXPENSES.length; i++) {
        await wait(300);
        if (cancelled) return;
        setExpenseIdx(i);
      }
      await wait(600);
      if (cancelled) return;
      setPhase("done");
    };
    run();
    return () => { cancelled = true; };
  }, []);

  const swGreen = "#1DB954";

  return (
    <div style={{ height:"100%", overflowY:"auto", background:C.bg, scrollbarWidth:"none" }}>
      {/* Header */}
      <div style={{ padding:"16px 20px 12px", display:"flex", alignItems:"center", gap:12 }}>
        <button
          onClick={onBack}
          style={{ border:"none", background:"none", cursor:"pointer", color:C.accent, padding:0, display:"flex", alignItems:"center" }}
        >
          <ChevronLeft size={22} strokeWidth={2.5} />
        </button>
        <p style={{ fontSize:20, letterSpacing:"-0.7px", margin:0 }}>
          <span style={{ fontWeight:900, color:C.label }}>Splitwise Import</span>
        </p>
      </div>

      <div style={{ padding:"0 16px", display:"flex", flexDirection:"column" }}>
        {/* Connecting phase */}
        {phase === "connecting" && (
          <motion.div
            initial={{ opacity:0 }}
            animate={{ opacity:1 }}
            style={{ textAlign:"center", paddingTop:48 }}
          >
            <motion.div
              animate={{ rotate:360 }}
              transition={{ duration:1, repeat:Infinity, ease:"linear" }}
              style={{ width:40, height:40, border:`3px solid ${C.stroke}`, borderTopColor:swGreen, borderRadius:"50%", margin:"0 auto 18px" }}
            />
            <p style={{ fontSize:15, fontWeight:700, color:C.label, letterSpacing:"-0.3px" }}>Connecting to Splitwise…</p>
            <p style={{ fontSize:12, color:C.label3, marginTop:6 }}>Syncing your friends, groups & expenses</p>
          </motion.div>
        )}

        {/* Content phases */}
        {phase !== "connecting" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12, paddingBottom:24 }}>
            {/* Success banner */}
            {phase === "done" && (
              <motion.div
                initial={{ opacity:0, scale:0.95 }}
                animate={{ opacity:1, scale:1 }}
                style={{
                  background:C.greenBg,
                  border:`1px solid ${C.greenMid}`,
                  borderRadius:C.radius,
                  padding:"14px 16px",
                  display:"flex",
                  alignItems:"center",
                  gap:10,
                }}
              >
                <div style={{ width:32, height:32, borderRadius:10, background:C.green, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <Check size={18} color="#fff" strokeWidth={2.5} />
                </div>
                <div>
                  <p style={{ fontSize:14, fontWeight:800, color:C.green, letterSpacing:"-0.2px" }}>All imported!</p>
                  <p style={{ fontSize:11, color:C.green, marginTop:1, opacity:0.8 }}>{SW_IMPORTED_FRIENDS.length} friends · {SW_IMPORTED_GROUPS.length} groups · {SW_TOTAL_EXPENSES} expenses</p>
                </div>
              </motion.div>
            )}

            {/* Friends section */}
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8, padding:"0 4px" }}>
                <Users size={13} color={C.label3} strokeWidth={2} />
                <span style={{ fontSize:11, fontWeight:700, color:C.label3, textTransform:"uppercase", letterSpacing:"0.06em" }}>Friends</span>
                {friendIdx > 0 && (
                  <motion.span initial={{ opacity:0 }} animate={{ opacity:1 }} style={{ fontSize:11, fontWeight:700, color:swGreen, marginLeft:"auto" }}>
                    {friendIdx}/{SW_IMPORTED_FRIENDS.length}
                  </motion.span>
                )}
              </div>
              <div style={{ background:C.card, border:`${C.borderW} solid ${C.stroke}`, borderRadius:C.radius, overflow:"hidden", boxShadow:C.shSm }}>
                {SW_IMPORTED_FRIENDS.slice(0, friendIdx).map((f, i) => (
                  <motion.div
                    key={f.name}
                    initial={{ opacity:0, x:-16 }}
                    animate={{ opacity:1, x:0 }}
                    transition={{ duration:0.25 }}
                    style={{
                      display:"flex", alignItems:"center", gap:12, padding:"12px 14px",
                      borderTop: i > 0 ? `1px solid ${C.stroke}` : "none",
                    }}
                  >
                    <div style={{ width:36, height:36, borderRadius:12, background:f.color+"20", border:`1.5px solid ${f.color}40`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      <span style={{ fontSize:12, fontWeight:800, color:f.color }}>{f.initials}</span>
                    </div>
                    <div style={{ flex:1 }}>
                      <p style={{ fontSize:13, fontWeight:700, color:C.label, letterSpacing:"-0.2px" }}>{f.name}</p>
                      <p style={{ fontSize:11, color:C.label3, marginTop:1 }}>{f.dir === "owes_you" ? "owes you" : "you owe"}</p>
                    </div>
                    <span style={{ fontSize:14, fontWeight:800, color: f.dir === "owes_you" ? C.green : C.red, letterSpacing:"-0.3px" }}>
                      {f.dir === "owes_you" ? "+" : "-"}${f.amount.toFixed(2)}
                    </span>
                  </motion.div>
                ))}
                {friendIdx === 0 && (
                  <div style={{ padding:"16px", textAlign:"center" }}>
                    <motion.div animate={{ opacity:[0.3,0.7,0.3] }} transition={{ duration:1.2, repeat:Infinity }} style={{ height:12, width:100, background:C.stroke, borderRadius:6, margin:"0 auto" }} />
                  </div>
                )}
              </div>
            </div>

            {/* Group section */}
            {(phase === "groups" || phase === "expenses" || phase === "done") && (
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8, padding:"0 4px" }}>
                  <Hash size={13} color={C.label3} strokeWidth={2} />
                  <span style={{ fontSize:11, fontWeight:700, color:C.label3, textTransform:"uppercase", letterSpacing:"0.06em" }}>Groups</span>
                  {groupIdx > 0 && (
                    <motion.span initial={{ opacity:0 }} animate={{ opacity:1 }} style={{ fontSize:11, fontWeight:700, color:swGreen, marginLeft:"auto" }}>
                      {groupIdx}/{SW_IMPORTED_GROUPS.length}
                    </motion.span>
                  )}
                </div>
                <div style={{ background:C.card, border:`${C.borderW} solid ${C.stroke}`, borderRadius:C.radius, overflow:"hidden", boxShadow:C.shSm }}>
                  {SW_IMPORTED_GROUPS.slice(0, groupIdx).map((g, i) => (
                    <motion.div
                      key={g.name}
                      initial={{ opacity:0, x:-16 }}
                      animate={{ opacity:1, x:0 }}
                      transition={{ duration:0.25 }}
                      style={{
                        display:"flex", alignItems:"center", gap:12, padding:"12px 14px",
                        borderTop: i > 0 ? `1px solid ${C.stroke}` : "none",
                      }}
                    >
                      <div style={{ width:36, height:36, borderRadius:12, background:C.accent+"15", border:`1px solid ${C.accent}30`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                        <Users size={15} color={C.accent} strokeWidth={2} />
                      </div>
                      <div style={{ flex:1 }}>
                        <p style={{ fontSize:13, fontWeight:700, color:C.label, letterSpacing:"-0.2px" }}>{g.name}</p>
                        <p style={{ fontSize:11, color:C.label3, marginTop:1 }}>{g.members} members · {g.expenses} expenses</p>
                      </div>
                      <span style={{ fontSize:13, fontWeight:800, color: g.balance >= 0 ? C.green : C.red, letterSpacing:"-0.3px" }}>
                        {g.balance >= 0 ? "+" : "-"}${Math.abs(g.balance).toFixed(2)}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Expenses section */}
            {(phase === "expenses" || phase === "done") && (
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8, padding:"0 4px" }}>
                  <FileText size={13} color={C.label3} strokeWidth={2} />
                  <span style={{ fontSize:11, fontWeight:700, color:C.label3, textTransform:"uppercase", letterSpacing:"0.06em" }}>Recent expenses</span>
                  {expenseIdx > 0 && (
                    <motion.span initial={{ opacity:0 }} animate={{ opacity:1 }} style={{ fontSize:11, fontWeight:700, color:swGreen, marginLeft:"auto" }}>
                      {expenseIdx >= SW_IMPORTED_EXPENSES.length ? SW_TOTAL_EXPENSES : expenseIdx}/{SW_TOTAL_EXPENSES}
                    </motion.span>
                  )}
                </div>
                <div style={{ background:C.card, border:`${C.borderW} solid ${C.stroke}`, borderRadius:C.radius, overflow:"hidden", boxShadow:C.shSm }}>
                  {SW_IMPORTED_EXPENSES.slice(0, expenseIdx).map((e, i) => (
                    <motion.div
                      key={e.name}
                      initial={{ opacity:0, x:-16 }}
                      animate={{ opacity:1, x:0 }}
                      transition={{ duration:0.25 }}
                      style={{
                        display:"flex", alignItems:"center", gap:12, padding:"11px 14px",
                        borderTop: i > 0 ? `1px solid ${C.stroke}` : "none",
                      }}
                    >
                      <div style={{ flex:1 }}>
                        <p style={{ fontSize:13, fontWeight:700, color:C.label, letterSpacing:"-0.2px" }}>{e.name}</p>
                        <p style={{ fontSize:11, color:C.label3, marginTop:1 }}>{e.date} · {e.who}</p>
                      </div>
                      <span style={{ fontSize:13, fontWeight:800, color:C.label, letterSpacing:"-0.3px" }}>${e.amount.toFixed(2)}</span>
                    </motion.div>
                  ))}
                  {expenseIdx >= SW_IMPORTED_EXPENSES.length && (
                    <motion.div
                      initial={{ opacity:0 }}
                      animate={{ opacity:1 }}
                      transition={{ delay:0.2 }}
                      style={{ padding:"10px 14px", borderTop:`1px solid ${C.stroke}`, textAlign:"center" }}
                    >
                      <p style={{ fontSize:12, fontWeight:600, color:C.label3 }}>+ {SW_TOTAL_EXPENSES - SW_IMPORTED_EXPENSES.length} more expenses imported</p>
                    </motion.div>
                  )}
                </div>
              </div>
            )}

            {/* Progress indicator */}
            {phase !== "done" && (
              <motion.p
                animate={{ opacity:[0.4, 1, 0.4] }}
                transition={{ duration:1.5, repeat:Infinity }}
                style={{ fontSize:12, color:C.label3, textAlign:"center", marginTop:4 }}
              >
                {phase === "friends" ? "Importing friends…" : phase === "groups" ? "Importing groups…" : "Importing expenses…"}
              </motion.p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
