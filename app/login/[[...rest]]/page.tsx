import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { Shield, Lock } from "lucide-react";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const { userId } = await auth();
  if (userId) redirect("/connect");

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

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12 gap-6">
        <SignIn
          routing="path"
          path="/login"
          fallbackRedirectUrl="/connect"
          signUpFallbackRedirectUrl="/connect"
          appearance={{
            variables: {
              colorPrimary: "#3D8E62",
              colorBackground: "#ffffff",
              colorInputBackground: "#ffffff",
              borderRadius: "0.75rem",
            },
            elements: {
              card: "shadow-sm border border-gray-200 rounded-2xl",
              headerTitle: "text-gray-900 font-bold tracking-tight",
              headerSubtitle: "text-gray-500",
              formButtonPrimary:
                "bg-[#3D8E62] hover:bg-[#2D7A52] text-white rounded-xl text-sm font-medium",
              footerActionLink: "text-[#3D8E62] hover:underline font-medium",
              formFieldInput:
                "border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#3D8E62]/20 focus:border-[#3D8E62]",
            },
          }}
        />

        <div className="flex items-center gap-4">
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
    </div>
  );
}
