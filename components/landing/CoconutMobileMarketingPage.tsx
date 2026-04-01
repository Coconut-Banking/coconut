"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Plus, X, Check, ChevronRight, ChevronLeft, Search,
  Nfc, Share2, Wallet, Clock, ArrowDownLeft,
  ArrowUpRight, Mail, Package, Lock, Unlock,
  Equal, Sliders, Hash, Landmark, ShieldCheck,
  Users, User, Camera, ScanLine, FileText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** Public asset — replaces Figma export in Coconut-MVP */
const COCONUT_LOGO_SRC = "/brand/coconut-mark.jpg";

// ─────────────────────────────────────��───────────────────────────────────────
// THEME SYSTEM — 12 distinct premium themes (5 light · 7 dark)
// ─────────────────────────────────────────────────────────────────────────────
interface Theme {
  name: string;
  isDark: boolean;
  bg: string; card: string; card2: string; card3: string;
  stroke: string; sep: string;
  green: string; greenBg: string; greenMid: string;
  red: string; redBg: string;
  accent: string; accentBg: string; accentSoft: string;
  amber: string; amberBg: string;
  blue: string; blueBg: string;
  purple: string;
  label: string; label2: string; label3: string;
  sh: string; shSm: string;
  radius: number; borderW: string; cardGlow: string;
  heroGrad: string;
}

const THEMES: Record<string, Theme> = {
  coconut_pure: {
    name: "Pure White", isDark: false,
    bg: "#ffffff", card: "#ffffff", card2: "#fcfcfc", card3: "#f5f5f5",
    stroke: "#e6e6e6", sep: "#f0f0f0",
    green: "#1e2021", greenBg: "#f5f5f5", greenMid: "#e6e6e6",
    red: "#494a4b", redBg: "#fcfcfc",
    accent: "#1e2021", accentBg: "#f0f0f0", accentSoft: "#e6e6e6",
    amber: "#1e2021", amberBg: "#f5f5f5",
    blue: "#1e2021", blueBg: "#fcfcfc",
    purple: "#1e2021",
    label: "#1e2021", label2: "#494a4b", label3: "#7a7d80",
    sh: "0 4px 20px rgba(30,32,33,0.06), 0 1px 4px rgba(30,32,33,0.04)",
    shSm: "0 1px 2px rgba(30,32,33,0.05), 0 2px 8px rgba(30,32,33,0.05)",
    radius: 24, borderW: "1px", cardGlow: "0 0 0 1px rgba(30,32,33,0.04)",
    heroGrad: "linear-gradient(135deg, #ffffff 0%, #fcfcfc 100%)",
  },
  coconut_semantic: {
    name: "Semantic White", isDark: false,
    bg: "#fcfcfc", card: "#ffffff", card2: "#fefefe", card3: "#f5f5f5",
    stroke: "#e6e6e6", sep: "#f0f0f0",
    green: "#3a7d44", greenBg: "#eef5f0", greenMid: "#dceade",
    red: "#c23934", redBg: "#fcedec",
    accent: "#1e2021", accentBg: "#f0f0f0", accentSoft: "#e6e6e6",
    amber: "#B45309", amberBg: "#FEF3C7",
    blue: "#1e2021", blueBg: "#fcfcfc",
    purple: "#1e2021",
    label: "#1e2021", label2: "#494a4b", label3: "#7a7d80",
    sh: "0 4px 20px rgba(30,32,33,0.06), 0 1px 4px rgba(30,32,33,0.04)",
    shSm: "0 1px 2px rgba(30,32,33,0.05), 0 2px 8px rgba(30,32,33,0.05)",
    radius: 20, borderW: "1px", cardGlow: "0 0 0 1px rgba(30,32,33,0.04)",
    heroGrad: "linear-gradient(135deg, #ffffff 0%, #fefefe 100%)",
  },
  coconut_dark: {
    name: "Eerie Dark", isDark: true,
    bg: "#1e2021", card: "#2a2d2e", card2: "#333638", card3: "#494a4b",
    stroke: "#494a4b", sep: "#333638",
    green: "#4ade80", greenBg: "#142218", greenMid: "#1a3320",
    red: "#f87171", redBg: "#2d1414",
    accent: "#ffffff", accentBg: "#494a4b", accentSoft: "#333638",
    amber: "#F59E0B", amberBg: "#2A1E08",
    blue: "#60A5FA", blueBg: "#0F1D30",
    purple: "#A78BFA",
    label: "#ffffff", label2: "#fcfcfc", label3: "#7a7d80",
    sh: "0 4px 20px rgba(0,0,0,0.4), 0 1px 4px rgba(0,0,0,0.3)",
    shSm: "0 1px 2px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.2)",
    radius: 20, borderW: "1px", cardGlow: "0 0 0 1px rgba(255,255,255,0.05)",
    heroGrad: "linear-gradient(135deg, #2a2d2e 0%, #1e2021 100%)",
  },
  coconut_cashmere: {
    name: "Cashmere", isDark: false,
    bg: "#f8f5f2", card: "#ffffff", card2: "#fdfdfb", card3: "#f0ebe6",
    stroke: "#e8e1da", sep: "#f2ede8",
    /** Money semantics match Semantic White — clear green / red on warm Cashmere chrome */
    green: "#3a7d44", greenBg: "#eef5f0", greenMid: "#dceade",
    red: "#c23934", redBg: "#fcedec",
    accent: "#2b2a29", accentBg: "#f0ebe6", accentSoft: "#e8e1da",
    amber: "#B45309", amberBg: "#FEF3C7",
    blue: "#1D4ED8", blueBg: "#DBEAFE",
    purple: "#2b2a29",
    label: "#2b2a29", label2: "#4a4846", label3: "#8a8682",
    sh: "0 4px 24px rgba(43,42,41,0.05), 0 1px 4px rgba(43,42,41,0.03)",
    shSm: "0 1px 2px rgba(43,42,41,0.04), 0 2px 8px rgba(43,42,41,0.04)",
    radius: 20, borderW: "1px", cardGlow: "0 0 0 1px rgba(43,42,41,0.03)",
    heroGrad: "linear-gradient(135deg, #ffffff 0%, #fdfdfb 100%)",
  }
};

export type ThemeKey = keyof typeof THEMES;
const ThemeCtx = React.createContext<Theme>(THEMES.coconut_cashmere);

// ─────────────────────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────────────────────
type PersonId = "you"|"alex"|"sam"|"jordan"|"maya"|"ryan"|"emma"|"kate"|"david"|"zoe"|"liam";

interface Contact {
  id: PersonId; name: string; full: string; initials: string;
  color: string; email: string; phone?: string;
  /** Demo profile photo (see `public/brand/demo-avatars/README.md`) */
  photoSrc: string;
}
const CONTACTS: Contact[] = [
  { id:"you",    name:"You",    full:"You (paid)",    initials:"JD", color:"#16A34A", email:"you@email.com",    photoSrc:"/brand/demo-avatars/you.jpg" },
  { id:"alex",   name:"Alex",   full:"Alex Chen",     initials:"AC", color:"#818CF8", email:"alex@gmail.com",  phone:"(415) 555-0101", photoSrc:"/brand/demo-avatars/alex.jpg" },
  { id:"sam",    name:"Sam",    full:"Sam Rivera",    initials:"SR", color:"#F472B6", email:"sam@gmail.com",   phone:"(415) 555-0102", photoSrc:"/brand/demo-avatars/sam.jpg" },
  { id:"jordan", name:"Jordan", full:"Jordan Park",   initials:"JP", color:"#FBBF24", email:"jordan@me.com",   phone:"(415) 555-0103", photoSrc:"/brand/demo-avatars/jordan.jpg" },
  { id:"maya",   name:"Maya",   full:"Maya Lin",      initials:"ML", color:"#38BDF8", email:"maya@gmail.com",  phone:"(415) 555-0104", photoSrc:"/brand/demo-avatars/maya.jpg" },
  { id:"ryan",   name:"Ryan",   full:"Ryan Torres",   initials:"RT", color:"#34D399", email:"ryan@gmail.com",  phone:"(415) 555-0105", photoSrc:"/brand/demo-avatars/ryan.jpg" },
  { id:"emma",   name:"Emma",   full:"Emma Watson",   initials:"EW", color:"#F9A8D4", email:"emma@icloud.com", phone:"(415) 555-0106", photoSrc:"/brand/demo-avatars/emma.jpg" },
  { id:"kate",   name:"Kate",   full:"Kate Johnson",  initials:"KJ", color:"#FCA5A5", email:"kate@gmail.com",  phone:"(415) 555-0107", photoSrc:"/brand/demo-avatars/kate.jpg" },
  { id:"david",  name:"David",  full:"David Kim",     initials:"DK", color:"#6EE7B7", email:"david@me.com",    phone:"(415) 555-0108", photoSrc:"/brand/demo-avatars/david.jpg" },
  { id:"zoe",    name:"Zoe",    full:"Zoe Martinez",  initials:"ZM", color:"#C4B5FD", email:"zoe@gmail.com",   phone:"(415) 555-0109", photoSrc:"/brand/demo-avatars/zoe.jpg" },
  { id:"liam",   name:"Liam",   full:"Liam Scott",    initials:"LS", color:"#93C5FD", email:"liam@gmail.com",  phone:"(415) 555-0110", photoSrc:"/brand/demo-avatars/liam.jpg" },
];
const getContact = (id: PersonId) => CONTACTS.find(c => c.id === id)!;

/** SVG logos in /public/brand/merchants — see README there for Simple Icons attribution */
type MerchantLogoKey =
  | "whole_foods"
  | "uber"
  | "uber_eats"
  | "amazon"
  | "lyft"
  | "airbnb"
  | "starbucks"
  | "delta"
  | "nobu"
  | "default";

const MERCHANT_LOGO_BASENAME: Record<MerchantLogoKey, string> = {
  whole_foods: "wholefoods",
  uber: "uber",
  uber_eats: "ubereats",
  amazon: "amazon",
  lyft: "lyft",
  airbnb: "airbnb",
  starbucks: "starbucks",
  delta: "delta",
  nobu: "nobu",
  default: "default",
};

function MerchantLogo({ brand, size = 24 }: { brand: MerchantLogoKey; size?: number }) {
  const base = MERCHANT_LOGO_BASENAME[brand] ?? "default";
  return (
    <img
      src={`/brand/merchants/${base}.svg`}
      alt=""
      width={size}
      height={size}
      draggable={false}
      style={{ objectFit: "contain", display: "block", flexShrink: 0 }}
    />
  );
}

interface FriendBalance {
  personId: PersonId; amount: number; dir: "owes_you"|"you_owe";
  expenses: { id:string; label:string; amount:number; date:string; logo: MerchantLogoKey }[];
}
const FRIENDS: FriendBalance[] = [
  { personId:"alex",   amount:86.00, dir:"owes_you", expenses:[
    { id:"e1", label:"Nobu Restaurant", amount:62.00, date:"Mar 20", logo:"nobu" },
    { id:"e2", label:"Airbnb, Tahoe",  amount:24.00, date:"Mar 15", logo:"airbnb" },
  ]},
  { personId:"sam",    amount:53.33, dir:"you_owe",  expenses:[
    { id:"e3", label:"Delta Airlines",  amount:53.33, date:"Mar 14", logo:"delta" },
  ]},
  { personId:"jordan", amount:20.00, dir:"owes_you", expenses:[
    { id:"e4", label:"Ski Rentals",     amount:20.00, date:"Mar 16", logo:"default" },
  ]},
];

type EmailMeta =
  | { kind:"ride";  time:string; from:string; to:string; duration:string; distance:string; driver:string }
  | { kind:"food";  restaurant:string; deliveredTo:string; items:string[]; deliveredAt:string }
  | { kind:"order"; items:string[]; deliveryDate:string };

interface BankTx {
  id:string; merchant:string; logo: MerchantLogoKey; amount:number; date:string;
  hint:string; unsplit:boolean; email?: EmailMeta; suggestedPeople?: PersonId[];
}
const ALL_BANK_TX: BankTx[] = [
  { id:"b1", merchant:"Whole Foods",     logo:"whole_foods", amount:84.20,  date:"Mar 21", hint:"Group groceries?",      unsplit:true },
  { id:"b2", merchant:"Uber",            logo:"uber", amount:31.75,  date:"Mar 20", hint:"Split with Alex, Sam?", unsplit:true,
    suggestedPeople:["alex","sam"],
    email:{ kind:"ride", time:"11:48 PM", from:"Nobu Restaurant, Hayes St", to:"Mission Dist, 18th & Valencia", duration:"22 min", distance:"4.2 mi", driver:"Carlos M. · ⭐ 4.93" } },
  { id:"b3", merchant:"Uber Eats",       logo:"uber_eats", amount:54.90,  date:"Mar 21", hint:"Split with Sam, Maya?", unsplit:true,
    suggestedPeople:["sam","maya"],
    email:{ kind:"food", restaurant:"Hana Japanese Kitchen", deliveredTo:"2847 Mission St", items:["Spicy Ramen ×2","Vegetable Gyoza","Matcha Latte ×2"], deliveredAt:"Delivered 8:14 PM" } },
  { id:"b4", merchant:"Amazon",          logo:"amazon", amount:67.20,  date:"Mar 18", hint:"Split with Jordan?",    unsplit:true,
    suggestedPeople:["jordan"],
    email:{ kind:"order", items:["USB-C Hub (7-in-1)","Phone Stand, Adjustable","Lightning Cable 6ft ×2"], deliveryDate:"Arrived Mar 20" } },
  { id:"b5", merchant:"Lyft",            logo:"lyft", amount:18.50,  date:"Mar 22", hint:"Split with Alex?",      unsplit:true,
    suggestedPeople:["alex"],
    email:{ kind:"ride", time:"9:14 PM", from:"Haight-Ashbury, Haight St", to:"SFO Terminal 2", duration:"38 min", distance:"14.2 mi", driver:"Priya S. · ⭐ 4.88" } },
  { id:"b6", merchant:"Airbnb, Austin", logo:"airbnb", amount:680.00, date:"Mar 19", hint:"Shared accommodation?", unsplit:true },
  { id:"b7", merchant:"Nobu Restaurant", logo:"nobu", amount:248.00, date:"Mar 20", hint:"Split with Alex",        unsplit:false },
  { id:"b8", merchant:"Delta Airlines",  logo:"delta", amount:320.00, date:"Mar 14", hint:"Split with Sam",         unsplit:false },
  { id:"b9", merchant:"Airbnb, Tahoe",  logo:"airbnb", amount:520.00, date:"Mar 15", hint:"Split with Alex",        unsplit:false },
  { id:"b10",merchant:"Starbucks",       logo:"starbucks", amount:12.80,  date:"Mar 23", hint:"Personal",               unsplit:false },
];

type ActivityItem = {
  id:string; type:"settled"|"split_added"|"forgotten";
  personId:PersonId; merchant?:string; amount:number; date:string; method?:string; daysAgo?:number;
};
const ACTIVITY: ActivityItem[] = [
  { id:"a1", type:"settled",     personId:"maya",   amount:45.00,  date:"Today",     method:"Tap to Pay" },
  { id:"a2", type:"split_added", personId:"alex",   merchant:"Nobu Restaurant", amount:248.00, date:"Yesterday" },
  { id:"a3", type:"forgotten",   personId:"jordan", merchant:"Uchi Austin",     amount:134.50, date:"Mar 18", daysAgo:5 },
  { id:"a4", type:"split_added", personId:"sam",    merchant:"Delta Airlines",  amount:320.00, date:"Mar 14" },
];

function emailSnippet(e: EmailMeta): string {
  if (e.kind === "ride")  return `${e.time} · ${e.from.split(",")[0]} → ${e.to.split(",")[0]}`;
  if (e.kind === "food")  return `${e.restaurant} · ${e.deliveredTo}`;
  if (e.kind === "order") return `${e.items.length} items · ${e.deliveryDate}`;
  return "";
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────
/** Profile photo when `photoSrc` loads; otherwise tinted initials (demo avatars in `public/brand/demo-avatars/`) */
function PersonFace({ id, size, border }: { id: PersonId; size: number; border?: string }) {
  const c = getContact(id);
  const [imgErr, setImgErr] = useState(false);
  useEffect(() => {
    setImgErr(false);
  }, [id, c.photoSrc]);
  const r = size / 2;
  const defaultBorder = border ?? `1.5px solid ${c.color}38`;

  if (c.photoSrc && !imgErr) {
    return (
      <img
        src={c.photoSrc}
        alt=""
        onError={() => setImgErr(true)}
        style={{
          width: size,
          height: size,
          borderRadius: r,
          objectFit: "cover",
          flexShrink: 0,
          border: defaultBorder,
          display: "block",
          boxSizing: "border-box",
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: r,
        flexShrink: 0,
        background: c.color + "22",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.max(7, size * 0.32),
        fontWeight: 700,
        color: c.color,
        border: border ?? `1.5px solid ${c.color}30`,
        boxSizing: "border-box",
      }}
    >
      {c.initials}
    </div>
  );
}

function Avatar({ id, size = 38 }: { id: PersonId; size?: number }) {
  return <PersonFace id={id} size={size} />;
}

function Chip({ id, onRemove }: { id: PersonId; onRemove?: () => void }) {
  const c = getContact(id);
  return (
    <div style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 10px 5px 6px", borderRadius:20, background:c.color+"20", border:`1px solid ${c.color}38`, flexShrink:0 }}>
      <PersonFace id={id} size={20} border={`1px solid ${c.color}45`} />
      <span style={{ fontSize:13, fontWeight:600, color:c.color }}>{c.name}</span>
      {onRemove && <button onClick={onRemove} style={{ border:"none", background:"none", cursor:"pointer", padding:0, display:"flex", color:c.color, opacity:0.5 }}><X size={11} /></button>}
    </div>
  );
}

function Card({ children, style, onClick }: { children: React.ReactNode; style?: React.CSSProperties; onClick?: () => void }) {
  const C = React.useContext(ThemeCtx);
  return (
    <div onClick={onClick} style={{
      background: C.card,
      borderRadius: C.radius + 4,
      border: `${C.borderW} solid ${C.stroke}`,
      boxShadow: `${C.sh}, 0 0 0 1px rgba(0,0,0,0.10)`,
      overflow: "hidden",
      ...style,
    }}>
      {children}
    </div>
  );
}

function Sep({ ml = 16 }: { ml?: number }) {
  const C = React.useContext(ThemeCtx);
  return <div style={{ height: 1, background: C.sep, marginLeft: ml }} />;
}

function Handle() {
  const C = React.useContext(ThemeCtx);
  return (
    <div style={{ display:"flex", justifyContent:"center", padding:"10px 0 8px" }}>
      <div style={{ width:32, height:4, borderRadius:2, background: C.isDark ? C.sep : C.stroke }} />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  const C = React.useContext(ThemeCtx);
  return (
    <p style={{ fontSize:11, fontWeight:700, color:C.label3, textTransform:"uppercase", letterSpacing:"0.10em", marginBottom:10 }}>
      {children}
    </p>
  );
}

function PrimaryBtn({ children, onClick, style, disabled }: { children: React.ReactNode; onClick?: () => void; style?: React.CSSProperties; disabled?: boolean }) {
  const C = React.useContext(ThemeCtx);
  return (
    <motion.button
      whileTap={disabled ? {} : { scale: 0.97 }}
      onClick={disabled ? undefined : onClick}
      style={{
        width: "100%", padding: "15px 0",
        borderRadius: C.radius + 2,
        border: "none",
        background: disabled ? C.card3 : C.accent,
        color: disabled ? C.label3 : C.isDark ? C.bg : "#FFFFFF",
        fontSize: 15, fontWeight: 800, cursor: disabled ? "default" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        boxShadow: disabled ? "none" : `0 4px 20px ${C.accent}50`,
        letterSpacing: "-0.1px", opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </motion.button>
  );
}

function GhostBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  const C = React.useContext(ThemeCtx);
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      style={{
        width: "100%", padding: "14px 0",
        borderRadius: C.radius + 2,
        border: `${C.borderW} solid ${C.stroke}`,
        background: "transparent",
        color: C.label3, fontSize: 15, fontWeight: 600, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      }}
    >
      {children}
    </motion.button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TX DETAIL SHEET
// ─────────────────────────────────────────────────────────────────────────────
function TxDetailSheet({ tx, onClose, onSplit }: { tx: BankTx; onClose: () => void; onSplit: () => void }) {
  const C = React.useContext(ThemeCtx);
  const e = tx.email;
  return (
    <>
      <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} onClick={onClose}
        style={{ position:"absolute", inset:0, zIndex:60, background:"rgba(0,0,0,0.5)", backdropFilter:"blur(8px)" }} />
      <motion.div initial={{ y:"100%" }} animate={{ y:0 }} exit={{ y:"100%" }} transition={{ type:"spring", damping:30, stiffness:280 }}
        style={{ position:"absolute", bottom:0, left:0, right:0, zIndex:70, background:C.card, borderRadius:`${C.radius + 10}px ${C.radius + 10}px 0 0`, border:`${C.borderW} solid ${C.stroke}`, boxShadow:"0 -12px 60px rgba(0,0,0,0.4)" }}>
        <Handle />
        <div style={{ padding:"4px 20px 32px" }}>
          {/* Header row */}
          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:20 }}>
            <div style={{ width:52, height:52, borderRadius:C.radius + 2, background:C.card2, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, border:`${C.borderW} solid ${C.stroke}` }}>
              <MerchantLogo brand={tx.logo} size={30} />
            </div>
            <div style={{ flex:1 }}>
              <p style={{ fontSize:17, fontWeight:800, color:C.label, letterSpacing:"-0.3px" }}>{tx.merchant}</p>
              <p style={{ fontSize:12, color:C.label3, marginTop:2 }}>{tx.date}</p>
            </div>
            <p style={{ fontSize:26, fontWeight:900, color:C.label, letterSpacing:"-1px", fontVariantNumeric:"tabular-nums" }}>${tx.amount.toFixed(2)}</p>
          </div>

          {/* Email receipt */}
          {e && (
            <div style={{ marginBottom:18 }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:10 }}>
                <div style={{ width:16, height:16, borderRadius:4, background:C.blue+"22", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <Mail size={9} color={C.blue} />
                </div>
                <p style={{ fontSize:10, fontWeight:700, color:C.blue, textTransform:"uppercase", letterSpacing:"0.08em" }}>Matched from email receipt</p>
              </div>
              <div style={{ background:C.card2, borderRadius:C.radius + 2, padding:"14px 16px", border:`${C.borderW} solid ${C.stroke}` }}>
                {e.kind === "ride" && (
                  <>
                    <p style={{ fontSize:11, color:C.label3, marginBottom:12 }}>{e.time} · {e.duration} · {e.distance}</p>
                    <div style={{ display:"flex", gap:12 }}>
                      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, paddingTop:3 }}>
                        <div style={{ width:7, height:7, borderRadius:4, background:C.green }} />
                        <div style={{ width:1, flex:1, background:C.stroke, minHeight:20 }} />
                        <div style={{ width:7, height:7, borderRadius:2, background:C.accent }} />
                      </div>
                      <div style={{ flex:1 }}>
                        <p style={{ fontSize:13, fontWeight:600, color:C.label, marginBottom:18 }}>{e.from}</p>
                        <p style={{ fontSize:13, fontWeight:600, color:C.label }}>{e.to}</p>
                      </div>
                    </div>
                    <p style={{ fontSize:11, color:C.label3, marginTop:10 }}>{e.driver}</p>
                  </>
                )}
                {e.kind === "food" && (
                  <>
                    <p style={{ fontSize:14, fontWeight:700, color:C.label, marginBottom:4 }}>{e.restaurant}</p>
                    <p style={{ fontSize:11, color:C.label3, marginBottom:12 }}>{e.deliveredAt} · {e.deliveredTo}</p>
                    <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                      {e.items.map((item, i) => (
                        <div key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <div style={{ width:3, height:3, borderRadius:2, background:C.label3, flexShrink:0 }} />
                          <p style={{ fontSize:13, color:C.label2 }}>{item}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {e.kind === "order" && (
                  <>
                    <p style={{ fontSize:11, fontWeight:700, color:C.accent, marginBottom:10 }}>{e.deliveryDate}</p>
                    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                      {e.items.map((item, i) => (
                        <div key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <Package size={11} color={C.label3} style={{ flexShrink:0 }} />
                          <p style={{ fontSize:13, color:C.label2 }}>{item}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {tx.suggestedPeople && tx.suggestedPeople.length > 0 && (
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
              <p style={{ fontSize:12, color:C.label3 }}>Suggested:</p>
              {tx.suggestedPeople.map(id => <Chip key={id} id={id} />)}
            </div>
          )}

          {tx.unsplit
            ? <PrimaryBtn onClick={() => { onSplit(); onClose(); }}><Plus size={15} strokeWidth={2.5} /> Split this charge</PrimaryBtn>
            : <div style={{ padding:"14px 0", textAlign:"center" }}><p style={{ fontSize:14, color:C.label3 }}>Already split ✓</p></div>
          }
        </div>
      </motion.div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTLE SHEET
// ─────────────────────────────────────────────────────────────────────────────
function SettleSheet({ personId, amount, onClose, onSettled }: { personId: PersonId; amount: number; onClose: () => void; onSettled: () => void }) {
  const C = React.useContext(ThemeCtx);
  const [step, setStep] = useState<"pick"|"nfc"|"done">("pick");
  const [nfcConn, setNfcConn] = useState(false);
  const c = getContact(personId);

  const handleTap = () => {
    setStep("nfc");
    setTimeout(() => setNfcConn(true), 1900);
    setTimeout(() => setStep("done"), 3300);
  };

  return (
    <>
      <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} onClick={onClose}
        style={{ position:"absolute", inset:0, zIndex:40, background:"rgba(0,0,0,0.55)", backdropFilter:"blur(10px)" }} />
      <motion.div initial={{ y:"100%" }} animate={{ y:0 }} exit={{ y:"100%" }} transition={{ type:"spring", damping:30, stiffness:280 }}
        style={{ position:"absolute", bottom:0, left:0, right:0, zIndex:50, background:C.card, borderRadius:`${C.radius + 10}px ${C.radius + 10}px 0 0`, border:`${C.borderW} solid ${C.stroke}`, boxShadow:"0 -12px 60px rgba(0,0,0,0.4)" }}>
        <Handle />
        <AnimatePresence mode="wait">
          {step === "pick" && (
            <motion.div key="pick" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} style={{ padding:"4px 20px 32px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:24 }}>
                <Avatar id={personId} size={50} />
                <div style={{ flex:1 }}>
                  <p style={{ fontSize:12, color:C.label3, marginBottom:2 }}>Settle with</p>
                  <p style={{ fontSize:19, fontWeight:800, color:C.label, letterSpacing:"-0.4px" }}>{c.full}</p>
                </div>
                <p style={{ fontSize:30, fontWeight:900, color:C.label, letterSpacing:"-1.5px", fontVariantNumeric:"tabular-nums" }}>${amount.toFixed(2)}</p>
              </div>

              {/* Tap to Pay — hero option */}
              <motion.button whileTap={{ scale:0.98 }} onClick={handleTap} style={{ width:"100%", border:"none", background:C.accent, borderRadius:C.radius + 4, padding:"16px 18px", display:"flex", alignItems:"center", gap:14, cursor:"pointer", boxShadow:`0 8px 28px ${C.accent}55`, marginBottom:10 }}>
                <div style={{ width:46, height:46, borderRadius:C.radius, background:"rgba(0,0,0,0.15)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <Nfc size={22} color={C.isDark ? C.bg : "#FFFFFF"} />
                </div>
                <div style={{ textAlign:"left", flex:1 }}>
                  <p style={{ fontSize:15, fontWeight:800, color:C.isDark ? C.bg : "#FFFFFF" }}>Tap to Pay</p>
                  <p style={{ fontSize:12, color:`${C.isDark ? C.bg : "#FFFFFF"}99` }}>Hold phones together · instant</p>
                </div>
                <span style={{ background:"rgba(0,0,0,0.15)", padding:"5px 11px", borderRadius:20, fontSize:11, fontWeight:800, color:C.isDark ? C.bg : "#FFFFFF" }}>Instant</span>
              </motion.button>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
                {[{ l:"Venmo", bg:"#0070BA" }, { l:"PayPal", bg:"#003087" }].map(({ l, bg }) => (
                  <motion.button key={l} whileTap={{ scale:0.97 }} onClick={onSettled} style={{ border:"none", background:bg, borderRadius:C.radius, padding:"14px 0", fontSize:14, fontWeight:700, color:"white", cursor:"pointer" }}>{l}</motion.button>
                ))}
              </div>
              <GhostBtn onClick={onSettled}>Add to tab</GhostBtn>
            </motion.div>
          )}

          {step === "nfc" && (
            <motion.div key="nfc" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} style={{ padding:"24px 20px 40px", display:"flex", flexDirection:"column", alignItems:"center" }}>
              <p style={{ fontSize:18, fontWeight:800, color:C.label, marginBottom:4, letterSpacing:"-0.3px" }}>Hold near {c.name}&apos;s phone</p>
              <p style={{ fontSize:13, color:C.label3, marginBottom:32 }}>Keep within 2 inches</p>
              <div style={{ position:"relative", width:130, height:130, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:24 }}>
                {[0,1,2,3].map(i => (
                  <motion.div key={i} style={{ position:"absolute", borderRadius:"50%", border:`1.5px solid ${nfcConn ? C.accent : C.stroke}`, width:38+i*24, height:38+i*24, transition:"border-color 0.4s" }}
                    animate={{ scale:[1,1.06,1], opacity:[0.5,1,0.5] }} transition={{ duration:nfcConn?0.5:2.2, repeat:Infinity, delay:i*0.3 }} />
                ))}
                {[0,1,2].map(i => (
                  <motion.div key={`r${i}`} style={{ position:"absolute", borderRadius:"50%", border:`1px solid ${C.accent}50`, width:38, height:38 }}
                    animate={{ scale:[1,3.8], opacity:[0.7,0] }} transition={{ duration:2.2, repeat:Infinity, delay:i*0.7, ease:"easeOut" }} />
                ))}
                <div style={{ width:56, height:56, borderRadius:28, background:C.accent, display:"flex", alignItems:"center", justifyContent:"center", zIndex:2, boxShadow:`0 0 36px ${C.accent}70` }}>
                  {/* No brightness(0): that turned the whole mark black on green and looked like an empty square */}
                  <div style={{ width:40, height:40, borderRadius:11, background:"#fff", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 8px rgba(0,0,0,0.12)" }}>
                    <img src={COCONUT_LOGO_SRC} alt="" style={{ width:26, height:26, borderRadius:6, objectFit:"cover" }} />
                  </div>
                </div>
              </div>
              <p style={{ fontSize:15, fontWeight:700, color:nfcConn ? C.accent : C.label, transition:"color 0.4s" }}>{nfcConn ? "Connected! Confirming…" : "Searching…"}</p>
            </motion.div>
          )}

          {step === "done" && (
            <motion.div key="done" initial={{ scale:0.85, opacity:0 }} animate={{ scale:1, opacity:1 }} style={{ padding:"28px 20px 40px", display:"flex", flexDirection:"column", alignItems:"center" }}>
              <motion.div animate={{ scale:[1,1.12,1] }} transition={{ duration:0.4 }}
                style={{ width:76, height:76, borderRadius:38, background:C.accentBg, border:`1px solid ${C.accent}40`, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:20 }}>
                <Check size={36} color={C.accent} strokeWidth={2.5} />
              </motion.div>
              <p style={{ fontSize:24, fontWeight:900, color:C.label, marginBottom:4, letterSpacing:"-0.5px" }}>All settled!</p>
              <p style={{ fontSize:14, color:C.label3, marginBottom:28 }}>${amount.toFixed(2)} with {c.name}</p>
              <button onClick={onSettled} style={{ width:"100%", border:"none", background:C.accentBg, borderRadius:C.radius + 2, padding:"15px 0", fontSize:15, fontWeight:800, color:C.accent, cursor:"pointer" }}>Done</button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD EXPENSE FLOW
// ─────────────────────────────────────────────────────────────────────────────
function AmountStep({ onNext, prefill }: { onNext: (amount: number, description: string, paidBy: PersonId) => void; prefill?: { merchant: string; amount: number } }) {
  const C = React.useContext(ThemeCtx);
  const [raw, setRaw] = useState(prefill ? String(prefill.amount) : "");
  const [desc, setDesc] = useState(prefill?.merchant ?? "");
  const [paidBy, setPaidBy] = useState<PersonId>("you");
  const amount = parseFloat(raw) || 0;

  useEffect(() => {
    if (prefill) {
      setRaw(String(prefill.amount));
      setDesc(prefill.merchant);
    }
  }, [prefill?.amount, prefill?.merchant]);

  const handleKey = (k: string) => {
    if (k === "⌫") { setRaw(r => r.slice(0, -1)); return; }
    if (k === "." && raw.includes(".")) return;
    if (raw.includes(".") && raw.split(".")[1]?.length >= 2) return;
    if (k !== "." && raw === "0") { setRaw(k); return; }
    setRaw(r => r + k);
  };
  const keys = ["1","2","3","4","5","6","7","8","9",".","0","⌫"];

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", padding:"0 20px 34px" }}>
      {/* What + amount: title and total feel like peers, not a giant number with a footnote */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"stretch", justifyContent:"center", paddingBottom:8, gap:20 }}>
        <div style={{ width:"100%" }}>
          <p style={{ fontSize:11, fontWeight:700, color:C.label3, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:8 }}>What is it?</p>
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Uber, dinner, rent…"
            style={{
              width:"100%",
              boxSizing:"border-box",
              padding:"14px 16px",
              borderRadius:C.radius + 4,
              border:`${C.borderW} solid ${C.stroke}`,
              background:C.card2,
              outline:"none",
              fontSize:20,
              fontWeight:700,
              color:desc ? C.label : C.label3,
              letterSpacing:"-0.02em",
              textAlign:"center",
            }}
          />
        </div>
        <div style={{ width:"100%", display:"flex", flexDirection:"column", alignItems:"center" }}>
          <p style={{ fontSize:11, fontWeight:700, color:C.label3, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Amount</p>
          <div style={{ display:"flex", alignItems:"flex-start", gap:5, justifyContent:"center" }}>
            <span style={{ fontSize:22, fontWeight:700, color:C.label3, marginTop:6, lineHeight:1 }}>$</span>
            <span
              style={{
                fontSize:46,
                fontWeight:800,
                color: amount > 0 ? C.accent : C.label3,
                letterSpacing:"-2px",
                lineHeight:1,
                minWidth:56,
                textAlign:"center",
                fontVariantNumeric:"tabular-nums",
                transition:"color 0.2s",
              }}
            >
              {amount > 0 ? (raw.includes(".") ? raw : raw || "0") : "0"}
            </span>
          </div>
        </div>
      </div>

      {/* Paid by */}
      <div style={{ marginBottom:14 }}>
        <p style={{ fontSize:11, fontWeight:700, color:C.label3, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:8 }}>Paid by</p>
        <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:4, scrollbarWidth:"none" }}>
          {(["you","alex","sam","jordan","maya"] as PersonId[]).map(id => {
            const c = getContact(id); const sel = paidBy === id;
            return (
              <button key={id} onClick={() => setPaidBy(id)} style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 13px 7px 8px", borderRadius:20, border:`1.5px solid ${sel ? c.color + "60" : C.stroke}`, background: sel ? c.color + "18" : "transparent", cursor:"pointer", flexShrink:0, transition:"all 0.15s" }}>
                <PersonFace id={id} size={20} border={`1px solid ${c.color}40`} />
                <span style={{ fontSize:13, fontWeight:sel?700:500, color:sel?c.color:C.label3 }}>{c.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Keypad */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:8, marginBottom:14 }}>
        {keys.map(k => (
          <motion.button key={k} whileTap={{ scale:0.88 }} onClick={() => handleKey(k)}
            style={{ height:56, borderRadius:C.radius, border:`${C.borderW} solid ${C.stroke}`, background: k === "⌫" ? C.card2 : C.card3, color:C.label, fontSize: k === "⌫" ? 18 : 23, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
            {k}
          </motion.button>
        ))}
      </div>
      <PrimaryBtn onClick={() => amount > 0 && onNext(amount, desc || "Expense", paidBy)} disabled={amount === 0}>Review Split →</PrimaryBtn>
    </div>
  );
}

type ReceiptLine = { id: string; name: string; qty: number; unit: number };

function buildDemoReceiptLines(hit: { merchant: string; amount: number }): ReceiptLine[] {
  const t = hit.amount;
  if (hit.merchant.includes("Nobu") && Math.abs(t - 248) < 0.01) {
    return [
      { id: "1", name: "Spicy tuna roll", qty: 2, unit: 14 },
      { id: "2", name: "Yellowtail sashimi", qty: 1, unit: 24 },
      { id: "3", name: "Chef omakase", qty: 1, unit: 150 },
      { id: "4", name: "Sake (carafe)", qty: 1, unit: 46 },
    ];
  }
  const each = Math.round((t / 4) * 100) / 100;
  return [1, 2, 3, 4].map((i) => ({ id: String(i), name: `Line item ${i}`, qty: 1, unit: each }));
}

/** Same choices as coconut-app FAB: Add expense vs Scan receipt */
function AddOptionsSheet({
  onClose,
  onAddExpense,
  onScanReceipt,
}: {
  onClose: () => void;
  onAddExpense: () => void;
  onScanReceipt: () => void;
}) {
  const C = React.useContext(ThemeCtx);
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ position: "absolute", inset: 0, zIndex: 54, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)" }}
      />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ type: "spring", damping: 28, stiffness: 320 }}
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          bottom: 96,
          zIndex: 55,
          maxWidth: 340,
          margin: "0 auto",
          background: C.card,
          borderRadius: C.radius + 8,
          border: `${C.borderW} solid ${C.stroke}`,
          boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
          padding: "6px 0 8px",
        }}
      >
        <p style={{ fontSize: 13, fontWeight: 800, color: C.label3, padding: "10px 18px 6px", letterSpacing: "0.04em", textTransform: "uppercase" }}>Add</p>
        <button
          type="button"
          onClick={onAddExpense}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 18px",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <FileText size={20} color={C.accent} strokeWidth={2} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: C.label }}>Add expense</p>
            <p style={{ fontSize: 12, color: C.label3, marginTop: 2 }}>Split manually with people</p>
          </div>
          <ChevronRight size={18} color={C.label3} />
        </button>
        <div style={{ height: 1, background: C.stroke, margin: "0 16px" }} />
        <button
          type="button"
          onClick={onScanReceipt}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 18px",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <ScanLine size={20} color={C.accent} strokeWidth={2} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: C.label }}>Scan receipt</p>
            <p style={{ fontSize: 12, color: C.label3, marginTop: 2 }}>Parse items, then assign</p>
          </div>
          <ChevronRight size={18} color={C.label3} />
        </button>
        <div style={{ padding: "4px 12px 0" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: "100%",
              padding: "12px 0",
              border: "none",
              borderRadius: C.radius,
              background: C.card2,
              fontSize: 15,
              fontWeight: 700,
              color: C.label3,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </>
  );
}

/** Assign chip colors — same palette as coconut-app `receipt.tsx` */
const RECEIPT_ASSIGN_COLORS = ["#3EBB74", "#4A6CF7", "#E8507A", "#F59E0B", "#10A37F", "#FF5A5F"];
function receiptAssignColor(i: number) {
  return RECEIPT_ASSIGN_COLORS[i % RECEIPT_ASSIGN_COLORS.length];
}

const RECEIPT_FLOW_STEPS = [
  { key: "upload", label: "Upload" },
  { key: "review", label: "Review" },
  { key: "assign", label: "Assign" },
  { key: "summary", label: "Summary" },
] as const;

type ReceiptModalStep = "upload" | "review" | "assign" | "summary";

/** Mirrors coconut-app receipt.tsx: upload → review → assign (per line + All) → summary → add-expense confirm */
function ReceiptScanModal({
  onClose,
  onContinueToSplit,
}: {
  onClose: () => void;
  onContinueToSplit: (payload: {
    merchant: string;
    amount: number;
    receiptSplit?: { people: PersonId[]; splits: Record<PersonId, number>; paidBy: PersonId };
  }) => void;
}) {
  const C = React.useContext(ThemeCtx);
  const [step, setStep] = useState<ReceiptModalStep>("upload");
  const [busy, setBusy] = useState(false);
  const [merchant, setMerchant] = useState("Nobu");
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [peopleAtTable, setPeopleAtTable] = useState<PersonId[]>(["alex", "jordan"]);
  const [assignByLine, setAssignByLine] = useState<Record<string, PersonId[]>>({});
  const [assignSearch, setAssignSearch] = useState("");

  const stepIdx: number = step === "upload" ? 0 : step === "review" ? 1 : step === "assign" ? 2 : 3;

  const goReview = (hit: { merchant: string; amount: number }) => {
    const shortName = hit.merchant.split(" · ")[0]?.trim() || hit.merchant;
    setMerchant(shortName);
    setLines(buildDemoReceiptLines(hit));
    setAssignByLine({});
    setPeopleAtTable(["alex", "jordan"]);
    setAssignSearch("");
    setStep("review");
    setBusy(false);
  };

  const simulateScan = () => {
    setBusy(true);
    window.setTimeout(() => {
      goReview({ merchant: "Nobu · receipt (4 lines)", amount: 248 });
    }, 1100);
  };

  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit, 0);

  const personTotals = useMemo(() => {
    const m = new Map<PersonId, number>();
    for (const l of lines) {
      const asg = assignByLine[l.id] ?? [];
      if (asg.length === 0) continue;
      const lt = l.qty * l.unit;
      const share = lt / asg.length;
      for (const p of asg) m.set(p, (m.get(p) ?? 0) + share);
    }
    return m;
  }, [lines, assignByLine]);

  const personBreakdown = useMemo(() => {
    const map = new Map<PersonId, { name: string; share: number }[]>();
    for (const p of peopleAtTable) map.set(p, []);
    for (const l of lines) {
      const asg = assignByLine[l.id] ?? [];
      if (asg.length === 0) continue;
      const lt = l.qty * l.unit;
      const share = lt / asg.length;
      for (const p of asg) {
        const row = map.get(p);
        if (row) row.push({ name: l.name, share });
      }
    }
    return map;
  }, [lines, assignByLine, peopleAtTable]);

  const unassignedCount = lines.filter((l) => (assignByLine[l.id]?.length ?? 0) === 0).length;
  const allAssigned = lines.length > 0 && unassignedCount === 0 && peopleAtTable.length > 0;

  const removeFromTable = (id: PersonId) => {
    setPeopleAtTable((p) => p.filter((x) => x !== id));
    setAssignByLine((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        next[k] = next[k].filter((x) => x !== id);
      }
      return next;
    });
  };

  const toggleLinePerson = (lineId: string, pid: PersonId) => {
    setAssignByLine((prev) => {
      const cur = prev[lineId] ?? [];
      const has = cur.includes(pid);
      const nextList = has ? cur.filter((x) => x !== pid) : [...cur, pid];
      return { ...prev, [lineId]: nextList };
    });
  };

  const assignAllToLine = (lineId: string) => {
    setAssignByLine((prev) => ({ ...prev, [lineId]: [...peopleAtTable] }));
  };

  const addPersonFromContact = (id: PersonId) => {
    if (peopleAtTable.includes(id)) return;
    setPeopleAtTable((p) => [...p, id]);
    setAssignSearch("");
  };

  const assignSearchable = CONTACTS.filter((c) => c.id !== "you");
  const assignPickResults = assignSearch.trim()
    ? assignSearchable.filter(
        (c) =>
          !peopleAtTable.includes(c.id as PersonId) &&
          (c.full.toLowerCase().includes(assignSearch.trim().toLowerCase()) ||
            c.email.toLowerCase().includes(assignSearch.trim().toLowerCase()) ||
            (c.phone?.includes(assignSearch.trim()) ?? false))
      )
    : [];

  const goBackHeader = () => {
    if (step === "upload") onClose();
    else if (step === "review") setStep("upload");
    else if (step === "assign") setStep("review");
    else setStep("assign");
  };

  const finishToAddExpense = () => {
    const label = `${merchant} · receipt (${lines.length} lines)`;
    const amount = Math.round(subtotal * 100) / 100;
    let sumOthers = 0;
    const splits = {} as Record<PersonId, number>;
    for (const p of peopleAtTable) {
      const v = Math.round((personTotals.get(p) ?? 0) * 100) / 100;
      splits[p] = v;
      sumOthers += v;
    }
    splits["you"] = Math.round((amount - sumOthers) * 100) / 100;
    onContinueToSplit({
      merchant: label,
      amount,
      receiptSplit: { people: [...peopleAtTable], splits, paidBy: "you" },
    });
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ position: "absolute", inset: 0, zIndex: 52, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(10px)" }}
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 280 }}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 53,
          background: C.bg,
          borderRadius: `${C.radius + 10}px ${C.radius + 10}px 0 0`,
          border: `${C.borderW} solid ${C.stroke}`,
          boxShadow: "0 -12px 60px rgba(0,0,0,0.5)",
          height: "93%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Handle />
        <div style={{ display: "flex", alignItems: "center", padding: "4px 12px 8px", borderBottom: `${C.borderW} solid ${C.stroke}` }}>
          <button type="button" onClick={goBackHeader} style={{ border: "none", background: "none", cursor: "pointer", padding: 6, display: "flex" }}>
            <ChevronLeft size={22} color={C.accent} />
          </button>
          <p style={{ flex: 1, fontSize: 17, fontWeight: 800, color: C.label, textAlign: "center", marginRight: 28 }}>Split Receipt</p>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 24px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 18 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: C.accentBg,
                border: `1px solid ${C.accent}30`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Package size={22} color={C.accent} strokeWidth={2} />
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 18, fontWeight: 800, color: C.label, letterSpacing: "-0.02em" }}>Split Receipt</p>
              <p style={{ fontSize: 13, color: C.label3, marginTop: 4, lineHeight: 1.45 }}>Scan a receipt and split items with friends</p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 20, overflowX: "auto", paddingBottom: 4 }}>
            {RECEIPT_FLOW_STEPS.map((s, i) => (
              <React.Fragment key={s.key}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 56 }}>
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 13,
                      background: i <= stepIdx ? C.accent : C.card2,
                      border: `2px solid ${i <= stepIdx ? C.accent : C.stroke}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 800,
                      color: i <= stepIdx ? (C.isDark ? C.bg : "#fff") : C.label3,
                    }}
                  >
                    {i < stepIdx ? <Check size={12} color={C.isDark ? C.bg : "#fff"} strokeWidth={3} /> : i + 1}
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: i === stepIdx ? C.label : C.label3 }}>{s.label}</span>
                </div>
                {i < RECEIPT_FLOW_STEPS.length - 1 && (
                  <div style={{ width: 16, height: 2, background: i < stepIdx ? C.accent : C.stroke, borderRadius: 1, flexShrink: 0, marginBottom: 22 }} />
                )}
              </React.Fragment>
            ))}
          </div>

          {step === "upload" && (
            <div>
              {busy ? (
                <div style={{ textAlign: "center", padding: "48px 0" }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: C.accent, marginBottom: 8 }}>Reading receipt…</p>
                  <p style={{ fontSize: 12, color: C.label3 }}>Extracting line items</p>
                </div>
              ) : (
                <>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.99 }}
                    onClick={simulateScan}
                    style={{
                      width: "100%",
                      padding: "22px 16px",
                      borderRadius: C.radius + 4,
                      border: `${C.borderW} solid ${C.stroke}`,
                      background: C.card2,
                      cursor: "pointer",
                      marginBottom: 12,
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                      <div
                        style={{
                          width: 52,
                          height: 52,
                          borderRadius: 26,
                          background: C.accentBg,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Camera size={26} color={C.accent} strokeWidth={2} />
                      </div>
                      <p style={{ fontSize: 16, fontWeight: 800, color: C.label }}>Take or pick a photo</p>
                      <p style={{ fontSize: 12, color: C.label3 }}>PNG, JPG, or PDF (demo simulates a scan)</p>
                    </div>
                  </motion.button>
                  <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
                    <button
                      type="button"
                      onClick={simulateScan}
                      style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        padding: "12px 0",
                        borderRadius: C.radius,
                        border: `${C.borderW} solid ${C.stroke}`,
                        background: C.card3,
                        fontSize: 13,
                        fontWeight: 700,
                        color: C.accent,
                        cursor: "pointer",
                      }}
                    >
                      <Camera size={18} /> Camera
                    </button>
                    <button
                      type="button"
                      onClick={simulateScan}
                      style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        padding: "12px 0",
                        borderRadius: C.radius,
                        border: `${C.borderW} solid ${C.stroke}`,
                        background: C.card3,
                        fontSize: 13,
                        fontWeight: 700,
                        color: C.accent,
                        cursor: "pointer",
                      }}
                    >
                      <FileText size={18} /> PDF
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {step === "review" && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.label3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Merchant</p>
              <input
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "12px 14px",
                  borderRadius: C.radius,
                  border: `${C.borderW} solid ${C.stroke}`,
                  background: C.card2,
                  fontSize: 15,
                  fontWeight: 600,
                  color: C.label,
                  marginBottom: 16,
                  outline: "none",
                }}
              />
              <p style={{ fontSize: 11, fontWeight: 700, color: C.label3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Items</p>
              <Card style={{ marginBottom: 16 }}>
                {lines.map((line, i) => {
                  const lineTotal = line.qty * line.unit;
                  return (
                    <div key={line.id}>
                      <div style={{ padding: "12px 14px" }}>
                        <p style={{ fontSize: 14, fontWeight: 700, color: C.label }}>{line.name}</p>
                        <p style={{ fontSize: 12, color: C.label3, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
                          {line.qty} × ${line.unit.toFixed(2)} = ${lineTotal.toFixed(2)}
                        </p>
                      </div>
                      {i < lines.length - 1 && <Sep />}
                    </div>
                  );
                })}
              </Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 4px" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.label }}>Subtotal</span>
                <span style={{ fontSize: 18, fontWeight: 900, color: C.accent, fontVariantNumeric: "tabular-nums" }}>${subtotal.toFixed(2)}</span>
              </div>
              <PrimaryBtn onClick={() => setStep("assign")}>Assign items →</PrimaryBtn>
              <p style={{ fontSize: 11, color: C.label3, textAlign: "center", marginTop: 10 }}>Tag who shared each line, then see a summary like the app</p>
            </div>
          )}

          {step === "assign" && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.label3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>People at the table</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                {peopleAtTable.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => removeFromTable(id)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 12px 6px 6px",
                      borderRadius: 999,
                      border: "none",
                      background: receiptAssignColor(peopleAtTable.indexOf(id)),
                      color: "#fff",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    <PersonFace id={id} size={24} border="2px solid rgba(255,255,255,0.92)" />
                    {getContact(id).name}
                    <X size={12} color="rgba(255,255,255,0.85)" strokeWidth={2.5} />
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "0 12px",
                    height: 42,
                    borderRadius: C.radius,
                    border: `${C.borderW} solid ${C.stroke}`,
                    background: C.card2,
                  }}
                >
                  <Search size={15} color={C.label3} />
                  <input
                    value={assignSearch}
                    onChange={(e) => setAssignSearch(e.target.value)}
                    placeholder="Search contacts…"
                    style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 14, color: C.label }}
                  />
                  {assignSearch && (
                    <button type="button" onClick={() => setAssignSearch("")} style={{ border: "none", background: "none", cursor: "pointer", padding: 4 }}>
                      <X size={14} color={C.label3} />
                    </button>
                  )}
                </div>
              </div>
              {assignPickResults.length > 0 && assignSearch.trim() && (
                <Card style={{ marginBottom: 16 }}>
                  {assignPickResults.map((c, i) => (
                    <div key={c.id}>
                      <button
                        type="button"
                        onClick={() => addPersonFromContact(c.id as PersonId)}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "12px 14px",
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <Avatar id={c.id as PersonId} size={36} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 14, fontWeight: 700, color: C.label }}>{c.full}</p>
                          <p style={{ fontSize: 11, color: C.label3 }}>{c.email}</p>
                        </div>
                        <ChevronRight size={18} color={C.label3} />
                      </button>
                      {i < assignPickResults.length - 1 && <Sep />}
                    </div>
                  ))}
                </Card>
              )}

              <p style={{ fontSize: 11, fontWeight: 700, color: C.label3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10, marginTop: 8 }}>Assign items</p>
              {peopleAtTable.length === 0 && (
                <div
                  style={{
                    padding: "28px 16px",
                    textAlign: "center",
                    borderRadius: C.radius,
                    border: `${C.borderW} dashed ${C.stroke}`,
                    background: C.card2,
                    marginBottom: 16,
                  }}
                >
                  <Users size={22} color={C.label3} style={{ marginBottom: 8 }} />
                  <p style={{ fontSize: 13, color: C.label3, fontWeight: 600 }}>Add people above to start assigning items</p>
                </div>
              )}
              {lines.map((line) => {
                const assigned = assignByLine[line.id] ?? [];
                const isAssigned = assigned.length > 0;
                const isUnassigned = !isAssigned && peopleAtTable.length > 0;
                const lineTotal = line.qty * line.unit;
                return (
                  <div
                    key={line.id}
                    style={{
                      marginBottom: 12,
                      padding: "12px 14px",
                      borderRadius: C.radius + 2,
                      border: `${C.borderW} solid ${isAssigned ? C.accent + "55" : isUnassigned ? C.amber + "50" : C.stroke}`,
                      background: isUnassigned ? C.amberBg : C.card,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: peopleAtTable.length > 0 ? 10 : 0 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 14, fontWeight: 800, color: C.label }}>{line.name}</p>
                        <p style={{ fontSize: 12, color: C.label3, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
                          ${lineTotal.toFixed(2)} total
                        </p>
                      </div>
                      {peopleAtTable.length > 0 && (
                        <button
                          type="button"
                          onClick={() => assignAllToLine(line.id)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            flexShrink: 0,
                            padding: "8px 11px",
                            borderRadius: C.radius,
                            border: "none",
                            background: C.accentBg,
                            color: C.accent,
                            fontSize: 12,
                            fontWeight: 800,
                            cursor: "pointer",
                          }}
                        >
                          <Users size={14} strokeWidth={2.2} />
                          All
                        </button>
                      )}
                    </div>
                    {peopleAtTable.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {peopleAtTable.map((pid, pIdx) => {
                          const on = assigned.includes(pid);
                          const share = on && assigned.length > 0 ? lineTotal / assigned.length : 0;
                          return (
                            <button
                              key={pid}
                              type="button"
                              onClick={() => toggleLinePerson(line.id, pid)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "6px 12px 6px 6px",
                                borderRadius: 999,
                                border: "none",
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                                background: on ? receiptAssignColor(pIdx) : C.card3,
                                color: on ? "#fff" : C.label3,
                              }}
                            >
                              <PersonFace
                                id={pid}
                                size={22}
                                border={on ? "2px solid rgba(255,255,255,0.9)" : `1px solid ${C.stroke}`}
                              />
                              <span>
                                {getContact(pid).name}
                                {on && assigned.length > 1 ? ` $${share.toFixed(2)}` : ""}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {peopleAtTable.length > 0 && personTotals.size > 0 && (
                <div
                  style={{
                    marginTop: 8,
                    marginBottom: 16,
                    padding: "12px 14px",
                    borderRadius: C.radius,
                    border: `${C.borderW} solid ${C.stroke}`,
                    background: C.card2,
                  }}
                >
                  <p style={{ fontSize: 11, fontWeight: 700, color: C.label3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Running totals</p>
                  {peopleAtTable.map((p) => (
                    <div key={p} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <Avatar id={p} size={26} />
                      <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: C.label }}>{getContact(p).full}</span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: C.label, fontVariantNumeric: "tabular-nums" }}>
                        ${(personTotals.get(p) ?? 0).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setStep("review")}
                  style={{ border: "none", background: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 14, fontWeight: 600, color: C.label3 }}
                >
                  <ChevronLeft size={18} />
                  Back
                </button>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                  {!allAssigned && peopleAtTable.length > 0 && unassignedCount > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.red }}>
                      {unassignedCount} item{unassignedCount > 1 ? "s" : ""} unassigned
                    </span>
                  )}
                  <PrimaryBtn disabled={!allAssigned} onClick={() => setStep("summary")}>
                    View summary →
                  </PrimaryBtn>
                </div>
              </div>
            </div>
          )}

          {step === "summary" && (
            <div>
              <p style={{ fontSize: 14, color: C.label3, marginBottom: 14, lineHeight: 1.5 }}>
                <span style={{ fontWeight: 800, color: C.label }}>{merchant}</span>
                {" · "}
                <span style={{ fontWeight: 800, color: C.accent }}>${subtotal.toFixed(2)}</span> total
              </p>
              {peopleAtTable.map((p) => {
                const rows = personBreakdown.get(p) ?? [];
                const total = personTotals.get(p) ?? 0;
                return (
                  <div
                    key={p}
                    style={{
                      marginBottom: 12,
                      borderRadius: C.radius + 2,
                      border: `${C.borderW} solid ${C.stroke}`,
                      overflow: "hidden",
                      background: C.card,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "12px 14px",
                        background: C.card2,
                        borderBottom: `${C.borderW} solid ${C.sep}`,
                      }}
                    >
                      <Avatar id={p} size={36} />
                      <span style={{ flex: 1, fontSize: 15, fontWeight: 800, color: C.label }}>{getContact(p).full}</span>
                      <span style={{ fontSize: 16, fontWeight: 900, color: C.label, fontVariantNumeric: "tabular-nums" }}>${total.toFixed(2)}</span>
                    </div>
                    <div style={{ padding: "10px 14px 12px" }}>
                      {rows.map((r, j) => (
                        <div key={`${p}-${j}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: j < rows.length - 1 ? 8 : 0 }}>
                          <span style={{ fontSize: 13, color: C.label3 }}>{r.name}</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: C.label2, fontVariantNumeric: "tabular-nums" }}>${r.share.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              <p style={{ fontSize: 11, color: C.label3, marginBottom: 12, lineHeight: 1.45 }}>You paid the receipt. Add it to your group split next.</p>
              <PrimaryBtn onClick={finishToAddExpense}>Add to group split →</PrimaryBtn>
              <button
                type="button"
                onClick={() => setStep("assign")}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 12,
                  padding: 12,
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                  color: C.label3,
                }}
              >
                ← Edit assignments
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}

function PeopleStep({ onNext, onBack: _onBack }: { onNext: (people: PersonId[]) => void; onBack: () => void }) {
  const C = React.useContext(ThemeCtx);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PersonId[]>(["alex", "jordan"]);
  const searchable = CONTACTS.filter(c => c.id !== "you");
  const results = query.trim()
    ? searchable.filter(c => c.full.toLowerCase().includes(query.toLowerCase()) || c.email.toLowerCase().includes(query.toLowerCase()) || c.phone?.includes(query))
    : searchable;
  const toggle = (id: PersonId) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      <div style={{ padding:"0 20px", marginBottom:12 }}>
        <AnimatePresence>
          {selected.length > 0 && (
            <motion.div initial={{ height:0, opacity:0 }} animate={{ height:"auto", opacity:1 }} exit={{ height:0, opacity:0 }} style={{ display:"flex", flexWrap:"wrap", gap:7, marginBottom:10, overflow:"hidden" }}>
              {selected.map(id => (
                <motion.div key={id} initial={{ scale:0 }} animate={{ scale:1 }} exit={{ scale:0 }}>
                  <Chip id={id} onRemove={() => toggle(id)} />
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"0 14px", background:C.card2, borderRadius:C.radius, border:`${C.borderW} solid ${C.stroke}`, height:44 }}>
          <Search size={15} color={C.label3} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, email, phone…"
            style={{ flex:1, background:"transparent", border:"none", outline:"none", fontSize:14, color:C.label }} />
          {query && <button onClick={() => setQuery("")} style={{ border:"none", background:"none", cursor:"pointer" }}><X size={13} color={C.label3} /></button>}
        </div>
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"0 20px 8px" }}>
        {query && results.length === 0 && (
          <p style={{ fontSize:14, color:C.label3, textAlign:"center", padding:"24px 0" }}>
            No contacts matching &quot;{query}&quot;
          </p>
        )}
        <Card>
          {results.map((contact, i) => {
            const sel = selected.includes(contact.id as PersonId);
            return (
              <div key={contact.id}>
                <motion.button whileTap={{ scale:0.99 }} onClick={() => toggle(contact.id as PersonId)} style={{ width:"100%", display:"flex", alignItems:"center", gap:12, padding:"12px 16px", background:"transparent", border:"none", cursor:"pointer", textAlign:"left" }}>
                  <div style={{ position:"relative" }}>
                    <Avatar id={contact.id as PersonId} size={40} />
                    {sel && <div style={{ position:"absolute", bottom:-2, right:-2, width:17, height:17, borderRadius:9, background:C.accent, border:`2px solid ${C.card}`, display:"flex", alignItems:"center", justifyContent:"center" }}><Check size={9} color={C.isDark ? C.bg : "#fff"} /></div>}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontSize:15, fontWeight:600, color:sel ? C.accent : C.label }}>{contact.full}</p>
                    <p style={{ fontSize:12, color:C.label3, marginTop:1 }}>{contact.email}</p>
                  </div>
                  <div style={{ width:22, height:22, borderRadius:11, border:`2px solid ${sel ? C.accent : C.stroke}`, background:sel ? C.accent : "transparent", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s" }}>
                    {sel && <Check size={11} color={C.isDark ? C.bg : "#fff"} />}
                  </div>
                </motion.button>
                {i < results.length - 1 && <Sep ml={68} />}
              </div>
            );
          })}
        </Card>
      </div>
      <div style={{ padding:"10px 20px 34px" }}>
        <PrimaryBtn onClick={() => selected.length > 0 && onNext(selected)} disabled={selected.length === 0}>
          Next: Add Amount →
        </PrimaryBtn>
      </div>
    </div>
  );
}

type SplitMode = "equal" | "unequal_pct" | "unequal_amt" | "shares";

function SplitStep({ amount, people, paidBy, onNext }: { amount: number; people: PersonId[]; paidBy: PersonId; onNext: (splits: Record<PersonId, number>) => void; onBack: () => void }) {
  const C = React.useContext(ThemeCtx);
  const allPeople = ["you" as PersonId, ...people];
  const [mode, setMode] = useState<SplitMode>("equal");
  const equalShare = amount / allPeople.length;
  const defaultPct = 100 / allPeople.length;
  const [pcts, setPcts] = useState<Record<string, number>>(() => { const init: Record<string, number> = {}; allPeople.forEach(id => { init[id] = parseFloat(defaultPct.toFixed(1)); }); return init; });
  const [amts, setAmts] = useState<Record<string, number>>(() => { const init: Record<string, number> = {}; allPeople.forEach(id => { init[id] = parseFloat(equalShare.toFixed(2)); }); return init; });
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  const [shares, setShares] = useState<Record<string, number>>(() => { const init: Record<string, number> = {}; allPeople.forEach(id => { init[id] = 1; }); return init; });

  const getSplits = (): Record<PersonId, number> => {
    if (mode === "equal") { const r: Record<PersonId, number> = {} as any; allPeople.forEach(id => { r[id] = equalShare; }); return r; }
    if (mode === "unequal_pct") { const r: Record<PersonId, number> = {} as any; allPeople.forEach(id => { r[id] = amount * (pcts[id] / 100); }); return r; }
    if (mode === "unequal_amt") { const r: Record<PersonId, number> = {} as any; allPeople.forEach(id => { r[id] = amts[id]; }); return r; }
    const total = allPeople.reduce((a, id) => a + shares[id], 0);
    const r: Record<PersonId, number> = {} as any;
    allPeople.forEach(id => { r[id] = amount * (shares[id] / total); });
    return r;
  };

  const splits = getSplits();
  const pctTotal = allPeople.reduce((a, id) => a + pcts[id], 0);
  const amtTotal = allPeople.reduce((a, id) => a + amts[id], 0);
  const pctOk = Math.abs(pctTotal - 100) < 0.1;
  const amtOk = Math.abs(amtTotal - amount) < 0.01;
  const isValid = mode === "equal" || mode === "shares" || (mode === "unequal_pct" && pctOk) || (mode === "unequal_amt" && amtOk);

  const updatePct = (id: string, val: number) => { const others = allPeople.filter(p => p !== id); const remaining = 100 - val; const perOther = remaining / others.length; const next: Record<string, number> = {}; allPeople.forEach(p => { next[p] = p === id ? val : parseFloat(perOther.toFixed(1)); }); setPcts(next); };
  const updateAmt = (id: string, val: number) => { const lockedIds = Object.keys(locked).filter(k => locked[k] && k !== id); const lockedTotal = lockedIds.reduce((a, k) => a + amts[k], 0); const remaining = amount - val - lockedTotal; const freeIds = allPeople.filter(p => p !== id && !locked[p]); const perFree = freeIds.length > 0 ? remaining / freeIds.length : 0; const next = { ...amts, [id]: val }; freeIds.forEach(p => { next[p] = parseFloat(Math.max(0, perFree).toFixed(2)); }); setAmts(next); };

  const modes: { key: SplitMode; label: string; icon: React.ReactNode }[] = [
    { key:"equal", label:"Equal", icon:<Equal size={13} /> },
    { key:"unequal_pct", label:"%", icon:<Hash size={13} /> },
    { key:"unequal_amt", label:"$", icon:<Sliders size={13} /> },
    { key:"shares", label:"Shares", icon:<span style={{ fontSize:12 }}>×</span> },
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      <div style={{ padding:"0 20px 12px" }}>
        <div style={{ display:"flex", background:C.card2, borderRadius:C.radius, padding:3, gap:3 }}>
          {modes.map(m => (
            <button key={m.key} onClick={() => setMode(m.key)} style={{ flex:1, border:"none", padding:"9px 0", borderRadius:C.radius - 2, fontSize:12, fontWeight:700, background: mode === m.key ? C.card : "transparent", color: mode === m.key ? C.label : C.label3, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:4, transition:"all 0.15s", boxShadow: mode === m.key ? C.shSm : "none" }}>
              {m.icon} {m.label}
            </button>
          ))}
        </div>
        {mode === "unequal_pct" && !pctOk && <p style={{ fontSize:11, color:C.amber, marginTop:7, textAlign:"center" }}>{pctTotal.toFixed(1)}% (needs 100%)</p>}
        {mode === "unequal_amt" && !amtOk && <p style={{ fontSize:11, color: amtTotal > amount ? C.red : C.amber, marginTop:7, textAlign:"center" }}>${amtTotal.toFixed(2)} of ${amount.toFixed(2)} {amtTotal > amount ? "(over!)" : `($${(amount - amtTotal).toFixed(2)} left)`}</p>}
        {mode === "unequal_pct" && pctOk && <p style={{ fontSize:11, color:C.green, marginTop:7, textAlign:"center" }}>✓ 100% assigned</p>}
        {mode === "unequal_amt" && amtOk && <p style={{ fontSize:11, color:C.green, marginTop:7, textAlign:"center" }}>✓ Amounts add up</p>}
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"0 20px 8px" }}>
        {paidBy !== "you" && (
          <div style={{ padding:"10px 14px", background:C.amberBg, borderRadius:C.radius, border:`1px solid ${C.amber}30`, marginBottom:12, display:"flex", alignItems:"center", gap:8 }}>
            <p style={{ fontSize:12, color:C.amber }}>💡 {getContact(paidBy).name} paid. Everyone owes them.</p>
          </div>
        )}
        <Card>
          {allPeople.map((id, i) => {
            const c = getContact(id); const isPayer = id === paidBy; const split = splits[id];
            return (
              <div key={id}>
                <div style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 16px" }}>
                  <Avatar id={id} size={36} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontSize:14, fontWeight:700, color:C.label }}>{c.full}{isPayer ? <span style={{ fontSize:11, color:C.amber, marginLeft:6 }}>paid</span> : null}</p>
                    {mode === "equal" && <p style={{ fontSize:12, color:C.label3, marginTop:1, fontVariantNumeric:"tabular-nums" }}>${split.toFixed(2)} each</p>}
                    {mode === "shares" && (
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:5 }}>
                        <button onClick={() => setShares(s => ({ ...s, [id]: Math.max(1, s[id]-1) }))} style={{ width:22, height:22, borderRadius:11, border:`${C.borderW} solid ${C.stroke}`, background:"transparent", color:C.label, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>−</button>
                        <span style={{ fontSize:13, fontWeight:700, color:C.label, minWidth:20, textAlign:"center" }}>{shares[id]}×</span>
                        <button onClick={() => setShares(s => ({ ...s, [id]: s[id]+1 }))} style={{ width:22, height:22, borderRadius:11, border:`${C.borderW} solid ${C.stroke}`, background:"transparent", color:C.label, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>+</button>
                      </div>
                    )}
                  </div>
                  {mode === "equal" && <p style={{ fontSize:18, fontWeight:800, color:C.accent, fontVariantNumeric:"tabular-nums" }}>${split.toFixed(2)}</p>}
                  {mode === "unequal_pct" && (
                    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                      <input value={pcts[id]} type="number" onChange={e => updatePct(id, parseFloat(e.target.value)||0)} style={{ width:46, background:C.card2, border:`${C.borderW} solid ${C.stroke}`, borderRadius:8, padding:"5px 7px", fontSize:13, fontWeight:700, color:C.accent, textAlign:"right", outline:"none" }} />
                      <span style={{ fontSize:12, color:C.label3 }}>%</span>
                      <span style={{ fontSize:12, fontWeight:600, color:C.label2, minWidth:52, textAlign:"right", fontVariantNumeric:"tabular-nums" }}>${split.toFixed(2)}</span>
                    </div>
                  )}
                  {mode === "unequal_amt" && (
                    <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                      <span style={{ fontSize:12, color:C.label3 }}>$</span>
                      <input value={amts[id].toFixed(2)} type="number" onChange={e => updateAmt(id, parseFloat(e.target.value)||0)} style={{ width:58, background:C.card2, border:`${C.borderW} solid ${C.stroke}`, borderRadius:8, padding:"5px 7px", fontSize:13, fontWeight:700, color:C.accent, textAlign:"right", outline:"none" }} />
                      <button onClick={() => setLocked(l => ({ ...l, [id]: !l[id] }))} style={{ border:"none", background:"none", cursor:"pointer", padding:4 }}>
                        {locked[id] ? <Lock size={12} color={C.amber} /> : <Unlock size={12} color={C.label3} />}
                      </button>
                    </div>
                  )}
                  {mode === "shares" && <p style={{ fontSize:16, fontWeight:800, color:C.accent, fontVariantNumeric:"tabular-nums" }}>${split.toFixed(2)}</p>}
                </div>
                {i < allPeople.length - 1 && <Sep ml={64} />}
              </div>
            );
          })}
        </Card>
      </div>
      <div style={{ padding:"10px 20px 34px" }}>
        <PrimaryBtn onClick={() => isValid && onNext(splits)} disabled={!isValid}>Review →</PrimaryBtn>
      </div>
    </div>
  );
}

function ConfirmStep({ amount, description, splits, paidBy, people, onSettle, onDone }: { amount: number; description: string; splits: Record<PersonId, number>; paidBy: PersonId; people: PersonId[]; onSettle: (p: PersonId, a: number) => void; onDone: () => void }) {
  const C = React.useContext(ThemeCtx);
  const [addedToTab, setAddedToTab] = useState<PersonId[]>([]);
  const youOwePeople = paidBy !== "you" ? ["you" as PersonId, ...people.filter(p => p !== paidBy)] : [];
  const oweYouPeople = paidBy === "you" ? people : people.filter(p => p !== paidBy);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      <div style={{ flex:1, overflowY:"auto", padding:"0 20px 8px" }}>
        {/* Summary pill */}
        <div style={{ padding:"16px 18px", borderRadius:C.radius + 4, background:C.accentBg, border:`1px solid ${C.accent}28`, marginBottom:18 }}>
          <p style={{ fontSize:12, color:C.label3, marginBottom:4 }}>{description}</p>
          <p style={{ fontSize:32, fontWeight:900, color:C.accent, letterSpacing:"-1.5px", fontVariantNumeric:"tabular-nums" }}>${amount.toFixed(2)}</p>
          <p style={{ fontSize:12, color:C.label3, marginTop:4 }}>Paid by {getContact(paidBy).name} · {people.length + 1} people</p>
        </div>

        {oweYouPeople.length > 0 && (
          <>
            <SectionLabel>They owe you</SectionLabel>
            <Card style={{ marginBottom:14 }}>
              {oweYouPeople.map((id, i) => {
                const c = getContact(id); const tabbed = addedToTab.includes(id); const owes = splits[id];
                return (
                  <div key={id}>
                    <div style={{ padding:"14px 16px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:tabbed ? 0 : 12 }}>
                        <Avatar id={id} size={36} />
                        <div style={{ flex:1 }}>
                          <p style={{ fontSize:15, fontWeight:700, color:tabbed ? C.label3 : C.label }}>{c.full}</p>
                          <p style={{ fontSize:12, color:C.label3, marginTop:1 }}>{tabbed ? "Added to tab ✓" : "their share"}</p>
                        </div>
                        <p style={{ fontSize:18, fontWeight:800, color:tabbed ? C.label3 : C.green, fontVariantNumeric:"tabular-nums" }}>${owes.toFixed(2)}</p>
                      </div>
                      {!tabbed && (
                        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                          <PrimaryBtn onClick={() => onSettle(id, owes)} style={{ padding:"10px 0", fontSize:13 }}><Nfc size={13} /> Settle</PrimaryBtn>
                          <GhostBtn onClick={() => setAddedToTab(t => [...t, id])}>Tab it</GhostBtn>
                        </div>
                      )}
                    </div>
                    {i < oweYouPeople.length - 1 && <Sep />}
                  </div>
                );
              })}
            </Card>
          </>
        )}
        {youOwePeople.length > 0 && (
          <>
            <SectionLabel>You owe</SectionLabel>
            <Card style={{ marginBottom:14 }}>
              <div style={{ padding:"14px 16px", display:"flex", alignItems:"center", gap:12 }}>
                <Avatar id={paidBy} size={36} />
                <div style={{ flex:1 }}>
                  <p style={{ fontSize:15, fontWeight:700, color:C.label }}>{getContact(paidBy).full}</p>
                  <p style={{ fontSize:12, color:C.label3, marginTop:1 }}>your share</p>
                </div>
                <p style={{ fontSize:18, fontWeight:800, color:C.red, fontVariantNumeric:"tabular-nums" }}>${splits["you"]?.toFixed(2)}</p>
              </div>
              <Sep />
              <div style={{ padding:"10px 16px" }}>
                <PrimaryBtn onClick={() => onSettle(paidBy, splits["you"] ?? 0)}><Nfc size={14} /> Pay {getContact(paidBy).name}</PrimaryBtn>
              </div>
            </Card>
          </>
        )}
        <button style={{ width:"100%", border:`${C.borderW} solid ${C.stroke}`, background:"transparent", borderRadius:C.radius + 2, padding:"12px 0", fontSize:14, color:C.label3, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
          <Share2 size={14} /> Export summary
        </button>
      </div>
      <div style={{ padding:"10px 20px 34px" }}>
        <PrimaryBtn onClick={onDone}>Done 🎉</PrimaryBtn>
      </div>
    </div>
  );
}

type AddStep = "amount" | "people" | "split" | "confirm";

const DEFAULT_SPLIT_PEOPLE: PersonId[] = ["alex", "jordan"];

/** Pre-fill from receipt assign → summary: open add-expense at confirm with splits */
type DemoPrefill = {
  merchant: string;
  amount: number;
  people?: PersonId[];
  splits?: Record<PersonId, number>;
  paidBy?: PersonId;
  skipToConfirm?: boolean;
};

function AddExpenseModal({ onClose, onSettle, prefill }: { onClose: () => void; onSettle: (p: PersonId, a: number) => void; prefill?: DemoPrefill }) {
  const C = React.useContext(ThemeCtx);
  const [step, setStep] = useState<AddStep>(() => (prefill ? "amount" : "people"));
  const [amount, setAmount] = useState(() => (prefill ? prefill.amount : 0));
  const [desc, setDesc] = useState(() => (prefill?.merchant ?? ""));
  const [paidBy, setPaidBy] = useState<PersonId>("you");
  const [people, setPeople] = useState<PersonId[]>(() => (prefill ? [...DEFAULT_SPLIT_PEOPLE] : []));
  const [splits, setSplits] = useState<Record<PersonId, number>>({} as any);
  const titles: Record<AddStep, string> = { people:"Who was there?", amount:"Add expense", split:"Split it", confirm:"Summary" };
  const backMap: Record<AddStep, AddStep> = { people:"people", amount:"people", split:"amount", confirm:"split" };
  const stepOrder: AddStep[] = ["people","amount","split","confirm"];

  useEffect(() => {
    if (!prefill) {
      setStep("people");
      setPeople([]);
      setAmount(0);
      setDesc("");
      setPaidBy("you");
      setSplits({} as Record<PersonId, number>);
      return;
    }
    setAmount(prefill.amount);
    setDesc(prefill.merchant);
    if (prefill.skipToConfirm && prefill.splits && prefill.people) {
      setStep("confirm");
      setPeople([...prefill.people]);
      setPaidBy(prefill.paidBy ?? "you");
      setSplits({ ...prefill.splits });
    } else {
      setStep("amount");
      setPeople([...DEFAULT_SPLIT_PEOPLE]);
      setPaidBy("you");
      setSplits({} as Record<PersonId, number>);
    }
  }, [prefill]);

  return (
    <>
      <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} onClick={onClose}
        style={{ position:"absolute", inset:0, zIndex:40, background:"rgba(0,0,0,0.6)", backdropFilter:"blur(10px)" }} />
      <motion.div initial={{ y:"100%" }} animate={{ y:0 }} exit={{ y:"100%" }} transition={{ type:"spring", damping:30, stiffness:280 }}
        style={{ position:"absolute", bottom:0, left:0, right:0, zIndex:50, background:C.bg, borderRadius:`${C.radius + 10}px ${C.radius + 10}px 0 0`, border:`${C.borderW} solid ${C.stroke}`, boxShadow:"0 -12px 60px rgba(0,0,0,0.5)", height:"93%", display:"flex", flexDirection:"column" }}>
        <Handle />
        {/* Progress dots */}
        <div style={{ display:"flex", justifyContent:"center", gap:5, marginBottom:4 }}>
          {stepOrder.map(s => (
            <div key={s} style={{ width: s === step ? 18 : 5, height:5, borderRadius:3, background: s === step ? C.accent : stepOrder.indexOf(s) < stepOrder.indexOf(step) ? C.accent + "60" : C.stroke, transition:"all 0.2s" }} />
          ))}
        </div>
        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", padding:"2px 20px 12px", gap:6 }}>
          {step !== "people" && (
            <button onClick={() => setStep(backMap[step])} style={{ border:"none", background:"none", cursor:"pointer", padding:"6px 6px 6px 0", display:"flex" }}>
              <ChevronLeft size={20} color={C.label3} />
            </button>
          )}
          {step === "people" && <div style={{ width:26 }} />}
          <p style={{ flex:1, fontSize:17, fontWeight:800, color:C.label, letterSpacing:"-0.3px" }}>{titles[step]}</p>
          <button onClick={onClose} style={{ border:"none", background:"none", cursor:"pointer", padding:6 }}><X size={18} color={C.label3} /></button>
        </div>
        <div style={{ flex:1, overflow:"hidden" }}>
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity:0, x:12 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:-12 }} transition={{ duration:0.16 }} style={{ height:"100%" }}>
              {step === "people" && (
                <PeopleStep
                  onNext={(ppl) => {
                    setPeople(ppl);
                    setStep("amount");
                  }}
                  onBack={() => {}}
                />
              )}
              {step === "amount" && (
                <AmountStep
                  prefill={prefill}
                  onNext={(a, d, p) => {
                    setAmount(a);
                    setDesc(d);
                    setPaidBy(p);
                    setStep("split");
                  }}
                />
              )}
              {step === "split" && <SplitStep amount={amount} people={people} paidBy={paidBy} onNext={s => { setSplits(s); setStep("confirm"); }} onBack={() => setStep("amount")} />}
              {step === "confirm" && <ConfirmStep amount={amount} description={desc} splits={splits} paidBy={paidBy} people={people} onSettle={onSettle} onDone={onClose} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ALL TX SHEET
// ─────────────────────────────────────────────────────────────────────────────
const TX_CONTEXT: [string[], string[]][] = [
  [["food","eat","dinner","lunch","pizza","restaurant","kitchen","ramen"], ["uber eats","hana","nobu","starbucks","whole foods"]],
  [["ride","car","drive","taxi","uber","lyft","transport"],                 ["uber","lyft"]],
  [["travel","fly","trip","hotel","stay","airbnb","flight","airline"],      ["airbnb","delta","airlines"]],
  [["shop","order","delivery","amazon","package"],                          ["amazon","whole foods"]],
  [["coffee","cafe","drink"],                                               ["starbucks"]],
  [["unsplit","pending","split","missing","not split"],                     []],
];

function highlightMatch(text: string, q: string) {
  if (!q) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return <>{text.slice(0, idx)}<mark style={{ background:"rgba(212,146,28,0.35)", borderRadius:2, color:"inherit" }}>{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>;
}

function AllTxSheet({ onClose, onSplit }: { onClose: () => void; onSplit: (tx: BankTx) => void }) {
  const C = React.useContext(ThemeCtx);
  const [filter, setFilter] = useState<"all"|"unsplit">("all");
  const [search, setSearch] = useState("");
  const [selectedTx, setSelectedTx] = useState<BankTx|null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const visible = React.useMemo(() => {
    const base = ALL_BANK_TX.filter(tx => filter === "all" || tx.unsplit);
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter(tx => {
      if (tx.merchant.toLowerCase().includes(q)) return true;
      if (tx.amount.toString().includes(q)) return true;
      if (tx.hint.toLowerCase().includes(q)) return true;
      if (tx.date.toLowerCase().includes(q)) return true;
      if (tx.email) { const snippet = emailSnippet(tx.email).toLowerCase(); if (snippet.includes(q)) return true; }
      for (const [concepts, merchants] of TX_CONTEXT) {
        const matchesConcept = concepts.some(c => c.includes(q) || q.includes(c));
        if (matchesConcept) {
          if (merchants.length === 0) return tx.unsplit;
          if (merchants.some(m => tx.merchant.toLowerCase().includes(m))) return true;
        }
      }
      return false;
    });
  }, [search, filter]);

  const [contextLabel, setContextLabel] = useState<string|null>(null);
  useEffect(() => {
    const q = search.trim().toLowerCase();
    if (!q) { setContextLabel(null); return; }
    const ctx = TX_CONTEXT.find(([concepts]) => concepts.some(c => c.includes(q) || q.includes(c)));
    setContextLabel(ctx ? `Showing "${ctx[0][0]}" charges` : null);
  }, [search]);

  return (
    <>
      <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} onClick={onClose}
        style={{ position:"absolute", inset:0, zIndex:40, background:"rgba(0,0,0,0.5)", backdropFilter:"blur(6px)" }} />
      <motion.div initial={{ y:"100%" }} animate={{ y:0 }} exit={{ y:"100%" }} transition={{ type:"spring", damping:30, stiffness:280 }}
        style={{ position:"absolute", bottom:0, left:0, right:0, zIndex:50, background:C.card, borderRadius:`${C.radius + 10}px ${C.radius + 10}px 0 0`, border:`${C.borderW} solid ${C.stroke}`, boxShadow:"0 -12px 60px rgba(0,0,0,0.4)", height:"90%", display:"flex", flexDirection:"column" }}>
        <Handle />
        <div style={{ display:"flex", alignItems:"center", padding:"0 20px 12px" }}>
          <p style={{ flex:1, fontSize:18, fontWeight:800, color:C.label, letterSpacing:"-0.4px" }}>Bank charges</p>
          <button onClick={onClose} style={{ border:"none", background:"none", cursor:"pointer", padding:6 }}><X size={18} color={C.label3} /></button>
        </div>
        {/* Search */}
        <div style={{ padding:"0 20px 10px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"0 14px", background:C.card2, borderRadius:C.radius, border:`${C.borderW} solid ${search ? C.accent + "60" : C.stroke}`, height:44, transition:"border-color 0.2s" }}>
            <Search size={15} color={search ? C.accent : C.label3} style={{ flexShrink:0, transition:"color 0.2s" }} />
            <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder='Search "food", "Uber", "$80"…'
              style={{ flex:1, background:"transparent", border:"none", outline:"none", fontSize:13, color:C.label }} />
            {search && <motion.button initial={{ scale:0 }} animate={{ scale:1 }} onClick={() => setSearch("")} style={{ border:"none", background:"none", cursor:"pointer", padding:2, display:"flex" }}><X size={13} color={C.label3} /></motion.button>}
          </div>
          <AnimatePresence>
            {contextLabel && (
              <motion.p initial={{ opacity:0, y:-4 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-4 }}
                style={{ fontSize:11, color:C.accent, marginTop:6, fontWeight:600 }}>✦ {contextLabel}</motion.p>
            )}
          </AnimatePresence>
        </div>
        {/* Filter chips */}
        <div style={{ display:"flex", gap:8, padding:"0 20px 12px" }}>
          {(["all","unsplit"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ border:"none", cursor:"pointer", padding:"7px 16px", borderRadius:20, fontSize:12, fontWeight:700, background: filter === f ? C.accent : C.card2, color: filter === f ? (C.isDark ? C.bg : "#fff") : C.label3, transition:"all 0.15s" }}>
              {f === "all" ? "All charges" : "Needs splitting"}
            </button>
          ))}
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:"0 20px 24px" }}>
          <AnimatePresence mode="wait">
            {visible.length === 0 ? (
              <motion.div key="empty" initial={{ opacity:0 }} animate={{ opacity:1 }} style={{ padding:"40px 0", textAlign:"center" }}>
                <p style={{ fontSize:28, marginBottom:10 }}>🔍</p>
                <p style={{ fontSize:15, color:C.label2, fontWeight:700 }}>No charges found</p>
                <p style={{ fontSize:12, color:C.label3, marginTop:4 }}>Try &quot;ride&quot;, &quot;food&quot;, or an amount</p>
              </motion.div>
            ) : (
              <motion.div key="list" initial={{ opacity:0 }} animate={{ opacity:1 }}>
                <Card>
                  {visible.map((tx, i) => (
                    <div key={tx.id}>
                      <motion.button whileTap={{ scale:0.99 }} onClick={() => setSelectedTx(tx)} style={{ width:"100%", display:"flex", alignItems:"center", gap:12, padding:"13px 16px", background:"transparent", border:"none", cursor:"pointer", textAlign:"left" }}>
                        <div style={{ position:"relative", flexShrink:0 }}>
                          <div style={{ width:40, height:40, borderRadius:C.radius, background:C.card2, display:"flex", alignItems:"center", justifyContent:"center" }}>
                            <MerchantLogo brand={tx.logo} size={26} />
                          </div>
                          {tx.email && <div style={{ position:"absolute", bottom:-3, right:-3, width:14, height:14, borderRadius:7, background:C.blue, display:"flex", alignItems:"center", justifyContent:"center" }}><Mail size={7} color="white" /></div>}
                          {tx.unsplit && !tx.email && <div style={{ position:"absolute", bottom:-3, right:-3, width:14, height:14, borderRadius:7, background:C.amber, border:`1.5px solid ${C.card}`, display:"flex", alignItems:"center", justifyContent:"center" }}><p style={{ fontSize:8, fontWeight:800, color: C.isDark ? "#000" : "#fff", lineHeight:1 }}>!</p></div>}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <p style={{ fontSize:14, fontWeight:700, color:C.label }}>{highlightMatch(tx.merchant, search.trim())}</p>
                          {tx.email
                            ? <p style={{ fontSize:11, color:C.blue, marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{emailSnippet(tx.email)}</p>
                            : <p style={{ fontSize:11, color: tx.unsplit ? C.amber : C.label3, marginTop:1 }}>{tx.date} · {tx.hint}</p>
                          }
                        </div>
                        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
                          <p style={{ fontSize:15, fontWeight:800, color:C.label, fontVariantNumeric:"tabular-nums" }}>${tx.amount.toFixed(2)}</p>
                          {tx.unsplit
                            ? <span style={{ fontSize:10, fontWeight:700, color:C.amber, background:C.amberBg, padding:"2px 6px", borderRadius:4 }}>Split</span>
                            : <span style={{ fontSize:10, color:C.label3 }}>{tx.date}</span>
                          }
                        </div>
                      </motion.button>
                      {i < visible.length - 1 && <Sep />}
                    </div>
                  ))}
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <AnimatePresence>
          {selectedTx && <TxDetailSheet tx={selectedTx} onClose={() => setSelectedTx(null)} onSplit={() => { onSplit(selectedTx); onClose(); }} />}
        </AnimatePresence>
      </motion.div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FRIEND DETAIL
// ─────────────────────────────────────────────────────────────────────────────
function FriendDetail({ friend, onBack, onSettle }: { friend: FriendBalance; onBack: () => void; onSettle: (p: PersonId, a: number) => void }) {
  const C = React.useContext(ThemeCtx);
  const c = getContact(friend.personId);
  const pos = friend.dir === "owes_you";

  return (
    <motion.div initial={{ x:"100%" }} animate={{ x:0 }} exit={{ x:"100%" }} transition={{ type:"spring", damping:28, stiffness:260 }}
      style={{ position:"absolute", inset:0, background:C.bg, zIndex:10, display:"flex", flexDirection:"column" }}>
      {/* Back nav */}
      <div style={{ padding:"10px 20px 0", display:"flex", alignItems:"center" }}>
        <motion.button whileTap={{ scale:0.9 }} onClick={onBack} style={{ border:"none", background:"none", cursor:"pointer", padding:"8px 10px 8px 0", display:"flex", alignItems:"center", gap:4 }}>
          <ChevronLeft size={18} color={C.accent} />
          <span style={{ fontSize:15, color:C.accent, fontWeight:600 }}>Back</span>
        </motion.button>
      </div>

      {/* Profile section */}
      <div style={{ padding:"20px 20px 24px", display:"flex", flexDirection:"column", alignItems:"center", gap:14 }}>
        <Avatar id={friend.personId} size={80} />
        <div style={{ textAlign:"center" }}>
          <p style={{ fontSize:21, fontWeight:800, color:C.label, letterSpacing:"-0.4px" }}>{c.full}</p>
          <p style={{ fontSize:13, color:C.label3, marginTop:3 }}>{friend.expenses.length} shared expense{friend.expenses.length !== 1 ? "s" : ""}</p>
        </div>
        {/* Balance pill */}
        <div style={{ padding:"14px 32px", borderRadius:20, background: pos ? C.greenBg : C.redBg, border:`1px solid ${pos ? C.green + "35" : C.red + "35"}` }}>
          <p style={{ fontSize:34, fontWeight:900, letterSpacing:"-1.5px", color: pos ? C.green : C.red, textAlign:"center", fontVariantNumeric:"tabular-nums" }}>
            {pos ? "+" : "−"}${friend.amount.toFixed(2)}
          </p>
          <p style={{ fontSize:12, marginTop:4, color: pos ? C.green : C.red, opacity:0.8, textAlign:"center" }}>
            {pos ? `${c.name} owes you` : `you owe ${c.name}`}
          </p>
        </div>
      </div>

      {/* Expenses */}
      <div style={{ flex:1, overflowY:"auto", padding:"0 16px 16px" }}>
        <SectionLabel>Shared expenses</SectionLabel>
        <Card style={{ marginBottom:16 }}>
          {friend.expenses.map((exp, i) => (
            <div key={exp.id}>
              <div style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 16px" }}>
                <div style={{ width:40, height:40, borderRadius:C.radius, background:C.card2, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <MerchantLogo brand={exp.logo} size={26} />
                </div>
                <div style={{ flex:1 }}>
                  <p style={{ fontSize:14, fontWeight:600, color:C.label }}>{exp.label}</p>
                  <p style={{ fontSize:12, color:C.label3, marginTop:1 }}>{exp.date}</p>
                </div>
                <p style={{ fontSize:15, fontWeight:800, color: pos ? C.green : C.red, fontVariantNumeric:"tabular-nums" }}>{pos ? "+" : "−"}${exp.amount.toFixed(2)}</p>
              </div>
              {i < friend.expenses.length - 1 && <Sep />}
            </div>
          ))}
        </Card>
        <PrimaryBtn onClick={() => onSettle(friend.personId, friend.amount)}>
          <Nfc size={16} /> {pos ? `Request $${friend.amount.toFixed(2)}` : `Pay $${friend.amount.toFixed(2)}`}
        </PrimaryBtn>
        {pos && <button onClick={() => {}} style={{ width:"100%", border:"none", background:"transparent", padding:"13px 0", fontSize:14, color:C.label3, cursor:"pointer" }}>Send reminder</button>}
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP DATA & DETAIL
// ─────────────────────────────────────────────────────────────────────────────
interface GroupData {
  id: string; name: string; members: PersonId[]; balance: number;
  expenses: { id: string; label: string; amount: number; date: string; logo: MerchantLogoKey; paidBy: PersonId }[];
}

const GROUPS: GroupData[] = [
  {
    id: "g1", name: "Tahoe Trip", members: ["you", "alex", "jordan", "sam"], balance: -24.00,
    expenses: [
      { id: "ge1", label: "Airbnb, Tahoe",    amount: 480.00, date: "Mar 15", logo: "airbnb",  paidBy: "alex" },
      { id: "ge2", label: "Ski Rentals",       amount: 120.00, date: "Mar 16", logo: "default", paidBy: "jordan" },
      { id: "ge3", label: "Nobu Restaurant",   amount: 248.00, date: "Mar 20", logo: "nobu",    paidBy: "you" },
    ],
  },
  {
    id: "g2", name: "Roommates", members: ["you", "maya", "ryan"], balance: 106.50,
    expenses: [
      { id: "ge4", label: "Electric Bill",  amount: 142.00, date: "Mar 1",  logo: "default", paidBy: "you" },
      { id: "ge5", label: "Internet",       amount: 89.00,  date: "Mar 1",  logo: "default", paidBy: "maya" },
      { id: "ge6", label: "Groceries",      amount: 67.50,  date: "Mar 10", logo: "whole_foods", paidBy: "you" },
    ],
  },
];

function GroupDetail({ group, onBack }: { group: GroupData; onBack: () => void }) {
  const C = React.useContext(ThemeCtx);
  const pos = group.balance >= 0;

  return (
    <motion.div initial={{ x:"100%" }} animate={{ x:0 }} exit={{ x:"100%" }} transition={{ type:"spring", damping:28, stiffness:260 }}
      style={{ position:"absolute", inset:0, background:C.bg, zIndex:10, display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"10px 20px 0", display:"flex", alignItems:"center" }}>
        <motion.button whileTap={{ scale:0.9 }} onClick={onBack} style={{ border:"none", background:"none", cursor:"pointer", padding:"8px 10px 8px 0", display:"flex", alignItems:"center", gap:4 }}>
          <ChevronLeft size={18} color={C.accent} />
          <span style={{ fontSize:15, color:C.accent, fontWeight:600 }}>Back</span>
        </motion.button>
      </div>

      <div style={{ padding:"20px 20px 24px", display:"flex", flexDirection:"column", alignItems:"center", gap:14 }}>
        <div style={{ width:72, height:72, borderRadius:22, background:C.accent+"15", border:`2px solid ${C.accent}30`, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <Users size={32} color={C.accent} />
        </div>
        <div style={{ textAlign:"center" }}>
          <p style={{ fontSize:21, fontWeight:800, color:C.label, letterSpacing:"-0.4px" }}>{group.name}</p>
          <p style={{ fontSize:13, color:C.label3, marginTop:3 }}>{group.members.length} members · {group.expenses.length} expense{group.expenses.length !== 1 ? "s" : ""}</p>
        </div>
        <div style={{ padding:"14px 32px", borderRadius:20, background: pos ? C.greenBg : C.redBg, border:`1px solid ${pos ? C.green + "35" : C.red + "35"}` }}>
          <p style={{ fontSize:34, fontWeight:900, letterSpacing:"-1.5px", color: pos ? C.green : C.red, textAlign:"center", fontVariantNumeric:"tabular-nums" }}>
            {pos ? "+" : "−"}${Math.abs(group.balance).toFixed(2)}
          </p>
          <p style={{ fontSize:12, marginTop:4, color: pos ? C.green : C.red, opacity:0.8, textAlign:"center" }}>
            {pos ? "you are owed" : "you owe"}
          </p>
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"0 16px 16px", scrollbarWidth:"none" }}>
        <SectionLabel>Members</SectionLabel>
        <Card style={{ marginBottom:16 }}>
          {group.members.map((m, i) => {
            const c = getContact(m);
            return (
              <div key={m}>
                <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px" }}>
                  <Avatar id={m} size={36} />
                  <p style={{ flex:1, fontSize:14, fontWeight:600, color:C.label }}>{c.full}</p>
                  {m === "you" && <span style={{ fontSize:11, fontWeight:700, color:C.accent, background:C.accent+"18", padding:"3px 10px", borderRadius:99 }}>You</span>}
                </div>
                {i < group.members.length - 1 && <Sep ml={64} />}
              </div>
            );
          })}
        </Card>

        <SectionLabel>Expenses</SectionLabel>
        <Card>
          {group.expenses.map((exp, i) => {
            const payer = getContact(exp.paidBy);
            return (
              <div key={exp.id}>
                <div style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 16px" }}>
                  <div style={{ width:40, height:40, borderRadius:C.radius, background:C.card2, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <MerchantLogo brand={exp.logo} size={26} />
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontSize:14, fontWeight:600, color:C.label }}>{exp.label}</p>
                    <p style={{ fontSize:12, color:C.label3, marginTop:1 }}>{payer.name} paid · {exp.date}</p>
                  </div>
                  <p style={{ fontSize:15, fontWeight:800, color:C.label, fontVariantNumeric:"tabular-nums" }}>${exp.amount.toFixed(2)}</p>
                </div>
                {i < group.expenses.length - 1 && <Sep />}
              </div>
            );
          })}
        </Card>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HOME SCREEN — fully redesigned
// ─────────────────────────────────────────────────────────────────────────────
function HomeScreen({ onSettle: _onSettle, onAdd: _onAdd, onFriend, onSeeAllTx, onSelectTx, onSeeActivity, onGroup }: {
  onSettle: (p: PersonId, a: number) => void;
  onAdd: (prefill?: { merchant: string; amount: number }) => void;
  onFriend: (f: FriendBalance) => void;
  onSeeAllTx: () => void;
  onSelectTx: (tx: BankTx) => void;
  onSeeActivity: () => void;
  onGroup: (g: GroupData) => void;
}) {
  const C = React.useContext(ThemeCtx);
  const [dismissedBank, setDismissedBank] = useState<string[]>([]);
  const unsplitBank = ALL_BANK_TX.filter(tx => tx.unsplit && !dismissedBank.includes(tx.id));
  const totalOwed  = FRIENDS.filter(f => f.dir === "owes_you").reduce((a, f) => a + f.amount, 0);
  const totalOwing = FRIENDS.filter(f => f.dir === "you_owe").reduce((a, f) => a + f.amount, 0);
  const net = totalOwed - totalOwing;
  const isPos = net >= 0;

  return (
    <div style={{ height:"100%", overflowY:"auto", background:C.bg, scrollbarWidth:"none" }}>

      {/* ── App header ── */}
      <div style={{ display:"flex", alignItems:"center", padding:"16px 20px 12px", gap:12 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, flex:1 }}>
          <div style={{ width:28, height:28, borderRadius:8, background:"#0F0D0B", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <img src={COCONUT_LOGO_SRC} alt="" style={{ width:18, height:18 }} />
          </div>
          <span style={{ fontSize:16, fontWeight:800, color:C.label, letterSpacing:"-0.3px" }}>Coconut</span>
        </div>
        <motion.button whileTap={{ scale:0.9 }} style={{ width:34, height:34, borderRadius:17, background:C.card2, border:`${C.borderW} solid ${C.stroke}`, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", overflow:"hidden", padding:0 }}>
          <Avatar id="you" size={34} />
        </motion.button>
      </div>

      {/* ── Balance hero card ─�� */}
      <div style={{ padding:"0 16px 18px" }}>
        <div style={{
          borderRadius:C.radius + 10,
          padding:"22px 20px 20px",
          background:C.heroGrad,
          border:`${C.borderW} solid ${C.stroke}`,
          boxShadow: C.isDark ? C.cardGlow : C.sh,
          position:"relative", overflow:"hidden",
        }}>
          {/* Watermark */}
          <div style={{ position:"absolute", right:-24, bottom:-24, opacity: C.isDark ? 0.05 : 0.04, pointerEvents:"none", transform:"rotate(-10deg)" }}>
            <img src={COCONUT_LOGO_SRC} alt="" style={{ width:130, height:130, filter: C.isDark ? undefined : "invert(1)" }} />
          </div>

          <p style={{ fontSize:11, fontWeight:700, color:C.label3, textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:12 }}>
            {isPos ? "You're owed" : "You owe"}
          </p>

          <div style={{ display:"flex", alignItems:"baseline", gap:3, marginBottom:6 }}>
            <span style={{ fontSize:15, fontWeight:700, color:C.label3, alignSelf:"flex-end", marginBottom:8 }}>$</span>
            <span style={{ fontSize:54, fontWeight:900, color: isPos ? C.green : C.red, letterSpacing:"-2.5px", lineHeight:1, fontVariantNumeric:"tabular-nums" }}>
              {Math.abs(net).toFixed(2)}
            </span>
          </div>

          {/* Mini stat pills */}
          <div style={{ display:"flex", gap:10 }}>
            {[
              { label:"Owed to you", amount:totalOwed, color:C.green, icon:<ArrowDownLeft size={11} color={C.green} /> },
              { label:"You owe",     amount:totalOwing, color:C.red,   icon:<ArrowUpRight  size={11} color={C.red}   /> },
            ].map(({ label, amount, color, icon }) => (
              <div key={label} style={{
                flex:1, borderRadius:C.radius,
                padding:"10px 12px",
                background: C.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                border:`1px solid ${C.sep}`,
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:5 }}>
                  {icon}
                  <p style={{ fontSize:10, color:C.label3, fontWeight:500 }}>{label}</p>
                </div>
                <p style={{ fontSize:19, fontWeight:900, color, letterSpacing:"-0.7px", fontVariantNumeric:"tabular-nums" }}>${amount.toFixed(2)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Bank charges ── */}
      {unsplitBank.length > 0 && (
        <div style={{ marginBottom:18 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 20px", marginBottom:12 }}>
            <SectionLabel>From your bank</SectionLabel>
            <button onClick={onSeeAllTx} style={{ border:"none", background:"none", cursor:"pointer", padding:0, marginBottom:10 }}>
              <span style={{ fontSize:13, fontWeight:600, color:C.accent }}>See all</span>
            </button>
          </div>
          <div style={{ display:"flex", gap:10, overflowX:"auto", padding:"0 16px 4px", scrollbarWidth:"none" }}>
            {unsplitBank.map(charge => (
              <motion.div key={charge.id} layout style={{ flexShrink:0, width:152 }}>
                <motion.button whileTap={{ scale:0.96 }} onClick={() => onSelectTx(charge)}
                  style={{ width:"100%", background:C.card, border:`${C.borderW} solid ${charge.email ? C.blue + "40" : C.stroke}`, borderRadius:C.radius + 6, padding:"14px 14px 13px", boxShadow:C.shSm, cursor:"pointer", textAlign:"left", display:"block" }}>
                  {/* Top row */}
                  <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:12 }}>
                    <div style={{ width:40, height:40, borderRadius:C.radius, background:C.card2, display:"flex", alignItems:"center", justifyContent:"center", position:"relative" }}>
                      <MerchantLogo brand={charge.logo} size={26} />
                      {charge.email && <div style={{ position:"absolute", bottom:-3, right:-3, width:14, height:14, borderRadius:7, background:C.blue, display:"flex", alignItems:"center", justifyContent:"center" }}><Mail size={7} color="white" /></div>}
                    </div>
                    <div role="button" tabIndex={0} onClick={e => { e.stopPropagation(); setDismissedBank(d => [...d, charge.id]); }} onKeyDown={e => { if (e.key === "Enter") { e.stopPropagation(); setDismissedBank(d => [...d, charge.id]); } }} style={{ border:"none", background:"none", cursor:"pointer", padding:4, opacity:0.35 }}>
                      <X size={12} color={C.label3} />
                    </div>
                  </div>
                  <p style={{ fontSize:13, fontWeight:700, color:C.label, marginBottom:2 }}>{charge.merchant}</p>
                  <p style={{ fontSize:23, fontWeight:900, color:C.label, letterSpacing:"-1px", marginBottom:13, fontVariantNumeric:"tabular-nums" }}>${charge.amount.toFixed(2)}</p>
                  {/* CTA */}
                  <div style={{ padding:"8px 0", borderRadius:C.radius - 2, background:C.accentBg, border:`1px solid ${C.accent}35`, fontSize:12, fontWeight:800, color:C.accent, textAlign:"center" }}>
                    {charge.email ? "View receipt" : "Split →"}
                  </div>
                </motion.button>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* ── Top Friends & Groups ── */}
      <div style={{ padding:"0 16px 36px" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", paddingRight: 4 }}>
          <SectionLabel>Recent Activity</SectionLabel>
          <button onClick={onSeeActivity} style={{ fontSize:13, fontWeight:700, color:C.accent, border:"none", background:"transparent", cursor:"pointer", marginBottom:10 }}>See all</button>
        </div>
        <Card>
          {[
            { id:"g1", name:"Tahoe Trip", members:4, updated:"2 days ago", balance:-24.00, type:"group" },
            { ...FRIENDS[0], type:"friend" },
            { ...FRIENDS[1], type:"friend" },
          ].map((item: any, i) => {
            const isGroup = item.type === "group";
            const c = !isGroup ? getContact(item.personId) : null;
            const pos = isGroup ? item.balance >= 0 : item.dir === "owes_you";
            const amt = isGroup ? Math.abs(item.balance) : item.amount;
            
            return (
              <div key={item.id || item.personId}>
                <motion.button whileTap={{ scale:0.99 }} onClick={() => isGroup ? onGroup(GROUPS.find(g => g.id === item.id)!) : onFriend(item)}
                  style={{ width:"100%", display:"flex", alignItems:"center", gap:13, padding:"15px 16px", background:"transparent", border:"none", cursor:"pointer", textAlign:"left" }}>
                  {isGroup ? (
                    <div style={{ width:44, height:44, borderRadius:14, background:C.accent+"15", border:`1px solid ${C.accent}30`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <Users size={20} color={C.accent} />
                    </div>
                  ) : (
                    <Avatar id={item.personId} size={44} />
                  )}
                  
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontSize:15, fontWeight:700, color:C.label }}>{isGroup ? item.name : c?.full}</p>
                    <p style={{ fontSize:12, color:C.label3, marginTop:2 }}>
                      {isGroup 
                        ? `${item.members} members · ${item.updated}` 
                        : `${pos ? "owes you" : "you owe"} · ${item.expenses.length} expense${item.expenses.length !== 1 ? "s" : ""}`
                      }
                    </p>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <p style={{ fontSize:17, fontWeight:900, color: pos ? C.green : C.red, letterSpacing:"-0.6px", fontVariantNumeric:"tabular-nums" }}>
                      {pos ? "+" : "−"}${amt.toFixed(2)}
                    </p>
                    <ChevronRight size={14} color={C.label3} style={{ opacity:0.4, flexShrink:0 }} />
                  </div>
                </motion.button>
                {i < 2 && <Sep ml={73} />}
              </div>
            );
          })}
        </Card>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function ActivityScreen({ onAdd }: { onAdd: () => void }) {
  const C = React.useContext(ThemeCtx);
  const [search, setSearch] = useState("");
  const cfg = {
    settled:     { color: C.green,  fn: (a: ActivityItem) => `Settled with ${getContact(a.personId).name}${a.method ? ` via ${a.method}` : ""}` },
    split_added: { color: C.accent, fn: (a: ActivityItem) => `Split "${a.merchant}" with ${getContact(a.personId).name}` },
    forgotten:   { color: C.amber,  fn: (a: ActivityItem) => `Forgot to split "${a.merchant}"` },
  } as const;

  const filteredActivity = search.trim() 
    ? ACTIVITY.filter(a => 
        (a.merchant && a.merchant.toLowerCase().includes(search.toLowerCase())) || 
        getContact(a.personId).name.toLowerCase().includes(search.toLowerCase()) ||
        a.amount.toString().includes(search)
      )
    : ACTIVITY;

  return (
    <div style={{ height:"100%", overflowY:"auto", background:C.bg, scrollbarWidth:"none" }}>
      {/* Header */}
      <div style={{ padding:"16px 20px 4px" }}>
        <p style={{ fontSize:22, fontWeight:900, color:C.label, letterSpacing:"-0.8px" }}>Activity</p>
      </div>

      {/* Search */}
      <div style={{ padding:"0 20px 12px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"0 14px", background:C.card2, borderRadius:C.radius, border:`${C.borderW} solid ${search ? C.accent + "60" : C.stroke}`, height:44, transition:"border-color 0.2s" }}>
          <Search size={15} color={search ? C.accent : C.label3} style={{ flexShrink:0, transition:"color 0.2s" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search activity…'
            style={{ flex:1, background:"transparent", border:"none", outline:"none", fontSize:13, color:C.label }} />
          {search && <motion.button initial={{ scale:0 }} animate={{ scale:1 }} onClick={() => setSearch("")} style={{ border:"none", background:"none", cursor:"pointer", padding:2, display:"flex" }}><X size={13} color={C.label3} /></motion.button>}
        </div>
      </div>
      <div style={{ padding:"0 16px 28px" }}>
        {/* Missed splits alert */}
        {ACTIVITY.filter(a => a.type === "forgotten").length > 0 && (
          <div style={{ marginBottom:20 }}>
            <SectionLabel>Might have missed</SectionLabel>
            <div style={{ background:C.amberBg, borderRadius:C.radius + 4, border:`1px solid ${C.amber}30`, overflow:"hidden" }}>
              {ACTIVITY.filter(a => a.type === "forgotten").map((item, i) => (
                <div key={item.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 16px", borderTop: i > 0 ? `1px solid ${C.amber}20` : "none" }}>
                  <Avatar id={item.personId} size={36} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontSize:14, fontWeight:700, color:C.label, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.merchant}</p>
                    <p style={{ fontSize:12, color:C.label3 }}>{item.daysAgo}d ago · ${item.amount.toFixed(2)}</p>
                  </div>
                  <motion.button whileTap={{ scale:0.95 }} onClick={onAdd}
                    style={{ border:"none", background:C.amber, color: C.isDark ? "#000" : "#fff", borderRadius:C.radius - 2, padding:"7px 14px", fontSize:12, fontWeight:800, cursor:"pointer", flexShrink:0 }}>
                    Split
                  </motion.button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent activity */}
        <SectionLabel>Recent</SectionLabel>
        {filteredActivity.length === 0 ? (
          <p style={{ fontSize:14, color:C.label3, textAlign:"center", padding:"24px 0" }}>No activity found</p>
        ) : (
          <Card>
            {filteredActivity.map((item, i) => {
              const c = cfg[item.type];
              return (
                <div key={item.id}>
                  <div style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 16px" }}>
                    {/* Color dot */}
                    <div style={{ width:38, height:38, borderRadius:19, background:c.color + "18", border:`1px solid ${c.color}30`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      <div style={{ width:10, height:10, borderRadius:5, background:c.color }} />
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ fontSize:14, fontWeight:500, color:C.label, lineHeight:1.4 }}>{c.fn(item)}</p>
                      <p style={{ fontSize:12, color:C.label3, marginTop:2 }}>{item.date}</p>
                    </div>
                    <p style={{ fontSize:15, fontWeight:800, color: item.type === "settled" ? C.green : C.label, flexShrink:0, fontVariantNumeric:"tabular-nums" }}>
                      {item.type === "settled" ? "+" : ""}${item.amount.toFixed(2)}
                    </p>
                  </div>
                  {i < filteredActivity.length - 1 && <Sep />}
                </div>
              );
            })}
          </Card>
        )}
      </div>
    </div>
  );
}

function AddFriendModal({ onClose }: { onClose: () => void }) {
  const C = React.useContext(ThemeCtx);
  return (
    <>
      <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} onClick={onClose}
        style={{ position:"absolute", inset:0, zIndex:40, background:"rgba(0,0,0,0.6)", backdropFilter:"blur(10px)" }} />
      <motion.div initial={{ y:"100%" }} animate={{ y:0 }} exit={{ y:"100%" }} transition={{ type:"spring", damping:30, stiffness:280 }}
        style={{ position:"absolute", bottom:0, left:0, right:0, zIndex:50, background:C.bg, borderRadius:`${C.radius + 10}px ${C.radius + 10}px 0 0`, border:`${C.borderW} solid ${C.stroke}`, boxShadow:"0 -12px 60px rgba(0,0,0,0.5)", paddingBottom:32, display:"flex", flexDirection:"column" }}>
        <Handle />
        <div style={{ display:"flex", alignItems:"center", padding:"2px 20px 12px", gap:6 }}>
          <p style={{ flex:1, fontSize:17, fontWeight:800, color:C.label, letterSpacing:"-0.3px" }}>Add new</p>
          <button onClick={onClose} style={{ border:"none", background:"none", cursor:"pointer", padding:6 }}><X size={18} color={C.label3} /></button>
        </div>
        <div style={{ padding:"10px 20px" }}>
          <motion.button whileTap={{ scale:0.98 }} onClick={onClose} style={{ width:"100%", padding:"16px", borderRadius:C.radius+2, background:C.card, border:`${C.borderW} solid ${C.stroke}`, display:"flex", alignItems:"center", gap:14, cursor:"pointer", marginBottom:12, boxShadow:C.shSm }}>
            <div style={{ width:40, height:40, borderRadius:20, background:C.accent+"15", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <User size={18} color={C.accent} />
            </div>
            <div style={{ textAlign:"left", flex:1 }}>
              <p style={{ fontSize:15, fontWeight:700, color:C.label }}>Add a friend</p>
              <p style={{ fontSize:12, color:C.label3, marginTop:2 }}>Sync contacts or add by phone</p>
            </div>
          </motion.button>
          
          <motion.button whileTap={{ scale:0.98 }} onClick={onClose} style={{ width:"100%", padding:"16px", borderRadius:C.radius+2, background:C.card, border:`${C.borderW} solid ${C.stroke}`, display:"flex", alignItems:"center", gap:14, cursor:"pointer", boxShadow:C.shSm }}>
            <div style={{ width:40, height:40, borderRadius:20, background:C.accent+"15", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <Users size={18} color={C.accent} />
            </div>
            <div style={{ textAlign:"left", flex:1 }}>
              <p style={{ fontSize:15, fontWeight:700, color:C.label }}>Create a group</p>
              <p style={{ fontSize:12, color:C.label3, marginTop:2 }}>For trips, roommates, or events</p>
            </div>
          </motion.button>
        </div>
      </motion.div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FRIENDS SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function FriendsScreen({ onFriend, onAddGroup, onGroup }: { onFriend: (f: FriendBalance) => void; onAddGroup: () => void; onGroup: (g: GroupData) => void }) {
  const C = React.useContext(ThemeCtx);
  return (
    <div style={{ height:"100%", overflowY:"auto", background:C.bg, scrollbarWidth:"none" }}>
      <div style={{ padding:"16px 20px 12px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <p style={{ fontSize:22, fontWeight:900, color:C.label, letterSpacing:"-0.8px" }}>Friends & Groups</p>
        <button onClick={onAddGroup} style={{ border:"none", background:"none", cursor:"pointer", color:C.accent, fontSize:14, fontWeight:700 }}>
          <Plus size={18} strokeWidth={2.5} />
        </button>
      </div>

      <div style={{ padding:"0 16px 20px" }}>
        <SectionLabel>Groups</SectionLabel>
        <Card>
          {GROUPS.map((g, i) => (
            <div key={g.id}>
              <motion.button whileTap={{ scale:0.99 }} onClick={() => onGroup(g)} style={{ width:"100%", display:"flex", alignItems:"center", gap:13, padding:"15px 16px", background:"transparent", border:"none", cursor:"pointer", textAlign:"left" }}>
                <div style={{ width:44, height:44, borderRadius:14, background:C.accent+"15", border:`1px solid ${C.accent}30`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <Users size={20} color={C.accent} />
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <p style={{ fontSize:15, fontWeight:700, color:C.label }}>{g.name}</p>
                  <p style={{ fontSize:12, color:C.label3, marginTop:2 }}>{g.members.length} members · {g.expenses.length} expenses</p>
                </div>
                <p style={{ fontSize:16, fontWeight:800, color: g.balance >= 0 ? C.green : C.red, fontVariantNumeric:"tabular-nums" }}>
                  {g.balance >= 0 ? "+" : "−"}${Math.abs(g.balance).toFixed(2)}
                </p>
              </motion.button>
              {i < GROUPS.length - 1 && <Sep ml={73} />}
            </div>
          ))}
        </Card>
      </div>

      <div style={{ padding:"0 16px 36px" }}>
        <SectionLabel>All Friends</SectionLabel>
        <Card>
          {FRIENDS.map((friend, i) => {
            const c = getContact(friend.personId);
            const pos = friend.dir === "owes_you";
            return (
              <div key={friend.personId}>
                <motion.button whileTap={{ scale:0.99 }} onClick={() => onFriend(friend)}
                  style={{ width:"100%", display:"flex", alignItems:"center", gap:13, padding:"15px 16px", background:"transparent", border:"none", cursor:"pointer", textAlign:"left" }}>
                  <Avatar id={friend.personId} size={44} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontSize:15, fontWeight:700, color:C.label }}>{c.full}</p>
                    <p style={{ fontSize:12, color:C.label3, marginTop:2 }}>
                      {pos ? "owes you" : "you owe"} · {friend.expenses.length} expense{friend.expenses.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <p style={{ fontSize:17, fontWeight:900, color: pos ? C.green : C.red, letterSpacing:"-0.6px", fontVariantNumeric:"tabular-nums" }}>
                      {pos ? "+" : "−"}${friend.amount.toFixed(2)}
                    </p>
                    <ChevronRight size={14} color={C.label3} style={{ opacity:0.4, flexShrink:0 }} />
                  </div>
                </motion.button>
                {i < FRIENDS.length - 1 && <Sep ml={73} />}
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNT SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function AccountScreen() {
  const C = React.useContext(ThemeCtx);
  const you = getContact("you");
  const rows: Array<{ id: string; title: string; sub: string; Icon: LucideIcon }> = [
    { id: "identity", title: "Profile", sub: "Name, email, phone", Icon: User },
    { id: "banks", title: "Linked banks", sub: "Plaid connection status", Icon: Landmark },
    { id: "privacy", title: "Privacy & security", sub: "Read-only access and data controls", Icon: ShieldCheck },
    { id: "notifications", title: "Notifications", sub: "Payment reminders and split updates", Icon: Mail },
  ];

  return (
    <div style={{ height:"100%", overflowY:"auto", background:C.bg, scrollbarWidth:"none" }}>
      <div style={{ padding:"16px 20px 12px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <p style={{ fontSize:22, fontWeight:900, color:C.label, letterSpacing:"-0.8px" }}>Account</p>
        <button style={{ border:"none", background:"none", cursor:"pointer", color:C.accent, padding:0, marginBottom:2 }}>
          <Sliders size={18} strokeWidth={2.3} />
        </button>
      </div>

      <div style={{ padding:"0 16px 14px" }}>
        <Card style={{ padding:"16px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <Avatar id="you" size={52} />
            <div style={{ minWidth:0 }}>
              <p style={{ fontSize:17, fontWeight:800, color:C.label }}>{you.full.replace(" (paid)", "")}</p>
              <p style={{ fontSize:12, color:C.label3, marginTop:2 }}>{you.email}</p>
            </div>
          </div>
          <div style={{ marginTop:14, display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            <div style={{ border:`${C.borderW} solid ${C.stroke}`, borderRadius:C.radius, background:C.card2, padding:"9px 10px" }}>
              <p style={{ fontSize:10, fontWeight:700, color:C.label3, textTransform:"uppercase", letterSpacing:"0.08em" }}>Plan</p>
              <p style={{ fontSize:13, fontWeight:700, color:C.label, marginTop:2 }}>Free</p>
            </div>
            <div style={{ border:`${C.borderW} solid ${C.stroke}`, borderRadius:C.radius, background:C.card2, padding:"9px 10px" }}>
              <p style={{ fontSize:10, fontWeight:700, color:C.label3, textTransform:"uppercase", letterSpacing:"0.08em" }}>Region</p>
              <p style={{ fontSize:13, fontWeight:700, color:C.label, marginTop:2 }}>US</p>
            </div>
          </div>
        </Card>
      </div>

      <div style={{ padding:"0 16px 36px" }}>
        <SectionLabel>Preferences</SectionLabel>
        <Card>
          {rows.map((r, i) => {
            const RowIcon = r.Icon;
            return (
              <div key={r.id}>
                <button style={{ width:"100%", display:"flex", alignItems:"center", gap:12, padding:"13px 16px", border:"none", background:"transparent", textAlign:"left", cursor:"pointer" }}>
                  <div style={{ width:36, height:36, borderRadius:11, background:C.card2, border:`${C.borderW} solid ${C.stroke}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <RowIcon size={16} color={C.label2} />
                  </div>
                  <div style={{ minWidth:0, flex:1 }}>
                    <p style={{ fontSize:14, fontWeight:700, color:C.label }}>{r.title}</p>
                    <p style={{ fontSize:11, color:C.label3, marginTop:2 }}>{r.sub}</p>
                  </div>
                  <ChevronRight size={15} color={C.label3} style={{ opacity:0.6, flexShrink:0 }} />
                </button>
                {i < rows.length - 1 && <Sep ml={64} />}
              </div>
            );
          })}
        </Card>

        <div style={{ marginTop:14 }}>
          <button style={{ width:"100%", border:`${C.borderW} solid ${C.stroke}`, background:C.card, borderRadius:C.radius + 2, padding:"12px 0", fontSize:14, color:C.label3, fontWeight:700, cursor:"pointer" }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SPLITWISE IMPORT SCREEN
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

function SplitwiseScreen({ onBack }: { onBack: () => void }) {
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

function wait(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
// PHONE FRAME
// ─────────────────────────────────────────────────────────────────────────────
function PhoneFrame({ children }: { children: React.ReactNode }) {
  const C = React.useContext(ThemeCtx);
  return (
    <div style={{ position:"relative", width:393, height:852, flexShrink:0 }}>
      {/* Physical buttons */}
      {[{ top:128, h:34, side:"left" },{ top:178, h:64, side:"left" },{ top:254, h:64, side:"left" },{ top:158, h:80, side:"right" }].map((b, i) => (
        <div key={i} style={{ position:"absolute", top:b.top, height:b.h, width:4, [b.side]:-4, borderRadius:b.side==="left"?"2px 0 0 2px":"0 2px 2px 0", background:"#242020" }} />
      ))}
      {/* Shadow ring — softer on light Cashmere landing */}
      <div style={{ position:"absolute", inset:-1, borderRadius:55, pointerEvents:"none", zIndex:10,
        boxShadow: C.isDark
          ? "0 0 0 1px rgba(0,0,0,0.10), 0 28px 80px rgba(0,0,0,0.24), 0 60px 160px rgba(0,0,0,0.16)"
          : "0 0 0 1px rgba(43,42,41,0.08), 0 32px 72px rgba(43,42,41,0.14), 0 56px 140px rgba(43,42,41,0.08)" }} />
      {/* Frame bezel */}
      <div style={{ position:"absolute", inset:0, borderRadius:54, overflow:"hidden", background: C.isDark ? "#1A1510" : "#3d3835", boxShadow:"inset 0 0 0 1px rgba(255,255,255,0.10)", transform:"translateZ(0)" }}>
        <div style={{ position:"absolute", inset:5, borderRadius:49, overflow:"hidden", background:C.bg, transform:"translateZ(0)", WebkitMaskImage:"-webkit-radial-gradient(white, black)" }}>
          {children}
          {/* iOS Home Indicator */}
          <div style={{ position:"absolute", bottom:8, left:"50%", transform:"translateX(-50%)", width:134, height:5, borderRadius:3, background:C.label, zIndex:999, opacity:0.8 }} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Apple mark — path from Simple Icons (MIT), v11.4+ single-path body + leaf
// (Older inline path used a wrong leaf segment and drew a broken silhouette.)
// ─────────────────────────────────────────────────────────────────────────────
function AppleLogo({ size = 22, color = "currentColor" }: { size?: number; color?: string }) {
  const px = Math.max(12, Math.round(size));
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill={color}
      aria-hidden
      focusable="false"
      shapeRendering="geometricPrecision"
      style={{ flexShrink: 0, display: "block" }}
    >
      <path
        fillRule="nonzero"
        d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
      />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LANDING PAGE DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────
/** Landing chrome — aligned to Coconut-MVP `coconut_cashmere` (warm paper, charcoal type) */
const LP = {
  bg: "#f8f5f2",
  bgCard: "#ffffff",
  border: "#e8e1da",
  text: "#2b2a29",
  textSoft: "#4a4846",
  textMuted: "#8a8682",
  gold: "#2b2a29",
  goldBg: "#f0ebe6",
  goldBorder: "#e8e1da",
  navBg: "rgba(248,245,242,0.92)",
  shadow: "0 4px 24px rgba(43,42,41,0.05), 0 1px 4px rgba(43,42,41,0.03)",
  shadowMd: "0 8px 32px rgba(43,42,41,0.07), 0 2px 8px rgba(43,42,41,0.04)",
};

// ─────────────────────────────────────────────────────────────────────────────
// THEME ORDER
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE — landing is Cashmere-only (no theme switcher)
// ─────────────────────────────────────────────────────────────────────────────
const LANDING_THEME = THEMES.coconut_cashmere;

export function CoconutMobileMarketingPage() {
  const C = LANDING_THEME;

  /** Responsive layout controls for landing hero + demo frame */
  const [phoneScale, setPhoneScale] = useState(0.92);
  const [viewportW, setViewportW] = useState(1440);
  const isMobile = viewportW < 900;
  const isNarrowMobile = viewportW < 520;
  const isTablet = viewportW >= 900 && viewportW < 1180;
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      setViewportW(w);
      const targetH = window.innerHeight - (w < 900 ? 120 : 180);
      const raw = targetH / 852;
      const floor = w < 900 ? 0.54 : 0.82;
      const ceil = w < 900 ? 0.78 : 1;
      setPhoneScale(Math.min(ceil, Math.max(floor, raw)));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const [screen, setScreen] = useState<"home"|"friends"|"activity"|"account"|"splitwise">("home");
  const [friendDetail, setFriendDetail] = useState<FriendBalance|null>(null);
  const [groupDetail, setGroupDetail] = useState<GroupData|null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showReceiptScan, setShowReceiptScan] = useState(false);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [showAllTx, setShowAllTx] = useState(false);
  const [prefill, setPrefill] = useState<DemoPrefill | undefined>();
  const [settleTarget, setSettleTarget] = useState<{ personId: PersonId; amount: number }|null>(null);
  const [selectedTx, setSelectedTx] = useState<BankTx|null>(null);
  const [activeFeature, setActiveFeature] = useState<number | null>(null);
  const [tapToPayDemoState, setTapToPayDemoState] = useState<"idle" | "processing" | "accepted">("idle");
  const tapToPayDemoTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (tapToPayDemoTimerRef.current !== null) window.clearTimeout(tapToPayDemoTimerRef.current);
    };
  }, []);

  const handleSettle = (personId: PersonId, amount: number) => {
    setShowAdd(false);
    setShowAddMenu(false);
    setShowReceiptScan(false);
    setFriendDetail(null);
    setSettleTarget({ personId, amount });
  };
  /** No prefill → same as app FAB: pick Add expense vs Scan receipt. With prefill → open split flow directly. */
  const handleAdd = (pf?: DemoPrefill) => {
    if (pf) {
      setShowAddMenu(false);
      setShowReceiptScan(false);
      setPrefill(pf);
      setShowAdd(true);
    } else {
      setShowAddMenu(true);
    }
  };
  const continueReceiptToSplit = (payload: {
    merchant: string;
    amount: number;
    receiptSplit?: { people: PersonId[]; splits: Record<PersonId, number>; paidBy: PersonId };
  }) => {
    setShowReceiptScan(false);
    if (payload.receiptSplit) {
      setPrefill({
        merchant: payload.merchant,
        amount: payload.amount,
        people: payload.receiptSplit.people,
        splits: payload.receiptSplit.splits,
        paidBy: payload.receiptSplit.paidBy,
        skipToConfirm: true,
      });
    } else {
      setPrefill({ merchant: payload.merchant, amount: payload.amount });
    }
    setShowAdd(true);
  };

  /** Close every sheet/modal and return to Home so feature demos never stack or overlap */
  const resetPhoneDemo = React.useCallback(() => {
    setScreen("home");
    setFriendDetail(null);
    setShowAdd(false);
    setShowAddMenu(false);
    setShowReceiptScan(false);
    setPrefill(undefined);
    setShowAddFriend(false);
    setShowAllTx(false);
    setSettleTarget(null);
    setSelectedTx(null);
  }, []);

  /** ms after reset for AnimatePresence to unmount previous overlays before opening the next */
  const DEMO_OPEN_MS = 140;
  const demoScheduleRef = useRef(0);
  const scheduleDemoOpen = React.useCallback((fn: () => void) => {
    const id = ++demoScheduleRef.current;
    window.setTimeout(() => {
      if (demoScheduleRef.current !== id) return;
      fn();
    }, DEMO_OPEN_MS);
  }, []);

  const triggerTapToPayDemo = () => {
    if (tapToPayDemoState === "processing") return;
    if (tapToPayDemoState === "accepted") {
      setTapToPayDemoState("idle");
      return;
    }
    setTapToPayDemoState("processing");
    tapToPayDemoTimerRef.current = window.setTimeout(() => {
      setTapToPayDemoState("accepted");
      tapToPayDemoTimerRef.current = null;
    }, 900);
  };

  const features: Array<{
    Icon: LucideIcon;
    label: string;
    tag: string;
    demo: () => void;
  }> = [
    {
      Icon: Nfc,
      label: "Collect in person, instantly",
      tag: "Tap to Pay",
      demo: () => {
        resetPhoneDemo();
        scheduleDemoOpen(() => handleSettle("alex", 86.0));
      },
    },
    {
      Icon: Landmark,
      label: "Every charge, auto-imported",
      tag: "Bank connection",
      demo: () => {
        resetPhoneDemo();
        scheduleDemoOpen(() => {
          setShowAllTx(true);
        });
      },
    },
    {
      Icon: Mail,
      label: "Itemized splits, zero effort",
      tag: "Email receipts",
      demo: () => {
        resetPhoneDemo();
        scheduleDemoOpen(() => {
          const tx = ALL_BANK_TX.find((t) => t.id === "b3")!;
          setSelectedTx(tx);
        });
      },
    },
    {
      Icon: ScanLine,
      label: "Snap a photo, split the bill",
      tag: "Receipt scan",
      demo: () => {
        resetPhoneDemo();
        scheduleDemoOpen(() => setShowReceiptScan(true));
      },
    },
  ];

  return (
    <ThemeCtx.Provider value={C}>
      <div style={{ minHeight:"100vh", background:LP.bg, fontFamily:"-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', sans-serif" }}>

        {/* Ambient blobs */}
        <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:0, overflow:"hidden" }}>
          <div style={{ position:"absolute", top:-240, right:-120, width:900, height:900, borderRadius:"50%", background:"radial-gradient(circle, rgba(58,125,68,0.06) 0%, transparent 68%)" }} />
          <div style={{ position:"absolute", bottom:-280, left:-160, width:880, height:880, borderRadius:"50%", background:"radial-gradient(circle, rgba(248,245,242,0.9) 0%, transparent 55%)" }} />
        </div>

        {/* ══ NAV ══ */}
        <nav style={{
          position:"sticky", top:0, zIndex:100,
          background:LP.navBg, backdropFilter:"blur(28px) saturate(1.8)",
          WebkitBackdropFilter:"blur(28px) saturate(1.8)",
          borderBottom:`1px solid ${LP.border}`,
          display:"flex", alignItems:"center",
          padding: isMobile ? "0 14px" : "0 40px", height:66,
        }}>
          {/* Brand */}
          <div style={{ display:"flex", alignItems:"center", gap:10, flex:1 }}>
            <div style={{ width:36, height:36, borderRadius:11, background:"#0F0D0B", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, boxShadow:"0 2px 10px rgba(15,13,11,0.30)" }}>
              <img src={COCONUT_LOGO_SRC} alt="Coconut" style={{ width:22, height:22, borderRadius: 4, objectFit: "cover" }} />
            </div>
            <span style={{ fontSize:isMobile ? 17 : 18, fontWeight:800, color:LP.text, letterSpacing:"-0.5px" }}>Coconut</span>
          </div>

          <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", flexWrap:"wrap", gap:8 }}>
            <button
              type="button"
              onClick={() => {}}
              style={{
                display:"inline-flex",
                alignItems:"center",
                gap:8,
                border:"1px solid rgba(58, 125, 68, 0.22)",
                background:LP.bgCard,
                padding:"10px 16px",
                borderRadius:12,
                fontSize:12,
                fontWeight:800,
                color:LP.text,
                boxShadow:"0 8px 24px rgba(43, 42, 41, 0.07), 0 2px 8px rgba(58, 125, 68, 0.06)",
                letterSpacing:"-0.02em",
                lineHeight:1.25,
                maxWidth:"min(100%, 220px)",
                textAlign:"left",
                cursor:"pointer",
              }}
            >
              <AppleLogo size={18} color={LP.text} />
              {isMobile ? "Get app" : "App Store"}
            </button>
          </div>
        </nav>

        {/* ══ HERO ══ */}
        <div style={{
          display:"flex",
          alignItems: isMobile ? "center" : "center",
          justifyContent:"center",
          flexDirection:isMobile ? "column" : "row",
          gap:isMobile ? 20 : 64,
          padding:isMobile ? "20px 18px 28px" : "0 clamp(48px, 6vw, 120px)",
          maxWidth: 1400,
          margin:"0 auto",
          minHeight:isMobile ? "auto" : "calc(100vh - 66px)",
          position:"relative", zIndex:1,
          overflow: isMobile ? "visible" : "hidden",
        }}>

          {/* ── LEFT: Copy + pills ── */}
          <div style={{
            flex: isMobile ? "unset" : "1 1 0",
            minWidth: 0,
            maxWidth: isMobile ? "100%" : "none",
            padding: isMobile ? 0 : "40px 0",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: isMobile ? "center" : "flex-start",
            textAlign: isMobile ? "center" : "left",
          }}>

            {/* CTA — first thing, stands out */}
            <motion.div
              initial={{ opacity:0, y:10 }}
              animate={{ opacity:1, y:0 }}
              transition={{ duration:0.4 }}
              style={{ marginBottom: isMobile ? 20 : 36 }}
            >
              <div style={{
                display:"inline-flex", alignItems:"center", gap: isMobile ? 10 : 12,
                padding: isMobile ? "12px 20px" : "16px 32px",
                background:LP.text,
                borderRadius: isMobile ? 14 : 16,
                cursor:"pointer",
                boxShadow:"0 8px 32px rgba(43,42,41,0.22), 0 2px 8px rgba(43,42,41,0.10)",
              }}>
                <AppleLogo size={isMobile ? 18 : 22} color={LP.bg} />
                <span style={{ fontSize:isMobile ? 14 : 18, fontWeight:800, color:LP.bg, letterSpacing:"-0.02em" }}>Download on the App Store</span>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity:0, y:20 }}
              animate={{ opacity:1, y:0 }}
              transition={{ duration:0.55, delay:0.06 }}
            >
              <h1 style={{
                fontSize: isNarrowMobile ? 32 : isMobile ? 38 : isTablet ? 52 : "clamp(4rem, 6vw, 5.5rem)",
                fontWeight: 900,
                color: LP.text,
                lineHeight: isMobile ? 1.05 : 0.98,
                letterSpacing: isMobile ? "-1.2px" : "-4px",
                margin: isMobile ? "0 0 14px" : "0 0 20px",
              }}>
                Splitting dinner{!isMobile && <br />}
                {isMobile && " "}
                <span style={{ color:LP.gold }}>shouldn&apos;t take{!isMobile && <br />}{isMobile && " "}longer than dinner.</span>
              </h1>
              <p style={{ fontSize:isMobile ? 14 : 18, color:LP.textSoft, margin: isMobile ? "0 auto 24px" : "0 0 32px", lineHeight:1.5, maxWidth:isMobile ? 340 : 520 }}>
                One app for bank charges, receipt lines, shared balances, and Tap to Pay when you want the tab closed now
              </p>
            </motion.div>

            {/* Feature pills — desktop only (mobile renders below phone) */}
            {!isMobile && (
              <>
                <motion.div
                  initial={{ opacity:0, y:10 }}
                  animate={{ opacity:1, y:0 }}
                  transition={{ duration:0.45, delay:0.14 }}
                  style={{
                    display:"flex",
                    alignItems:"center",
                    gap: 10,
                    flexWrap:"wrap",
                  }}
                >
                  {features.map((f, i) => {
                    const active = activeFeature === i && screen !== "splitwise";
                    return (
                      <motion.button
                        key={f.tag}
                        type="button"
                        aria-current={active ? "true" : undefined}
                        aria-label={`${f.tag}: ${f.label}. Plays this feature in the phone demo.`}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => {
                          setActiveFeature(i);
                          f.demo();
                        }}
                        style={{
                          display:"flex",
                          alignItems:"center",
                          gap: 9,
                          padding: "12px 22px",
                          borderRadius: 999,
                          cursor:"pointer",
                          background: active ? LP.text : LP.bgCard,
                          border: `1.5px solid ${active ? LP.text : LP.border}`,
                          boxShadow: active ? "0 4px 16px rgba(43,42,41,0.15)" : "0 1px 4px rgba(43,42,41,0.06)",
                          transition:"all 0.2s ease",
                        }}
                      >
                        <f.Icon size={17} color={active ? LP.bg : LP.textMuted} strokeWidth={2} />
                        <span style={{
                          fontSize: 15,
                          fontWeight: active ? 700 : 500,
                          color: active ? LP.bg : LP.textSoft,
                          letterSpacing:"-0.01em",
                          transition:"all 0.2s ease",
                        }}>
                          {f.tag}
                        </span>
                      </motion.button>
                    );
                  })}
                </motion.div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={screen === "splitwise" ? "splitwise" : activeFeature}
                    initial={{ opacity:0, y:6 }}
                    animate={{ opacity:1, y:0 }}
                    exit={{ opacity:0, y:-6 }}
                    transition={{ duration:0.2 }}
                    style={{ marginTop: 14 }}
                  >
                    {screen === "splitwise" ? (
                      <p style={{ fontSize:15, color:LP.textMuted, fontWeight:500, letterSpacing:"-0.01em" }}>Bring your Splitwise history with you</p>
                    ) : activeFeature != null && features[activeFeature] ? (
                      <p style={{ fontSize:15, color:LP.textSoft, fontWeight:500, letterSpacing:"-0.01em" }}>
                        {features[activeFeature].label}
                      </p>
                    ) : null}
                  </motion.div>
                </AnimatePresence>

                <motion.button
                  type="button"
                  initial={{ opacity:0, y:10 }}
                  animate={{ opacity:1, y:0 }}
                  transition={{ duration:0.45, delay:0.22 }}
                  whileHover={{ scale: 1.02, boxShadow: "0 4px 16px rgba(43,42,41,0.12)" }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => { resetPhoneDemo(); setScreen("splitwise"); }}
                  style={{
                    display:"flex",
                    alignItems:"center",
                    justifyContent:"center",
                    gap: 10,
                    marginTop: 24,
                    padding: "14px 32px",
                    borderRadius: 14,
                    cursor:"pointer",
                    background: "#ffffff",
                    border: "2.5px solid #2b2a29",
                    boxShadow: "4px 4px 0px #2b2a29",
                    transition:"all 0.2s ease",
                  }}
                >
                  <ArrowDownLeft size={17} color={LP.text} strokeWidth={2.2} />
                  <span style={{ fontSize:16, fontWeight:700, color:LP.text, letterSpacing:"-0.02em" }}>
                    Import from Splitwise
                  </span>
                  <ChevronRight size={16} color={LP.text} strokeWidth={2} />
                </motion.button>
              </>
            )}
          </div>

          {/* ── RIGHT: Phone demo ── */}
          <div style={{
            flex: isMobile ? "unset" : "0 0 auto",
            display:"flex",
            flexDirection:"column",
            alignItems:"center",
            justifyContent:"center",
            width: isMobile ? "100%" : "auto",
          }}>
            <motion.div
              initial={{ opacity:0 }}
              animate={{ opacity:1 }}
              transition={{ delay:0.8, duration:0.4 }}
              style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}
            >
              <div style={{
                display:"inline-flex", alignItems:"center", gap:7,
                padding:"6px 14px",
                borderRadius:999,
                background:"rgba(61,142,98,0.08)",
                border:"1px solid rgba(61,142,98,0.2)",
              }}>
                <div style={{ position:"relative", width:8, height:8 }}>
                  <motion.div
                    animate={{ scale:[1, 2, 1], opacity:[0.5, 0, 0.5] }}
                    transition={{ duration:2, repeat:Infinity, ease:"easeInOut" }}
                    style={{ position:"absolute", inset:0, borderRadius:"50%", background:"#3D8E62" }}
                  />
                  <div style={{ position:"absolute", inset:0, borderRadius:"50%", background:"#3D8E62" }} />
                </div>
                <span style={{ fontSize:13, fontWeight:700, color:"#3D8E62", letterSpacing:"-0.01em" }}>Live Demo</span>
              </div>
              <span style={{ fontSize:13, color:LP.textMuted }}>· Tap anything</span>
            </motion.div>
            <motion.div initial={{ opacity:0, y:36, scale:0.93 }} animate={{ opacity:1, y:0, scale:1 }}
              transition={{ duration:0.72, delay:0.12, type:"spring", damping:22 }}
              style={{ position:"relative", width:393 * phoneScale, height:852 * phoneScale, flexShrink:0 }}>
              <div style={{ position:"absolute", top:0, left:0, width:393, height:852, transform:`scale(${phoneScale})`, transformOrigin:"0 0" }}>
                <PhoneFrame>
                  {/* Status bar */}
                  <div style={{ position:"absolute", top:0, left:0, right:0, zIndex:30, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 28px 0" }}>
                    <span style={{ fontSize:13, fontWeight:700, color:C.label }}>9:41</span>
                    <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                      <div style={{ display:"flex", alignItems:"flex-end", gap:1.5, height:10 }}>
                        {[4,6,8,10].map((h, i) => <div key={i} style={{ width:3, height:h, borderRadius:1.5, background:C.label, opacity:i===3?0.3:0.8 }} />)}
                      </div>
                      <div style={{ width:24, height:11, borderRadius:3, border:`1.5px solid ${C.label}60`, display:"flex", alignItems:"center", padding:"1.5px" }}>
                        <div style={{ width:"78%", height:"100%", borderRadius:1.5, background:C.label }} />
                      </div>
                    </div>
                  </div>
                  {/* Dynamic island */}
                  <div style={{ position:"absolute", top:12, left:"50%", transform:"translateX(-50%)", zIndex:40, width:118, height:34, borderRadius:20, background:"#000" }} />

                  {/* Screen content */}
                  <div style={{ position:"absolute", inset:0, paddingTop:56, paddingBottom:84, overflow:"hidden" }}>
                    <AnimatePresence mode="wait">
                      <motion.div key={screen} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} transition={{ duration:0.15 }}
                        style={{ position:"absolute", inset:0, paddingTop:56, paddingBottom:84 }}>
                        {screen === "home" && <HomeScreen onSettle={handleSettle} onAdd={handleAdd} onFriend={f => setFriendDetail(f)} onSeeAllTx={() => setShowAllTx(true)} onSelectTx={setSelectedTx} onSeeActivity={() => setScreen("activity")} onGroup={g => setGroupDetail(g)} />}
                        {screen === "friends" && <FriendsScreen onFriend={f => setFriendDetail(f)} onAddGroup={() => setShowAddFriend(true)} onGroup={g => setGroupDetail(g)} />}
                        {screen === "activity" && <ActivityScreen onAdd={() => handleAdd()} />}
                        {screen === "account" && <AccountScreen />}
                        {screen === "splitwise" && <SplitwiseScreen onBack={() => setScreen("home")} />}
                      </motion.div>
                    </AnimatePresence>

                    <AnimatePresence>{friendDetail && <FriendDetail friend={friendDetail} onBack={() => setFriendDetail(null)} onSettle={handleSettle} />}</AnimatePresence>
                    <AnimatePresence>{groupDetail && <GroupDetail group={groupDetail} onBack={() => setGroupDetail(null)} />}</AnimatePresence>
                    <AnimatePresence>{showAllTx && <AllTxSheet onClose={() => setShowAllTx(false)} onSplit={tx => { handleAdd({ merchant:tx.merchant, amount:tx.amount }); setShowAllTx(false); }} />}</AnimatePresence>
                    <AnimatePresence>
                      {showAddMenu && (
                        <AddOptionsSheet
                          onClose={() => setShowAddMenu(false)}
                          onAddExpense={() => {
                            setShowAddMenu(false);
                            setPrefill(undefined);
                            setShowAdd(true);
                          }}
                          onScanReceipt={() => {
                            setShowAddMenu(false);
                            setShowReceiptScan(true);
                          }}
                        />
                      )}
                    </AnimatePresence>
                    <AnimatePresence>
                      {showReceiptScan && (
                        <ReceiptScanModal onClose={() => setShowReceiptScan(false)} onContinueToSplit={continueReceiptToSplit} />
                      )}
                    </AnimatePresence>
                    <AnimatePresence>{showAdd && <AddExpenseModal onClose={() => { setShowAdd(false); setPrefill(undefined); }} onSettle={handleSettle} prefill={prefill} />}</AnimatePresence>
                    <AnimatePresence>{showAddFriend && <AddFriendModal onClose={() => setShowAddFriend(false)} />}</AnimatePresence>
                    <AnimatePresence>{settleTarget && <SettleSheet personId={settleTarget.personId} amount={settleTarget.amount} onClose={() => setSettleTarget(null)} onSettled={() => setSettleTarget(null)} />}</AnimatePresence>
                    <AnimatePresence>{selectedTx && <TxDetailSheet tx={selectedTx} onClose={() => setSelectedTx(null)} onSplit={() => { handleAdd({ merchant:selectedTx.merchant, amount:selectedTx.amount }); setSelectedTx(null); }} />}</AnimatePresence>
                  </div>

                  {/* Tab bar */}
                  <div style={{ position:"absolute", bottom:0, left:0, right:0, zIndex:20, background:C.isDark ? `${C.bg}F0` : `${C.bg}F8`, backdropFilter:"blur(24px)", borderTop:`${C.borderW} solid ${C.stroke}`, display:"flex", alignItems:"center", justifyContent:"space-around", padding:"10px 16px 28px" }}>
                    <button onClick={() => { setScreen("home"); setFriendDetail(null); }} style={{ border:"none", background:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, minWidth:56 }}>
                      <Wallet size={22} color={screen==="home" ? C.accent : C.label3} strokeWidth={screen==="home" ? 2 : 1.5} />
                      <span style={{ fontSize:10, fontWeight:screen==="home"?700:500, color:screen==="home"?C.accent:C.label3 }}>Home</span>
                    </button>
                    <button onClick={() => { setScreen("friends"); setFriendDetail(null); }} style={{ border:"none", background:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, minWidth:56 }}>
                      <Users size={22} color={screen==="friends" ? C.accent : C.label3} strokeWidth={screen==="friends" ? 2 : 1.5} />
                      <span style={{ fontSize:10, fontWeight:screen==="friends"?700:500, color:screen==="friends"?C.accent:C.label3 }}>Friends</span>
                    </button>
                    <motion.button whileTap={{ scale:0.86 }} onClick={() => handleAdd()}
                      style={{ width:56, height:56, borderRadius:28, border:"none", background:C.accent, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", marginTop:-18, boxShadow:`0 6px 24px ${C.accent}65, 0 0 0 6px ${C.accent}18` }}>
                      <Plus size={26} color={C.isDark ? C.bg : "#fff"} strokeWidth={2.5} />
                    </motion.button>
                    <button onClick={() => { setScreen("activity"); setFriendDetail(null); }} style={{ border:"none", background:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, minWidth:56 }}>
                      <Clock size={22} color={screen==="activity" ? C.accent : C.label3} strokeWidth={screen==="activity" ? 2 : 1.5} />
                      <span style={{ fontSize:10, fontWeight:screen==="activity"?700:500, color:screen==="activity"?C.accent:C.label3 }}>Activity</span>
                    </button>
                    <button onClick={() => { setScreen("account"); setFriendDetail(null); }} style={{ border:"none", background:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, minWidth:56 }}>
                      <User size={22} color={screen==="account" ? C.accent : C.label3} strokeWidth={screen==="account" ? 2 : 1.5} />
                      <span style={{ fontSize:10, fontWeight:screen==="account"?700:500, color:screen==="account"?C.accent:C.label3 }}>Account</span>
                    </button>
                  </div>
                </PhoneFrame>
              </div>
            </motion.div>
          </div>

          {/* Feature pills — mobile only, below phone so both visible */}
          {isMobile && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", width:"100%" }}>
              <motion.div
                initial={{ opacity:0, y:10 }}
                animate={{ opacity:1, y:0 }}
                transition={{ duration:0.45, delay:0.14 }}
                style={{
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"center",
                  gap: 6,
                  flexWrap:"wrap",
                }}
              >
                {features.map((f, i) => {
                  const active = activeFeature === i && screen !== "splitwise";
                  return (
                    <div key={f.tag} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:5 }}>
                      <motion.button
                        type="button"
                        aria-current={active ? "true" : undefined}
                        aria-label={`${f.tag}: ${f.label}.`}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => {
                          setActiveFeature(i);
                          f.demo();
                        }}
                        style={{
                          display:"flex",
                          alignItems:"center",
                          gap: 6,
                          padding: isNarrowMobile ? "8px 12px" : "9px 14px",
                          borderRadius: 999,
                          cursor:"pointer",
                          background: active ? LP.text : LP.bgCard,
                          border: `1.5px solid ${active ? LP.text : LP.border}`,
                          boxShadow: active ? "0 4px 16px rgba(43,42,41,0.15)" : "0 1px 4px rgba(43,42,41,0.06)",
                          transition:"all 0.2s ease",
                        }}
                      >
                        <f.Icon size={13} color={active ? LP.bg : LP.textMuted} strokeWidth={2} />
                        <span style={{
                          fontSize: isNarrowMobile ? 12 : 13,
                          fontWeight: active ? 700 : 500,
                          color: active ? LP.bg : LP.textSoft,
                          letterSpacing:"-0.01em",
                          transition:"all 0.2s ease",
                        }}>
                          {f.tag}
                        </span>
                      </motion.button>
                    </div>
                  );
                })}
              </motion.div>
              <AnimatePresence mode="wait">
                <motion.div
                  key={screen === "splitwise" ? "splitwise" : activeFeature}
                  initial={{ opacity:0, y:6 }}
                  animate={{ opacity:1, y:0 }}
                  exit={{ opacity:0, y:-6 }}
                  transition={{ duration:0.2 }}
                  style={{ marginTop:10, textAlign:"center" }}
                >
                  {screen === "splitwise" ? (
                    <p style={{ fontSize:13, color:LP.textMuted, fontWeight:500, letterSpacing:"-0.01em" }}>Bring your Splitwise history with you</p>
                  ) : activeFeature != null && features[activeFeature] ? (
                    <p style={{ fontSize:13, color:LP.textSoft, fontWeight:500, letterSpacing:"-0.01em" }}>
                      {features[activeFeature].label}
                    </p>
                  ) : null}
                </motion.div>
              </AnimatePresence>
              <motion.button
                type="button"
                initial={{ opacity:0, y:10 }}
                animate={{ opacity:1, y:0 }}
                transition={{ duration:0.45, delay:0.22 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => { resetPhoneDemo(); setScreen("splitwise"); }}
                style={{
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"center",
                  gap: 8,
                  marginTop: 18,
                  padding: isNarrowMobile ? "11px 22px" : "12px 26px",
                  borderRadius: 12,
                  cursor:"pointer",
                  background: "#ffffff",
                  border: "2.5px solid #2b2a29",
                  boxShadow: "4px 4px 0px #2b2a29",
                  transition:"all 0.2s ease",
                }}
              >
                <ArrowDownLeft size={14} color={LP.text} strokeWidth={2.2} />
                <span style={{ fontSize: isNarrowMobile ? 13 : 14, fontWeight:700, color:LP.text, letterSpacing:"-0.02em" }}>
                  Import from Splitwise
                </span>
                <ChevronRight size={14} color={LP.text} strokeWidth={2} />
              </motion.button>
            </div>
          )}
        </div>

        {/* ══ FOOTER ══ */}
        <footer style={{
          borderTop:`1px solid ${LP.border}`,
          padding: isMobile ? "20px 18px" : "24px 40px",
          display:"flex",
          alignItems: isMobile ? "center" : "center",
          justifyContent: isMobile ? "center" : "space-between",
          flexDirection: isMobile ? "column" : "row",
          gap: isMobile ? 12 : 0,
          position:"relative", zIndex:1,
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:9 }}>
            <div style={{ width:26, height:26, borderRadius:8, background:"#0F0D0B", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <img src={COCONUT_LOGO_SRC} alt="" style={{ width:16, height:16, borderRadius: 3, objectFit: "cover" }} />
            </div>
            <span style={{ fontSize:13, fontWeight:700, color:LP.textSoft }}>Coconut</span>
          </div>
          <p style={{ fontSize:12, color:LP.textMuted, textAlign:"center" }}>© 2026 Coconut. Made for people who split things.</p>
          <div style={{ display:"flex", gap:20 }}>
            {["Privacy", "Terms", "Contact"].map(l => (
              <button key={l} style={{ border:"none", background:"none", fontSize:12, color:LP.textMuted, cursor:"pointer", padding:0 }}>{l}</button>
            ))}
          </div>
        </footer>
      </div>
    </ThemeCtx.Provider>
  );
}
