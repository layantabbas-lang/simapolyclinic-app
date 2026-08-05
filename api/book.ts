// Public appointment-request endpoint (Vercel serverless, Node runtime).
//
// This is the ONLY route in the app an unauthenticated stranger can reach,
// so the rules it enforces are the whole security boundary for the public
// booking page:
//
//   * The browser never gets a database connection. anon stays revoked
//     from the schema (see every migration's trailing `revoke all`), and
//     all reads/writes here go through the service-role key, which lives
//     only in Vercel's env and is never shipped to the client.
//   * It writes to appointment_requests, never to appointments. A stranger
//     cannot put a row in the real book; staff confirming is what does that.
//   * It never reveals whether a phone or name is already a patient.
//     Otherwise the page becomes a tool for checking who is treated here.
//   * Availability is computed in Postgres (app.available_slots) so the
//     response can't leak who else is booked.
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

let supabaseAdmin: any = null;
function getSupabaseAdmin(): any {
  if (!supabaseAdmin) {
    const url = process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_URL) is not configured on the server.");
    }
    supabaseAdmin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return supabaseAdmin;
}

// Requests allowed from one phone number, so the queue can't be flooded.
const MAX_PENDING_PER_PHONE = 3;
const MAX_PER_PHONE_PER_DAY = 5;

const normalisePhone = (raw: string) => (raw || "").replace(/\D/g, "");

// Hashed, not stored raw: counting submissions doesn't require keeping a
// visitor's address. Salted with the service key so the hashes aren't
// reversible via a rainbow table of the IPv4 space.
function hashIp(req: any): string | null {
  const fwd = req.headers?.["x-forwarded-for"];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd || "").split(",")[0].trim();
  if (!ip) return null;
  return createHash("sha256")
    .update(ip + (process.env.SUPABASE_SERVICE_ROLE_KEY || ""))
    .digest("hex")
    .slice(0, 32);
}

export default async function handler(req: any, res: any) {
  const db = (() => {
    try { return getSupabaseAdmin(); } catch { return null; }
  })();
  if (!db) {
    return res.status(503).json({ error: "Online booking isn't configured yet." });
  }

  try {
    // ── Is booking switched on for this clinic?
    const { data: settings } = await db
      .from("clinic_settings")
      .select("clinic_name, phone, address, booking_enabled, timezone")
      .limit(1)
      .maybeSingle();

    if (settings && settings.booking_enabled === false) {
      return res.status(403).json({ error: "Online booking is currently closed. Please call the clinic." });
    }

    // ── GET: the doctors that can be booked, and the free slots for a day.
    if (req.method === "GET") {
      const { doctor_id, date } = req.query || {};

      if (!doctor_id) {
        // Only what a public page legitimately needs to render a picker.
        // No emails, no phone numbers, no licence numbers.
        const { data, error } = await db
          .from("staff")
          .select("id, full_name, specialty, roles")
          .eq("is_active", true)
          .order("full_name");
        if (error) throw error;
        const doctors = (data || [])
          .filter((s: any) => (s.roles || []).includes("doctor"))
          .map((s: any) => ({ id: s.id, name: s.full_name, specialty: s.specialty || null }));
        return res.status(200).json({
          clinic: settings
            ? {
                name: settings.clinic_name,
                phone: settings.phone,
                address: settings.address,
                // So the page shows clinic time, not the visitor's device
                // time -- a patient abroad must still read "08:00".
                timezone: settings.timezone || "Asia/Beirut",
              }
            : null,
          doctors,
        });
      }

      if (!date) return res.status(400).json({ error: "A date is required." });

      const { data, error } = await db.rpc("available_slots", { p_doctor_id: doctor_id, p_date: date });
      if (error) throw error;
      return res.status(200).json({
        slots: (data || []).map((s: any) => ({ start: s.slot_start, end: s.slot_end })),
      });
    }

    // ── POST: submit a request.
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const full_name = String(body.full_name || "").trim();
      const phone = String(body.phone || "").trim();
      const email = String(body.email || "").trim();
      const reason = String(body.reason || "").trim();
      const doctor_id = body.doctor_id || null;
      const requested_at = body.requested_at || null;

      if (full_name.length < 2 || full_name.length > 120) {
        return res.status(400).json({ error: "Please enter your full name." });
      }
      const phoneDigits = normalisePhone(phone);
      if (phoneDigits.length < 7 || phoneDigits.length > 15) {
        return res.status(400).json({ error: "Please enter a valid phone number." });
      }
      if (!requested_at || isNaN(Date.parse(requested_at))) {
        return res.status(400).json({ error: "Please choose an appointment time." });
      }
      if (new Date(requested_at).getTime() < Date.now()) {
        return res.status(400).json({ error: "That time has already passed. Please pick another." });
      }
      if (reason.length > 500) {
        return res.status(400).json({ error: "Please shorten the reason for your visit." });
      }

      // ── Rate limits, by phone.
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: recent } = await db
        .from("appointment_requests")
        .select("id, status, created_at")
        .eq("phone", phone)
        .gte("created_at", since);

      const recentRows = recent || [];
      if (recentRows.length >= MAX_PER_PHONE_PER_DAY) {
        return res.status(429).json({ error: "You've sent several requests today. Please call the clinic instead." });
      }
      if (recentRows.filter((r: any) => r.status === "pending").length >= MAX_PENDING_PER_PHONE) {
        return res.status(429).json({ error: "You already have requests waiting for confirmation. We'll call you shortly." });
      }

      // ── Re-check the slot server-side. The browser was told it was free,
      // but that was some seconds ago and it isn't a source of truth.
      if (doctor_id) {
        const day = new Date(requested_at).toISOString().slice(0, 10);
        const { data: slots } = await db.rpc("available_slots", { p_doctor_id: doctor_id, p_date: day });
        const wanted = new Date(requested_at).getTime();
        const stillFree = (slots || []).some((s: any) => new Date(s.slot_start).getTime() === wanted);
        if (!stillFree) {
          return res.status(409).json({ error: "Sorry, that time was just taken. Please choose another." });
        }
      }

      const { error: insErr } = await db.from("appointment_requests").insert([{
        full_name,
        phone,
        email: email || null,
        reason: reason || null,
        doctor_id,
        requested_at,
        ip_hash: hashIp(req),
      }]);
      if (insErr) throw insErr;

      // Deliberately identical whoever asks: no hint about whether this
      // person is already a patient here.
      return res.status(200).json({
        ok: true,
        message: "Thank you. Your request has been received — the clinic will contact you to confirm.",
      });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  } catch (err: any) {
    console.error("Booking endpoint error:", err);
    // Never surface the raw database error to an anonymous caller.
    return res.status(500).json({ error: "Something went wrong. Please try again, or call the clinic." });
  }
}
