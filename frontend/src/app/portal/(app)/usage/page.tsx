"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Usage was merged into the "Usage & Analytics" page.
export default function UsageRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/portal/analytics");
  }, [router]);
  return null;
}
