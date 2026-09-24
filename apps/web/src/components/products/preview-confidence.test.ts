import type { PagePreview } from "@drop-watch/api/routers/preview";
import { describe, expect, it } from "vitest";

import {
  automaticPreviewNeedsRepair,
  automaticPreviewRepairMessage,
  previewSelection,
} from "./preview-confidence";

function preview(overrides: Record<string, unknown> = {}): PagePreview {
  return {
    extraction: {
      availability: null,
      confidence: "low",
      currency: "GBP",
      evidence: { candidateCount: 2, type: "jsonld:multiple-candidates" },
      imageUrl: null,
      inStock: true,
      price: "12.00",
      strategy: "jsonld",
      title: "Thing",
    },
    extractionError: null,
    htmlBytes: 100,
    httpStatus: 200,
    previewId: "preview-id",
    render: "http",
    url: "https://example.com/thing",
    ...overrides,
  } as PagePreview;
}

describe("automatic preview confidence guard", () => {
  it("requires repair for a low-confidence automatic result", () => {
    expect(automaticPreviewNeedsRepair(preview())).toBe(true);
    expect(automaticPreviewRepairMessage(preview())).toContain("low-confidence");
  });

  it("allows an explicitly high-confidence automatic result", () => {
    expect(
      automaticPreviewNeedsRepair(
        preview({
          extraction: {
            ...preview().extraction,
            confidence: "high",
            evidence: { candidateCount: 1, type: "jsonld:singleton" },
          },
        })
      )
    ).toBe(false);
  });

  it("retains low-confidence multiple-candidate rejection", () => {
    expect(automaticPreviewNeedsRepair(preview())).toBe(true);
    expect(automaticPreviewRepairMessage(preview())).toContain("low-confidence");
  });

  it("allows a high-confidence selected SKU among multiple candidates", () => {
    expect(
      automaticPreviewNeedsRepair(
        preview({
          extraction: {
            ...preview().extraction,
            confidence: "high",
            evidence: { candidateCount: 3, type: "jsonld:selected-sku" },
          },
        })
      )
    ).toBe(false);
  });

  it("keeps the automatic requirement inherent to the preview", () => {
    const lowConfidence = preview();
    const baseExtraction = lowConfidence.extraction;
    if (!baseExtraction) {
      throw new Error("test preview should contain an extraction");
    }
    const manualExtraction = {
      ...baseExtraction,
      confidence: "high" as const,
      evidence: { matchCount: 1, type: "selector:configured" as const },
      strategy: "selector" as const,
    };
    const selection = previewSelection({
      manualExtraction,
      mode: "selector",
      preview: lowConfidence,
    });

    expect(selection.automaticRepairRequired).toBe(true);
    expect(selection.chosen).toBe(manualExtraction);
  });

  it("allows high-confidence automatic previews to restore automatic mode", () => {
    const highConfidence = preview({
      extraction: {
        ...preview().extraction,
        confidence: "high",
        evidence: { candidateCount: 1, type: "jsonld:singleton" },
      },
    });
    const selection = previewSelection({
      manualExtraction: null,
      mode: null,
      preview: highConfidence,
    });

    expect(selection.automaticRepairRequired).toBe(false);
    expect(selection.chosen).toBe(highConfidence.extraction);
  });

  it("keeps an empty automatic extraction in the manual path", () => {
    expect(automaticPreviewNeedsRepair(preview({ extraction: null }))).toBe(true);
  });
});
