import { describe, expect, test } from "vitest";
import { highlightDefinitionSource } from "../src/components/definitionSyntax";

describe("highlightDefinitionSource", () => {
  test("highlights directives, keywords, controls, strings, numbers, and comments", () => {
    const source = `#group Shape
uniform float Radius; slider[0.1,1.0,5.0]
#include "common-primitives.frag"
// comment`;

    const html = highlightDefinitionSource(source);

    expect(html).toContain('<span class="def-token-directive">#group</span>');
    expect(html).toContain('<span class="def-token-keyword">uniform</span>');
    expect(html).toContain('<span class="def-token-keyword">float</span>');
    expect(html).toContain('<span class="def-token-control">slider</span>');
    expect(html).toContain('<span class="def-token-number">0.1</span>');
    expect(html).toContain('<span class="def-token-string">&quot;common-primitives.frag&quot;</span>');
    expect(html).toContain('<span class="def-token-comment">// comment</span>');
  });

  test("escapes html content safely", () => {
    const source = "uniform float A; // <script>alert(1)</script>";
    const html = highlightDefinitionSource(source);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
