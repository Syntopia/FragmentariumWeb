#version 330 core

out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec3 c = vec3(uv.x, uv.y, 0.5 + 0.5 * sin(uTime));
  fragColor = vec4(c, 1.0);
}
