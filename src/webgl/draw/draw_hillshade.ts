import {Texture} from '../texture.ts';
import {StencilMode} from '../stencil_mode.ts';
import {DepthMode} from '../depth_mode.ts';
import {CullFaceMode} from '../cull_face_mode.ts';
import {
    hillshadeUniformValues,
    hillshadeUniformPrepareValues,
    slopeClassesUniformValues,
    slopeClassesPrepareUniformValues
} from '../program/hillshade_program.ts';

import type {Context} from '../context.ts';
import type {FrameRenderContext} from '../../render/frame_render_context.ts';
import type {ColorMode} from '../color_mode.ts';
import type {Painter} from '../../render/painter.ts';
import type {Tile} from '../../tile/tile.ts';
import type {TileManager} from '../../tile/tile_manager.ts';
import type {HillshadeStyleLayer} from '../../style/style_layer/hillshade_style_layer.ts';
import type {OverscaledTileID} from '../../tile/tile_id.ts';

export function drawHillshade(painter: Painter, tileManager: TileManager, layer: HillshadeStyleLayer, tileIDs: OverscaledTileID[], frameRenderContext: FrameRenderContext): void {
    if (frameRenderContext.currentPass !== 'offscreen' && frameRenderContext.currentPass !== 'translucent') return;

    const context = frameRenderContext.context;
    const {useSubdivision} = frameRenderContext.data;

    const depthMode = frameRenderContext.getDepthModeForSublayer(0, DepthMode.ReadOnly);
    const colorMode = frameRenderContext.colorModeForRenderPass();
    const slopeClasses = layer.paint.get('hillshade-method') === 'slope-classes';
    const prepare = slopeClasses ? prepareSlopeClasses : prepareHillshade;
    const render = slopeClasses ? renderSlopeClasses : renderHillshade;

    if (frameRenderContext.currentPass === 'offscreen') {
        // Prepare tiles
        prepare(painter, tileManager, tileIDs, layer, depthMode, StencilMode.disabled, colorMode, frameRenderContext);
        context.viewport.set([0, 0, painter.width, painter.height]);
    } else if (frameRenderContext.currentPass === 'translucent') {
        // Globe (or any projection with subdivision) needs two-pass rendering to avoid artifacts when rendering texture tiles.
        // See comments in draw_raster.ts for more details.
        if (useSubdivision) {
            // Two-pass rendering
            const [stencilBorderless, stencilBorders, coords] = frameRenderContext.stencilConfigForOverlapTwoPass(tileIDs);
            render(tileManager, layer, coords, stencilBorderless, depthMode, colorMode, false, frameRenderContext); // draw without borders
            render(tileManager, layer, coords, stencilBorders, depthMode, colorMode, true, frameRenderContext); // draw with borders
        } else {
            // Simple rendering
            const [stencil, coords] = frameRenderContext.getStencilConfigForOverlapAndUpdateStencilID(tileIDs);
            render(tileManager, layer, coords, stencil, depthMode, colorMode, false, frameRenderContext);
        }
    }
}

/** Uploads the DEM of the tile on texture unit 1 and leaves unit 0 active. */
function uploadDemTexture(painter: Painter, tile: Tile, context: Context) {
    const gl = context.gl;
    const pixelData = tile.dem.getPixels();
    context.activeTexture.set(gl.TEXTURE1);

    context.pixelStoreUnpackPremultiplyAlpha.set(false);
    tile.demTexture ||= painter.getTileTexture(tile.dem.stride);
    if (tile.demTexture) {
        tile.demTexture.update(pixelData, {premultiply: false});
    } else {
        tile.demTexture = new Texture(context, pixelData, gl.RGBA, {premultiply: false});
    }
    tile.demTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);

    context.activeTexture.set(gl.TEXTURE0);
}

function renderSlopeClasses(
    tileManager: TileManager,
    layer: HillshadeStyleLayer,
    coords: OverscaledTileID[],
    stencilModes: {[_: number]: Readonly<StencilMode>},
    depthMode: Readonly<DepthMode>,
    colorMode: Readonly<ColorMode>,
    useBorder: boolean,
    frameRenderContext: FrameRenderContext
) {
    const context = frameRenderContext.context;
    const gl = context.gl;
    const program = frameRenderContext.useProgram('slopeClasses');
    const align = !frameRenderContext.data.moving;

    for (const coord of coords) {
        const tile = tileManager.getTile(coord);
        const fbo = tile.slopeClassesFbo;
        if (!fbo) continue;

        const mesh = frameRenderContext.getMeshFromTileID(coord.canonical, useBorder, true, 'raster');
        const terrainData = frameRenderContext.getTerrainDataForTile(coord);

        context.activeTexture.set(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fbo.colorAttachment.get());

        const projectionData = frameRenderContext.getProjectionDataForTile(coord, {aligned: align});

        program.draw(context, gl.TRIANGLES, depthMode, stencilModes[coord.overscaledZ], colorMode, CullFaceMode.backCCW,
            slopeClassesUniformValues(layer), terrainData, projectionData, layer.id, mesh.vertexBuffer, mesh.indexBuffer, mesh.segments);
    }
}

/**
 * Writes the slope of each pixel in degrees, on 16 bits in the red and green channels, to a framebuffer of its own, so
 * that a shading layer on the same source keeps `tile.fbo`. The texture is read with `NEAREST` whatever `resampling`
 * says: a linear filter would blend the slopes across the edge of a class.
 */
function prepareSlopeClasses(
    painter: Painter,
    tileManager: TileManager,
    tileIDs: OverscaledTileID[],
    layer: HillshadeStyleLayer,
    depthMode: Readonly<DepthMode>,
    stencilMode: Readonly<StencilMode>,
    colorMode: Readonly<ColorMode>,
    frameRenderContext: FrameRenderContext) {

    const context = frameRenderContext.context;
    const gl = context.gl;

    for (const coord of tileIDs) {
        const tile = tileManager.getTile(coord);
        const dem = tile.dem;
        if (!dem?.data || !tile.needsSlopeClassesPrepare) continue;

        uploadDemTexture(painter, tile, context);

        const size = dem.dim + 2;
        let fbo = tile.slopeClassesFbo;
        if (!fbo) {
            const renderTexture = new Texture(context, {width: size, height: size, data: null}, gl.RGBA);
            renderTexture.bind(gl.NEAREST, gl.CLAMP_TO_EDGE);

            fbo = tile.slopeClassesFbo = context.createFramebuffer(size, size, true, false);
            fbo.colorAttachment.set(renderTexture.texture);
        }

        context.bindFramebuffer.set(fbo.framebuffer);
        context.viewport.set([0, 0, size, size]);

        frameRenderContext.useProgram('slopeClassesPrepare').draw(context, gl.TRIANGLES,
            depthMode, stencilMode, colorMode, CullFaceMode.disabled,
            slopeClassesPrepareUniformValues(frameRenderContext.transform, tile.tileID, dem),
            null, null, layer.id, painter.rasterBoundsBuffer,
            painter.quadTriangleIndexBuffer, painter.rasterBoundsSegments);

        tile.needsSlopeClassesPrepare = false;
    }
}

function renderHillshade(
    tileManager: TileManager,
    layer: HillshadeStyleLayer,
    coords: OverscaledTileID[],
    stencilModes: {[_: number]: Readonly<StencilMode>},
    depthMode: Readonly<DepthMode>,
    colorMode: Readonly<ColorMode>,
    useBorder: boolean,
    frameRenderContext: FrameRenderContext
) {
    const context = frameRenderContext.context;
    const gl = context.gl;

    const defines = [`#define NUM_ILLUMINATION_SOURCES ${layer.paint.get('hillshade-highlight-color').values.length}`];
    const program = frameRenderContext.useProgram('hillshade', null, false, defines);
    const align = !frameRenderContext.data.moving;

    for (const coord of coords) {
        const tile = tileManager.getTile(coord);
        const fbo = tile.fbo;
        if (!fbo) {
            continue;
        }
        const mesh = frameRenderContext.getMeshFromTileID(coord.canonical, useBorder, true, 'raster');

        const terrainData = frameRenderContext.getTerrainDataForTile(coord);

        context.activeTexture.set(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fbo.colorAttachment.get());

        const projectionData = frameRenderContext.getProjectionDataForTile(coord, {aligned: align});

        program.draw(context, gl.TRIANGLES, depthMode, stencilModes[coord.overscaledZ], colorMode, CullFaceMode.backCCW,
            hillshadeUniformValues(frameRenderContext.transform, tile, layer), terrainData, projectionData, layer.id, mesh.vertexBuffer, mesh.indexBuffer, mesh.segments);
    }
}

// hillshade rendering is done in two steps. the prepare step first calculates the slope of the terrain in the x and y
// directions for each pixel, and saves those values to a framebuffer texture in the r and g channels.
function prepareHillshade(
    painter: Painter,
    tileManager: TileManager,
    tileIDs: OverscaledTileID[],
    layer: HillshadeStyleLayer,
    depthMode: Readonly<DepthMode>,
    stencilMode: Readonly<StencilMode>,
    colorMode: Readonly<ColorMode>,
    frameRenderContext: FrameRenderContext) {

    const context = frameRenderContext.context;
    const gl = context.gl;

    const textureFilter = layer.paint.get('resampling') === 'nearest' ?  gl.NEAREST : gl.LINEAR;

    for (const coord of tileIDs) {
        const tile = tileManager.getTile(coord);
        const dem = tile.dem;

        if (!dem?.data) {
            continue;
        }

        if (!tile.needsHillshadePrepare) {
            continue;
        }

        const hillshadeTextureSize = dem.dim + 2;
        uploadDemTexture(painter, tile, context);

        let fbo = tile.fbo;

        if (!fbo) {
            const renderTexture = new Texture(context, {width: hillshadeTextureSize, height: hillshadeTextureSize, data: null}, gl.RGBA);
            renderTexture.bind(textureFilter, gl.CLAMP_TO_EDGE);

            fbo = tile.fbo = context.createFramebuffer(hillshadeTextureSize, hillshadeTextureSize, true, false);
            fbo.colorAttachment.set(renderTexture.texture);
        }

        context.bindFramebuffer.set(fbo.framebuffer);
        context.viewport.set([0, 0, hillshadeTextureSize, hillshadeTextureSize]);

        frameRenderContext.useProgram('hillshadePrepare').draw(context, gl.TRIANGLES,
            depthMode, stencilMode, colorMode, CullFaceMode.disabled,
            hillshadeUniformPrepareValues(frameRenderContext.transform, tile.tileID, dem),
            null, null, layer.id, painter.rasterBoundsBuffer,
            painter.quadTriangleIndexBuffer, painter.rasterBoundsSegments);

        tile.needsHillshadePrepare = false;
    }
}
