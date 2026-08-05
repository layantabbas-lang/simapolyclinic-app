// Manual WhatsApp notification -- no provider, no API, no credentials.
// Staff press a button, WhatsApp opens with the message already written,
// and they press send themselves. Nothing is ever sent automatically.

const DEFAULT_COUNTRY_CODE = "961"; // Lebanon

/**
 * Turns a locally-written number into the digits-only international form
 * wa.me needs: no +, no spaces, no dashes, no leading zero.
 *
 *   "03 332 486"     -> 9613332486
 *   "+961 3 332 486" -> 9613332486
 *   "0096170123456"  -> 96170123456
 *
 * Returns null when there aren't enough digits to be a real number, so
 * callers can disable the button rather than open a broken chat.
 */
export function toWhatsAppNumber(
  raw: string | null | undefined,
  countryCode: string = DEFAULT_COUNTRY_CODE
): string | null {
  if (!raw) return null;

  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  // 00 is the international prefix written out; it means the country
  // code already follows, so just drop it.
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith(countryCode)) {
    // Already international -- leave it alone.
  } else {
    // Local form: a single leading 0 is the national trunk prefix and is
    // dropped when the country code goes on.
    digits = digits.replace(/^0+/, "");
    digits = countryCode + digits;
  }

  // Shortest plausible international number is ~8 digits; longest is 15
  // (E.164). Anything outside that is a typo, not a number.
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export interface BookingMessageValues {
  name: string;
  date: string;
  time: string;
  doctor: string;
  clinic: string;
  phone: string;
  address: string;
}

export const DEFAULT_WHATSAPP_TEMPLATE =
  `Hello {{name}}, your appointment at {{clinic}} is confirmed for {{date}} at {{time}} with {{doctor}}.

Please arrive 10 minutes early and bring your ID.

{{address}}
{{phone}}`;

/** Fills {{placeholders}}; unknown ones are left visible rather than
 *  silently blanked, so a typo in a custom template is obvious. */
export function fillTemplate(template: string, values: Partial<BookingMessageValues>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const v = (values as any)[key];
    return v === undefined || v === null || v === "" ? match : String(v);
  });
}

/**
 * Builds the wa.me link that opens WhatsApp with the message pre-typed.
 * Nothing is sent -- the staff member still presses send.
 */
export function buildWhatsAppLink(
  phone: string | null | undefined,
  message: string,
  countryCode?: string
): string | null {
  const number = toWhatsAppNumber(phone, countryCode);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
