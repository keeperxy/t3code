import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { findTaskUsageFence, TaskUsageReadReportResult } from "./taskUsage.ts";

const taskId = "20260930-orchestrator-totals-2qftombj";
const body = `{"version":1,"taskId":"${taskId}","closingTurnId":"turn-a"}`;
const fence = `\`\`\`t3-task-usage\n${body}\n\`\`\``;

describe("findTaskUsageFence", () => {
  it("finds one closed top-level reference and its exact span", () => {
    const text = `Implemented the table.\n\n${fence}\n\nThanks.`;
    const found = findTaskUsageFence(text);
    expect(found?.taskId).toBe(taskId);
    expect(text.slice(found!.start, found!.end)).toBe(`${fence}\n`);
    expect(findTaskUsageFence(fence)?.start).toBe(0);
    expect(findTaskUsageFence(`Done.\r\n\r\n${fence.replaceAll("\n", "\r\n")}`)?.taskId).toBe(
      taskId,
    );
  });

  it("leaves quoted, nested, indented, and unclosed fences as ordinary code", () => {
    const quoted = fence
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const cases = [
      quoted,
      `- item\n\n  ${fence.replaceAll("\n", "\n  ")}`,
      `    ${fence.replaceAll("\n", "\n    ")}`,
      `\`\`\`\`markdown\n\n${fence}\n\`\`\`\``,
      `~~~\n\n${fence}\n~~~`,
      `<!--\n\n${fence}\n-->`,
      ...["pre", "script", "style", "textarea"].map((tag) => `<${tag}>\n\n${fence}\n</${tag}>`),
      `<?instruction\n\n${fence}\n?>`,
      `<!DOCTYPE\n\n${fence}\n>`,
      `<![CDATA[\n\n${fence}\n]]>`,
      `\`\`\`t3-task-usage\n${body}`,
      `\`\`\`t3-task-usage\n${body}\n\n\`\`\``,
      `Paragraph right above.\n${fence}`,
    ];
    for (const text of cases) expect(findTaskUsageFence(text), text).toBeNull();
    // Once the outer block closes, a later reference counts again.
    expect(findTaskUsageFence(`~~~\ncode\n~~~\n\n${fence}`)?.taskId).toBe(taskId);
    expect(findTaskUsageFence(`<!-- note -->\n\n${fence}`)?.taskId).toBe(taskId);
  });

  it("accepts only the strict JSON body", () => {
    const withBody = (json: string) => `\`\`\`t3-task-usage\n${json}\n\`\`\``;
    const rejected = [
      `{"version":2,"taskId":"${taskId}"}`,
      `{"version":1,"taskId":"../escape"}`,
      `{"version":1,"taskId":"."}`,
      `{"version":1,"taskId":"a/b"}`,
      `{"version":1,"taskId":"${taskId}","path":"/tmp"}`,
      `{"version":1}`,
      `{"version":1,"taskId":"${"a".repeat(129)}"}`,
      `{"version":1,"taskId":"${taskId}"}`,
      `{"version":1,"taskId":"${taskId}","closingTurnId":"a/b"}`,
      `{"version":1,"taskId":"${taskId}","closingTurnId":"${"a".repeat(129)}"}`,
      "not json",
    ];
    for (const json of rejected) expect(findTaskUsageFence(withBody(json)), json).toBeNull();
    expect(findTaskUsageFence("```t3-task-usage extra\n" + body + "\n```")).toBeNull();
  });

  it("treats two references as ambiguous", () => {
    expect(findTaskUsageFence(`${fence}\n\n${fence}`)).toBeNull();
  });
});

describe("TaskUsageReadReportResult", () => {
  it("bounds report size", () => {
    const decode = Schema.decodeUnknownSync(TaskUsageReadReportResult);
    const row = { invocation: "a", modelReasoning: "b", totalTokens: "c", elapsed: "d" };
    expect(() =>
      decode({ status: "complete", report: { rows: Array(257).fill(row), notes: [] } }),
    ).toThrow();
    expect(() =>
      decode({
        status: "complete",
        report: { rows: [row, { ...row, invocation: "x".repeat(1025) }], notes: [] },
      }),
    ).toThrow();
    expect(decode({ status: "unavailable", reason: "legacy" })).toEqual({
      status: "unavailable",
      reason: "legacy",
    });
  });
});
