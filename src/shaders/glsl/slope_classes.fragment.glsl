#ifdef GL_ES
precision highp float;
#endif
uniform sampler2D u_image;
in highp vec2 v_pos;
uniform float u_breaks[4];
uniform vec4 u_colors[5];
#define SLOPE_MARGIN 0.0025

void main() {
    vec2 size = vec2(textureSize(u_image, 0));
    vec4 pixel = texture(u_image, (v_pos * (size - 2.0) + 1.0) / size);
    float slope = (floor(pixel.r * 255.0 + 0.5) * 256.0 + floor(pixel.g * 255.0 + 0.5)) / 65535.0 * 90.0;
    int cls = 0;
    for (int i = 0; i < 4; i++)
        if (slope >= u_breaks[i] - SLOPE_MARGIN) cls = i + 1;
    fragColor = u_colors[cls];
#ifdef OVERDRAW_INSPECTOR
    fragColor = vec4(1.0);
#endif
}
