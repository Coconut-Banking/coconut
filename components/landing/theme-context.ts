/**
 * Shared theme context for the Coconut landing page.
 * Extracted so that lazy-loaded sub-components can import ThemeCtx
 * without pulling the entire marketing page module.
 */
import React from "react";

// ─────────────────────────────────────────────────────────────────────────────
// THEME SYSTEM — 12 distinct premium themes (5 light · 7 dark)
// ─────────────────────────────────────────────────────────────────────────────
export interface Theme {
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

export const THEMES: Record<string, Theme> = {
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
  },
};

export type ThemeKey = keyof typeof THEMES;
export const ThemeCtx = React.createContext<Theme>(THEMES.coconut_cashmere);
