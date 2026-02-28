"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff, Shield, Lock } from "lucide-react";
import { motion } from "motion/react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setTimeout(() => {
      router.push("/connect");
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-[#F7FAF8] flex flex-col">
      <div className="px-8 py-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#3D8E62] flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2C7 2 3 4.5 3 8C3 10.2 4.8 12 7 12C9.2 12 11 10.2 11 8C11 4.5 7 2 7 2Z" fill="white" fillOpacity="0.9"/>
              <path d="M7 5C7 5 5 6.5 5 8.5C5 9.6 5.9 10.5 7 10.5" stroke="white" strokeWidth="0.8" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="text-[15px] font-semibold text-gray-900 tracking-tight">Coconut</span>
        </Link>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight mb-1.5">
                {isSignUp ? "Create your account" : "Welcome back"}
              </h1>
              <p className="text-sm text-gray-500">
                {isSignUp
                  ? "Start understanding your money in minutes."
                  : "Sign in to your Coconut account."}
              </p>
            </div>

            <button className="w-full flex items-center justify-center gap-3 border border-gray-200 rounded-xl py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors mb-5">
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
                <path d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="flex-1 h-px bg-gray-100" />
              <span className="text-xs text-gray-400">or</span>
              <div className="flex-1 h-px bg-gray-100" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62] transition-all"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-700">Password</label>
                  {!isSignUp && (
                    <button type="button" className="text-xs text-[#3D8E62] hover:underline">Forgot password?</button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 pr-10 text-sm border border-gray-200 rounded-xl bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62] transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-[#3D8E62] hover:bg-[#2D7A52] disabled:opacity-70 text-white py-2.5 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2 mt-2"
              >
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  "Continue"
                )}
              </button>
            </form>

            <div className="flex items-center justify-center gap-4 mt-6 pt-6 border-t border-gray-100">
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <Shield size={12} className="text-[#3D8E62]" />
                Bank-level encryption
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <Lock size={12} className="text-[#3D8E62]" />
                Read-only access
              </div>
            </div>
          </div>

          <p className="text-center text-sm text-gray-500 mt-5">
            {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-[#3D8E62] font-medium hover:underline"
            >
              {isSignUp ? "Sign in" : "Sign up free"}
            </button>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
