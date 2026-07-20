import { describe, expect, it } from "vitest";
import { readTabularFile } from "./workbookReader.js";
import { MAX_TABULAR_FILE_BYTES } from "./workbookLimits.js";

function mockFile(name: string, size: number, content = ""): File {
  return {
    name,
    size,
    text: async () => content,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as File;
}

describe("workbook reader security boundaries", () => {
  it("rejects files above the assessment size limit before parsing", async () => {
    await expect(readTabularFile(mockFile("large.csv", MAX_TABULAR_FILE_BYTES + 1))).rejects.toThrow("larger than");
  });

  it("rejects legacy binary workbook formats", async () => {
    await expect(readTabularFile(mockFile("legacy.xls", 10))).rejects.toThrow("Save the source as .xlsx or CSV");
    await expect(readTabularFile(mockFile("legacy.xlsb", 10))).rejects.toThrow("Save the source as .xlsx or CSV");
  });

  it("keeps bounded CSV files on the direct text path", async () => {
    const result = await readTabularFile(mockFile("demand.csv", 20, "productId,quantity\np1,10"));
    expect(result.sheetNames).toEqual(["demand.csv"]);
    expect(result.csvBySheet["demand.csv"]).toContain("p1,10");
  });
});
