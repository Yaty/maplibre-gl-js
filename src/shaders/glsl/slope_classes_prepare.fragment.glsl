#ifdef GL_ES
precision highp float;
#endif
uniform sampler2D u_image;
in vec2 v_pos;
uniform vec2 u_dimension;
uniform vec4 u_grid;
uniform vec4 u_unpack;

float getElevation(ivec2 texel) {
    vec4 data = texelFetch(u_image, clamp(texel, ivec2(0), ivec2(u_dimension) - 1), 0) * 255.0;
    data.a = -1.0;
    return dot(data, u_unpack);
}

void main() {
    ivec2 pos = ivec2(gl_FragCoord.xy) + ivec2(1);
    float h[25];
    for (int dy = -2; dy <= 2; dy++)
        for (int dx = -2; dx <= 2; dx++) h[(dy + 2) * 5 + dx + 2] = getElevation(pos + ivec2(dx, dy));
    float m[9];
    for (int y = 0; y < 3; y++)
        for (int x = 0; x < 3; x++) {
            float s = 0.0;
            for (int dy = 0; dy < 3; dy++)
                for (int dx = 0; dx < 3; dx++) s += h[(y + dy) * 5 + x + dx];
            m[y * 3 + x] = u_grid.w > 0.5 ? s / 9.0 : h[(y + 1) * 5 + x + 1];
        }
    float spacing = u_grid.x;
    if (u_grid.z > 0.0) {
        float row = u_grid.y + gl_FragCoord.y;
        float lat = atan(sinh(3.141592653589793 * (1.0 - 2.0 * row / u_grid.z)));
        spacing *= cos(lat);
    }
    float east = ((m[2] + 2.0 * m[5] + m[8]) - (m[0] + 2.0 * m[3] + m[6])) / (8.0 * spacing);
    float north = ((m[0] + 2.0 * m[1] + m[2]) - (m[6] + 2.0 * m[7] + m[8])) / (8.0 * spacing);
    float v = min(ceil(degrees(atan(length(vec2(east, north)))) / 90.0 * 65535.0), 65535.0);
    fragColor = vec4(floor(v / 256.0) / 255.0, mod(v, 256.0) / 255.0, 0.0, 1.0);
#ifdef OVERDRAW_INSPECTOR
    fragColor = vec4(1.0);
#endif
}
