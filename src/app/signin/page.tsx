import { Suspense } from "react";
import { SignInForm } from "@/components/SignInForm";

export const metadata = { title: "Sign In · Budget Claude" };

export default function SignInPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <Suspense>
        <SignInForm />
      </Suspense>
    </main>
  );
}
