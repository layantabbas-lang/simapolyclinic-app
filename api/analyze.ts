// Vercel serverless function (Node runtime). Auto-detected from this file's
// path under /api -- no framework config needed on top of the Vite build.
//
// Ported from medical-document-analyzer/server.ts's /api/analyze route.
// Request/response are loosely typed rather than importing @vercel/node,
// which pulls in a chain of dev-tooling dependencies (Python/YAML config
// analysis) with several unrelated ReDoS advisories in *their* transitive
// deps -- none of that runs here, so it's simpler to skip installing it
// than to carry the extra audit surface for two type names. Same
// simplicity-over-strict-typing trade SIMA's own server.ts already made
// for this kind of internal endpoint.
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

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

let anthropicClient: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured on the server.");
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

// Verifies the caller's Supabase access token (Authorization: Bearer <jwt>,
// attached client-side by authedFetch in src/supabaseClient.ts).
async function getVerifiedUser(req: any) {
  const authHeader = req.headers?.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

const extractionTool = {
  name: "record_medical_analysis",
  description: "Records the structured extraction of a medical document.",
  input_schema: {
    type: "object" as const,
    properties: {
      document_metadata: {
        type: "object",
        properties: {
          document_type: {
            type: "string",
            description: "Must be exactly one of: 'Blood Test', 'CT Scan', 'MRI', 'X-Ray', 'Clinic Notes', 'Other'",
          },
          date_of_report: {
            type: "string",
            description: "In YYYY-MM-DD format (if found), otherwise null.",
          },
          facility_or_laboratory_name: {
            type: "string",
            description: "Name of clinic, hospital, or laboratory if found, otherwise null.",
          },
        },
        required: ["document_type", "date_of_report", "facility_or_laboratory_name"],
      },
      extracted_data: {
        type: "object",
        properties: {
          quantitative_results: {
            type: "array",
            items: {
              type: "object",
              properties: {
                parameter_name: { type: "string", description: "The name of the metric or lab test, e.g. Hemoglobin or TSH" },
                value: { type: "string", description: "The exact numerical or qualitative value recorded" },
                unit: { type: "string", description: "Unit of measurement, e.g. g/dL, mg/dL, or null" },
                reference_range: { type: "string", description: "Normal reference range given, e.g. 12.0 - 16.0 or null" },
                is_abnormal: { type: "boolean", description: "Set to true if value is verified abnormal/out-of-range, false otherwise" },
              },
              required: ["parameter_name", "value", "unit", "reference_range", "is_abnormal"],
            },
          },
          qualitative_findings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                anatomical_site: { type: "string", description: "The anatomical location or system scrutinized, e.g., L4-L5 vertebrae, Left Lung segment, or General" },
                finding_description: { type: "string", description: "Textual summary of the specific medical finding" },
                is_critical: { type: "boolean", description: "Set to true if finding represents a critical, life-threatening, or highly urgent clinical matter" },
              },
              required: ["anatomical_site", "finding_description", "is_critical"],
            },
          },
        },
        required: ["quantitative_results", "qualitative_findings"],
      },
      clinical_summary: {
        type: "string",
        description: "A concise 2-3 sentence clinical synthesis focusing purely on key takeaways and abnormalities for quick overview.",
      },
    },
    required: ["document_metadata", "extracted_data", "clinical_summary"],
  },
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    // This endpoint processes PHI and calls a paid model -- require a
    // valid signed-in user before doing any work.
    const user = await getVerifiedUser(req);
    if (!user) {
      res.status(401).json({ error: "You must be signed in to analyze documents." });
      return;
    }

    const { fileData, mimeType, textData } = req.body || {};

    if (!fileData && !textData) {
      res.status(400).json({ error: "Missing input. Please upload a document or paste medical text to analyze." });
      return;
    }

    let ai: Anthropic;
    try {
      ai = getAnthropicClient();
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Claude client failed to initialize.", needsConfig: true });
      return;
    }

    const content: any[] = [];

    if (fileData && mimeType) {
      const base64Data = String(fileData).replace(/^data:[^;]+;base64,/, "");
      if (mimeType === "application/pdf") {
        content.push({ type: "document", source: { type: "base64", media_type: mimeType, data: base64Data } });
      } else if (String(mimeType).startsWith("image/")) {
        content.push({ type: "image", source: { type: "base64", media_type: mimeType, data: base64Data } });
      }
    }

    let userPrompt = "Please analyze the medical document provided.";
    if (textData) {
      userPrompt += `\n\nAdditionally, here is accompanying text or raw medical transcription:\n${textData}`;
    }
    content.push({ type: "text", text: userPrompt });

    const response = await ai.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      system: `You are an expert medical data extraction assistant. Your job is to extract medical parameters, radiology findings, laboratory values, and metadata from clinical documentation.
Analyze the provided medical attachment (image, PDF, or text/notes) extremely carefully.
Extract quantitative results (like blood tests, panel levels, sugar measurements, numbers with units) and qualitative findings (noted in radiology reports, MRIs, X-rays, or general comments).
Be highly objective and accurate. Ensure "is_abnormal" is true ONLY if the metric value falls outside of the listed reference range or is explicitly flagged.
Ensure "is_critical" is true ONLY if a qualitative finding indicates severe or critical warnings (e.g. malignancy, internal bleeding, severe fractures, or urgent patient risk).
Provide a concise 2-to-3 sentence clinical synthesis of the entire document focused purely on key abnormalities and takeaways for a physician.
Always call the record_medical_analysis tool exactly once with your findings.`,
      messages: [{ role: "user", content }],
      tools: [extractionTool],
      tool_choice: { type: "tool", name: "record_medical_analysis" },
    });

    const toolUseBlock = response.content.find((block: any) => block.type === "tool_use");
    if (!toolUseBlock) {
      throw new Error("No structured response received from Claude.");
    }

    res.status(200).json((toolUseBlock as any).input);
  } catch (error: any) {
    // Log the real error server-side; return a generic message so we don't
    // leak internal/model/DB details to the client.
    console.error("Analysis Error:", error);
    res.status(500).json({ error: "An error occurred during medical document analysis. Please try again." });
  }
}
