import { describe, expect, test } from "vitest";
import { formatFragmentSource, formatFragmentSourceText } from "../src/core/parser/fragmentFormatter";

describe("fragmentFormatter", () => {
  test("formats indentation, directives, and blank lines conservatively", () => {
    const source = `  #group Test

float DE(vec3 p){
if(p.x>0.0){
return p.x;  // keep inline comment
}


return p.y;
}
`;

    const formatted = formatFragmentSourceText(source);

    expect(formatted).toBe(`#group Test

float DE(vec3 p){
  if(p.x>0.0){
    return p.x;  // keep inline comment
  }

  return p.y;
}
`);
  });

  test("does not use braces inside comments or strings for indentation", () => {
    const source = `float DE(vec3 p){
/* { */
stringLike("{");
// }
return 0.0;
}`;

    const formatted = formatFragmentSourceText(source);

    expect(formatted).toBe(`float DE(vec3 p){
  /* { */
  stringLike("{");
  // }
  return 0.0;
}
`);
  });

  test("preserves preset body lines and reports changed flag", () => {
    const source = `#preset Default
    FOV = 0.6


    Detail = -2.5
#endpreset`;

    const result = formatFragmentSource(source);

    expect(result.changed).toBe(true);
    expect(result.text).toBe(`#preset Default
FOV = 0.6

Detail = -2.5
#endpreset
`);
  });
});
