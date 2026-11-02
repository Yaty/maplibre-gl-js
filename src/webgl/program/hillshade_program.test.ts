import {describe, expect, test} from 'vitest';
import {hillshadeUniformPrepareValues, slopeClassesPrepareUniformValues, slopeClassesUniformValues} from './hillshade_program.ts';
import {HillshadeStyleLayer} from '../../style/style_layer/hillshade_style_layer.ts';
import {OverscaledTileID} from '../../tile/tile_id.ts';
import {DEMData} from '../../data/dem_data.ts';
import {RGBAImage} from '../../util/image.ts';
import {createMercatorTransform} from '../../geo/projection/mercator_transform.ts';
import {createIdentityCrsTransform} from '../../util/test/util.ts';

describe('hillshadeUniformPrepareValues', () => {
    test('keeps the world width the shader always used on a mercator map', () => {
        const transform = createMercatorTransform({minZoom: 0, maxZoom: 22, minPitch: 0, maxPitch: 60, renderWorldCopies: true});
        const dem = new DEMData('0', new RGBAImage({width: 8, height: 8}), 'mapbox');
        const uniformValues = hillshadeUniformPrepareValues(transform, new OverscaledTileID(0, 0, 0, 0, 0), dem);
        expect(uniformValues['u_log2_world_width']).toBe(25.2562);
    });

    test('takes the world width from the zoom 0 extent of a registered CRS', () => {
        const transform = createIdentityCrsTransform(256, 256);
        const dem = new DEMData('0', new RGBAImage({width: 8, height: 8}), 'mapbox');
        const uniformValues = hillshadeUniformPrepareValues(transform, new OverscaledTileID(0, 0, 0, 0, 0), dem);
        expect(uniformValues['u_log2_world_width']).toBeCloseTo(7.491853, 6);
    });
});

describe('slopeClassesPrepareUniformValues', () => {
    test('smooths the heights from the relief zoom 14, not below', () => {
        const transform = createMercatorTransform({minZoom: 0, maxZoom: 22, minPitch: 0, maxPitch: 60, renderWorldCopies: true});
        const dem = new DEMData('0', new RGBAImage({width: 8, height: 8}), 'mapbox');
        const z13 = slopeClassesPrepareUniformValues(transform, new OverscaledTileID(13, 0, 13, 0, 0), dem);
        const z14 = slopeClassesPrepareUniformValues(transform, new OverscaledTileID(14, 0, 14, 0, 0), dem);
        expect(z13['u_grid'][3]).toBe(0);
        expect(z14['u_grid'][3]).toBe(1);
    });

    test('gives the ground spacing and the rows of the world on a mercator map', () => {
        const transform = createMercatorTransform({minZoom: 0, maxZoom: 22, minPitch: 0, maxPitch: 60, renderWorldCopies: true});
        const dem = new DEMData('0', new RGBAImage({width: 8, height: 8}), 'mapbox');
        const grid = slopeClassesPrepareUniformValues(transform, new OverscaledTileID(2, 0, 2, 1, 3), dem)['u_grid'] as number[];
        expect(grid[2]).toBe(dem.dim * 4);
        expect(grid[0]).toBeCloseTo(40075016.68557849 / grid[2], 6);
        expect(grid[1]).toBe(3 * dem.dim - 1);
    });

    test('applies no correction by latitude on a registered CRS', () => {
        const transform = createIdentityCrsTransform(256, 256);
        const dem = new DEMData('0', new RGBAImage({width: 8, height: 8}), 'mapbox');
        const uniformValues = slopeClassesPrepareUniformValues(transform, new OverscaledTileID(0, 0, 0, 0, 0), dem);
        expect(uniformValues['u_grid'][2]).toBe(0);
    });
});

describe('slopeClassesUniformValues', () => {
    test('leaves the missing breaks out of reach and repeats the last color', () => {
        const layer = new HillshadeStyleLayer({
            id: 'slope',
            type: 'hillshade',
            source: 'dem',
            paint: {
                'hillshade-method': 'slope-classes',
                'hillshade-slope-breaks': [30],
                'hillshade-slope-colors': ['transparent', 'red']
            }
        }, {});
        const uniformValues = slopeClassesUniformValues(layer);
        expect(uniformValues['u_breaks']).toEqual([30, 1000, 1000, 1000]);
        expect(uniformValues['u_colors'][4]).toEqual(uniformValues['u_colors'][1]);
    });
});
