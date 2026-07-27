import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Root: send authenticated users to the dashboard, everyone else to login.
export default async function Home() {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  redirect(data.user ? "/dashboard" : "/login");
}
