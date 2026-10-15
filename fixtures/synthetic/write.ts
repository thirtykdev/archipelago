// Write a sample set of synthetic files to fixtures/synthetic/out so the preview runtime can be started on them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stationXml, dist, bog } from './station.ts';
import { caf, gfx, DEFAULT_POINTS } from './controller.ts';
const out = join('fixtures', 'synthetic', 'out'); mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'site.dist'), dist(stationXml({ devices: 6, pointsPerDevice: 6, withLink: true, withUnknownModule: true })));
writeFileSync(join(out, 'site.bog'), bog(stationXml({ devices: 6, pointsPerDevice: 6 })));
writeFileSync(join(out, 'VAV_01.caf'), caf({ name: 'VAV_01', instance: 2001 }));
writeFileSync(join(out, 'VAV_02.gfx'), gfx({ name: 'VAV_02', instance: 2002 }));
writeFileSync(join(out, 'VAV_09.caf'), caf({ name: 'VAV_09', instance: 2009, points: DEFAULT_POINTS.slice(0, 5) }));   // no such device in the station
console.log(`wrote synthetic files to ${out}`);
