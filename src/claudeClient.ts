import Anthropic from "@anthropic-ai/sdk";
import { Macros } from "./types";

const client = new Anthropic();

const SYSTEM_PROMPT =
  "You are a nutrition expert. Estimate macros for the described meal. " +
  "Return ONLY valid JSON matching {calories: number, protein_g: number, carbs_g: number, fat_g: number, fiber_g: number}. " +
  "No other text.";

const MODEL = "claude-sonnet-4-20250514";
const MAX_TEXT_LENGTH = 2000;

function validateBase64(data: string): boolean {
  return /^[A-Za-z0-9+/\n\r]+=*$/.test(data.replace(/\s/g, ""));
}

function parseMacrosResponse(text: string): Macros {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON object found in response");
  }

  const parsed: unknown = JSON.parse(jsonMatch[0]);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).calories !== "number" ||
    typeof (parsed as Record<string, unknown>).protein_g !== "number" ||
    typeof (parsed as Record<string, unknown>).carbs_g !== "number" ||
    typeof (parsed as Record<string, unknown>).fat_g !== "number" ||
    typeof (parsed as Record<string, unknown>).fiber_g !== "number"
  ) {
    throw new Error("Response does not match Macros interface");
  }

  const obj = parsed as Record<string, number>;
  return {
    calories: obj.calories,
    protein_g: obj.protein_g,
    carbs_g: obj.carbs_g,
    fat_g: obj.fat_g,
    fiber_g: obj.fiber_g,
  };
}

export async function estimateMacros(
  text?: string,
  imageBase64?: string,
  mimeType?: string
): Promise<Macros> {
  if (!text && !imageBase64) {
    throw new Error("At least one of text or imageBase64 must be provided");
  }

  const content: Anthropic.MessageCreateParams["messages"][number]["content"] =
    [];

  if (imageBase64) {
    if (!validateBase64(imageBase64)) {
      throw new Error("Invalid base64 image data");
    }
    const mediaType = (mimeType || "image/jpeg") as
      | "image/jpeg"
      | "image/png"
      | "image/gif"
      | "image/webp";
    content.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: imageBase64 },
    });
    content.push({
      type: "text",
      text: text
        ? text.slice(0, MAX_TEXT_LENGTH)
        : "Estimate the macros for this meal.",
    });
  } else if (text) {
    if (text.trim().length === 0) {
      throw new Error("Text input must not be empty");
    }
    content.push({ type: "text", text: text.slice(0, MAX_TEXT_LENGTH) });
  }

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });
  } catch {
    throw new Error("Failed to get macro estimate from API");
  }

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("No text content in API response");
  }

  return parseMacrosResponse(block.text);
}
